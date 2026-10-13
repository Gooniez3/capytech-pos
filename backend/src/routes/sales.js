const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  SaleReversalError,
  assertSaleCanBeReversed,
  assertSaleItemsCanBeReversed,
  revalidateCurrentAdmin,
  restoreExactInventory,
} = require('../services/sale-reversal');
const {
  createCheckoutFingerprint,
  findExistingCheckout,
} = require('../services/checkout-fingerprint');
const {
  CheckoutValidationError,
  assertDiscountWithinSubtotal,
  assertNumericRange,
  authoritativeDecimalToMinorUnits,
  checkedLineTotal,
  checkedSubtotal,
  minorUnitsToDatabaseDecimal,
  parseStoreTaxRatePercent,
  resolveCheckoutCustomerSnapshot,
  taxMinorUnitsOnNet,
  validateCheckoutRequest,
} = require('../services/checkout-validation');
const {
  normalizeWarrantySelection,
  suggestWarrantyMonths,
} = require('../services/warranty');
const { attachTransaction, assertTransactionCanCommit } = require('../services/domain-transaction');
const {
  lockInventoryTargets,
  quarantineSoldUnits,
  sellStockUnits,
} = require('../services/stock-unit-service');
const { buildShopWarrantySnapshot } = require('../services/shop-warranty-period');
const { loadSaleItemsWithStockUnits } = require('../services/sale-read-model');
const { applyQuantityMovements } = require('../services/quantity-inventory-service');

const router = express.Router();

function rejectLegacySerializedCheckout(targetName) {
  const error = new CheckoutValidationError(
    `${targetName} uses serialized inventory and must be sold through stock-unit checkout`
  );
  error.statusCode = 409;
  throw error;
}

// Generates a simple sequential invoice number like INV-000123
async function generateInvoiceNumber(client) {
  const result = await client.query(`
    SELECT nextval(
      'invoice_number_seq'
    ) AS invoice_number
  `);

  const nextNumber = Number(
    result.rows[0].invoice_number
  );

  return `INV-${String(
    nextNumber
  ).padStart(6, '0')}`;
}


// POST /api/sales
// Body:
// {
//   items: [
//     {
//       product_id: 12,
//       variant_id: 34 | null,
//       quantity: 1
//     }
//   ],
//   payment_method: 'cash' | 'banking' | 'kbzpay' | 'wavepay' | 'mmqr',
//   discount: 0
// }

/* =========================================================
   CREATE LOW STOCK NOTIFICATIONS
   ========================================================= */

async function createLowStockNotifications(
  client,
  {
    productName,
    variantName,
    stockQuantity,
    threshold,
  }
) {
  const usersResult =
    await client.query(
      `
        SELECT user_id
        FROM notification_preferences
        WHERE low_stock = TRUE
      `
    );

  if (usersResult.rows.length === 0) {
    return;
  }

  const itemName =
    variantName
      ? `${productName} - ${variantName}`
      : productName;

  const title =
    stockQuantity === 0
      ? 'Out of Stock'
      : 'Low Stock Alert';

  const message =
    stockQuantity === 0
      ? `${itemName} is now out of stock.`
      : `${itemName} has only ${stockQuantity} item${
          stockQuantity === 1 ? '' : 's'
        } remaining. Reorder level: ${threshold}.`;

  for (const preference of usersResult.rows) {
    await client.query(
      `
        INSERT INTO notifications (
          user_id,
          type,
          title,
          message
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        preference.user_id,
        'low_stock',
        title,
        message,
      ]
    );
  }
}

/* =========================================================
   CREATE REFUND NOTIFICATIONS
   ========================================================= */

async function createRefundNotifications(
  client,
  {
    saleId,
    invoiceNumber,
    refundAmount,
    refundReason,
    refundedByName,
  }
) {
  /*
   * Only users who enabled refund
   * notifications receive the alert.
   */
  const usersResult =
    await client.query(
      `
        SELECT user_id

        FROM notification_preferences

        WHERE refund_activity = TRUE
      `
    );

  if (
    usersResult.rows.length === 0
  ) {
    return;
  }

  const amount =
    Number(refundAmount).toLocaleString(
      'en-US'
    );

  const title =
    'Sale Refunded';

  const message =
    `${invoiceNumber} was refunded for ${amount} ks` +
    `${refundedByName ? ` by ${refundedByName}` : ''}. ` +
    `Reason: ${refundReason}`;

  for (
    const preference of
    usersResult.rows
  ) {
    await client.query(
      `
        INSERT INTO notifications (
          user_id,
          type,
          title,
          message,
          related_sale_id
        )

        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5
        )
      `,
      [
        preference.user_id,
        'refund',
        title,
        message,
        saleId,
      ]
    );
  }
}

async function reverseSaleInventory(client, transaction, items, {
  action, saleId, actorUserId, reason = null,
}) {
  const unique = new Map();
  for (const item of items) {
    const key = `${item.product_id}:${item.variant_id ?? 'null'}`;
    unique.set(key, { productId: item.product_id, variantId: item.variant_id });
  }
  const targets = await lockInventoryTargets(client, [...unique.values()], {
    requireActive: false,
    enforceVariantTarget: false,
  });
  const targetMap = new Map(targets.map((target) => [target.key, target]));
  const assignments = await client.query(
    `
      SELECT sis.stock_unit_id, sis.sale_item_id
      FROM sale_item_stock_units sis
      JOIN sale_items si ON si.id = sis.sale_item_id
      WHERE si.sale_id = $1 AND sis.released_at IS NULL
      ORDER BY sis.stock_unit_id
    `,
    [saleId]
  );
  const unitsByItem = new Map();
  for (const row of assignments.rows) {
    const key = String(row.sale_item_id);
    if (!unitsByItem.has(key)) unitsByItem.set(key, []);
    unitsByItem.get(key).push(String(row.stock_unit_id));
  }
  const serializedUnitIds = [];
  const untrackedItems = [];
  for (const item of items) {
    const key = `${Number(item.product_id)}:${item.variant_id == null ? 'null' : Number(item.variant_id)}`;
    const target = targetMap.get(key);
    const unitIds = unitsByItem.get(String(item.id)) || [];
    // Active assignments prove that this was a serialized sale. Current
    // tracking policy is also checked so a legacy return cannot silently break
    // reconciliation after that inventory target has been adopted as serialized.
    const serialized = target?.policy.serialTrackingEnabled === true || unitIds.length > 0;
    if (serialized) {
      if (unitIds.length !== Number(item.quantity)) {
        throw new SaleReversalError(
          'Serialized sale assignments are incomplete; manual reconciliation is required',
          409
        );
      }
      serializedUnitIds.push(...unitIds);
    } else {
      untrackedItems.push(item);
    }
  }
  if (serializedUnitIds.length > 0) {
    await quarantineSoldUnits(transaction, {
      unitIds: serializedUnitIds,
      action,
      saleId,
      actorUserId,
      reason,
    });
  }
  if (untrackedItems.length > 0) await restoreExactInventory(transaction, untrackedItems, {
    action, saleId, actorUserId, reason,
  });
}

router.post('/', requireAuth, async (req, res) => {
  let checkoutRequest;

  try {
    checkoutRequest = validateCheckoutRequest(req.body);
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      error: err.message,
    });
  }

  const {
    items,
    payment_method: paymentMethod,
    discount,
    discount_minor_units: discountMinorUnits,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    customer_address,
    warranty_months: requestedWarrantyMonths,
    idempotency_key: idempotencyKey,
    checkout_contract_version: checkoutContractVersion,
  } = checkoutRequest;

  let checkoutFingerprint;

  try {
    checkoutFingerprint = createCheckoutFingerprint({
      user_id: req.user.id,
      items,
      payment_method: paymentMethod,
      discount,
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      customer_address,
      warranty_months: requestedWarrantyMonths,
      checkout_contract_version: checkoutContractVersion,
    });

    const existingCheckout = await findExistingCheckout(
      pool,
      idempotencyKey,
      checkoutFingerprint
    );

    if (existingCheckout) {
      return res.status(200).json({
        ...existingCheckout,
        duplicate: true,
      });
    }
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
      });
    }

    console.error('Checkout idempotency lookup failed');
    return res.status(500).json({
      error: 'Checkout failed',
    });
  }

  let client;

  try {
  client = await pool.connect();
  await client.query('BEGIN');
  const domainTransaction = attachTransaction(client);

  /*
   * =====================================================
   * IDEMPOTENCY CONCURRENCY LOCK
   * =====================================================
   *
   * Requests using the same idempotency key must run
   * one at a time.
   *
   * Example:
   * - Request A gets the lock
   * - Request B waits
   * - A completes the sale
   * - B gets the lock
   * - B finds A's sale and returns it
   *
   * Stock is therefore deducted only once.
   */
  await client.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtextextended($1, 0)
      )
    `,
    [idempotencyKey]
  );

  const duplicateCheckout = await findExistingCheckout(
    client,
    idempotencyKey,
    checkoutFingerprint
  );

  if (duplicateCheckout) {
    await client.query('COMMIT');

    return res.status(200).json({
      ...duplicateCheckout,
      duplicate: true,
    });
  }

  /*
   * Customer existence is a checkout command failure (HTTP 400),
   * matching missing products/variants. GET /api/customers/:id remains 404.
   * Database customer fields are authoritative when customer_id is present;
   * client snapshot fields cannot override them.
   */
  let databaseCustomer = null;

  if (customer_id !== null) {
    const customerResult = await client.query(
      `
        SELECT id, name, phone, email, address
        FROM customers
        WHERE id = $1
      `,
      [customer_id]
    );

    databaseCustomer = customerResult.rows[0] || null;
  }

  const saleCustomer = resolveCheckoutCustomerSnapshot(
    {
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      customer_address,
    },
    databaseCustomer
  );

  let subtotalMinorUnits = 0;
  const lineItems = [];
  const inventoryMutations = [];

  for (const item of items) {
  const quantity = item.quantity;

 
      /*
       * =====================================================
       * VARIANT SALE
       * =====================================================
       */

      if (
        item.variant_id !== null &&
        item.variant_id !== undefined
      ) {
        const variantResult =
          await client.query(
            `
            SELECT
              pv.id AS variant_id,
              pv.product_id,
              pv.name AS variant_name,
              pv.sku AS variant_sku,
              pv.stock_quantity,
              pv.low_stock_threshold,
              COALESCE(pv.serial_tracking_enabled, p.serial_tracking_enabled)
                AS serial_tracking_enabled,
              COALESCE(pv.shop_warranty_enabled, p.shop_warranty_enabled)
                AS shop_warranty_enabled,
              COALESCE(pv.shop_warranty_months, p.shop_warranty_months)
                AS shop_warranty_months,
              p.sku AS product_sku,

              COALESCE(
  pv.price,
  p.price
) AS price,

COALESCE(
  pv.cost,
  p.cost,
  0
) AS cost,

p.name AS product_name

            FROM product_variants pv

            JOIN products p
              ON p.id = pv.product_id

            WHERE pv.id = $1
              AND pv.product_id = $2
              AND pv.is_active = TRUE
              AND p.is_active = TRUE

            FOR UPDATE
            `,
            [
              item.variant_id,
              item.product_id,
            ]
          );

        const variant =
          variantResult.rows[0];

        if (!variant) {
          throw new CheckoutValidationError(
            `Variant ${item.variant_id} not found`
          );
        }

        if (checkoutContractVersion === 1 && variant.serial_tracking_enabled === true) {
          rejectLegacySerializedCheckout(
            `${variant.product_name} - ${variant.variant_name}`
          );
        }
        if (checkoutContractVersion === 2) {
          if (variant.serial_tracking_enabled === true && item.stock_unit_ids.length !== quantity) {
            throw new CheckoutValidationError('Serialized item quantity must equal selected stock-unit count');
          }
          if (variant.serial_tracking_enabled !== true && item.stock_unit_ids.length !== 0) {
            throw new CheckoutValidationError('Untracked items must not include stock-unit IDs');
          }
        }

        if (
          Number(
            variant.stock_quantity
          ) < quantity
        ) {
          throw new CheckoutValidationError(
            `Not enough stock for ${variant.product_name} — ${variant.variant_name}`
          );
        }

        const unitPriceMinorUnits = authoritativeDecimalToMinorUnits(
          variant.price,
          'variant price'
        );
        const unitCostMinorUnits = authoritativeDecimalToMinorUnits(
          variant.cost ?? '0',
          'variant cost'
        );
        const lineTotalMinorUnits = checkedLineTotal(unitPriceMinorUnits, quantity);
        subtotalMinorUnits = checkedSubtotal(subtotalMinorUnits, lineTotalMinorUnits);

        lineItems.push({
          product_id:
            variant.product_id,

          variant_id:
            variant.variant_id,

          product_name:
            variant.product_name,

          variant_name:
            variant.variant_name,

          variant_sku:
            variant.variant_sku,

          quantity,
          unit_cost: minorUnitsToDatabaseDecimal(unitCostMinorUnits),
          unit_price: minorUnitsToDatabaseDecimal(unitPriceMinorUnits),
          line_total: minorUnitsToDatabaseDecimal(lineTotalMinorUnits),
          product_sku: variant.product_sku,
          stock_unit_ids: item.stock_unit_ids || [],
          serial_tracking_enabled: variant.serial_tracking_enabled === true,
          warranty_policy: {
            shopWarrantyEligible: variant.shop_warranty_enabled === true,
            shopWarrantyMonths: variant.shop_warranty_enabled === true
              ? Number(variant.shop_warranty_months) : null,
          },
        });

        if (variant.serial_tracking_enabled !== true) inventoryMutations.push({
          productId: Number(variant.product_id),
          variantId: Number(variant.variant_id),
          quantity,
          previousStock: Number(variant.stock_quantity),
          threshold: Number(variant.low_stock_threshold ?? 2),
          productName: variant.product_name,
          variantName: variant.variant_name,
        });

continue;
      }

      /*
       * =====================================================
       * NORMAL PRODUCT SALE
       * =====================================================
       */

      const productResult =
        await client.query(
          `
          SELECT
            id,
            name,
            sku,
            price,
            cost,
            stock_quantity,
            low_stock_threshold,
            serial_tracking_enabled,
            shop_warranty_enabled,
            shop_warranty_months

          FROM products

          WHERE id = $1
            AND is_active = TRUE

          FOR UPDATE
          `,
          [item.product_id]
        );

      const product =
        productResult.rows[0];

      if (!product) {
        throw new CheckoutValidationError(
          `Product ${item.product_id} not found`
        );
      }

      if (checkoutContractVersion === 1 && product.serial_tracking_enabled === true) {
        rejectLegacySerializedCheckout(product.name);
      }
      if (checkoutContractVersion === 2) {
        if (product.serial_tracking_enabled === true && item.stock_unit_ids.length !== quantity) {
          throw new CheckoutValidationError('Serialized item quantity must equal selected stock-unit count');
        }
        if (product.serial_tracking_enabled !== true && item.stock_unit_ids.length !== 0) {
          throw new CheckoutValidationError('Untracked items must not include stock-unit IDs');
        }
      }

      /*
       * Prevent accidentally selling a parent
       * product that actually has variants.
       */
      const variantCountResult =
        await client.query(
          `
          SELECT COUNT(*)::integer AS count

          FROM product_variants

          WHERE product_id = $1
            AND is_active = TRUE
          `,
          [product.id]
        );

      if (
        Number(
          variantCountResult.rows[0].count
        ) > 0
      ) {
        throw new CheckoutValidationError(
          `${product.name} requires a variant selection`
        );
      }

      if (
        Number(
          product.stock_quantity
        ) < quantity
      ) {
        throw new CheckoutValidationError(
          `Not enough stock for ${product.name}`
        );
      }

      const unitPriceMinorUnits = authoritativeDecimalToMinorUnits(
        product.price,
        'product price'
      );
      const unitCostMinorUnits = authoritativeDecimalToMinorUnits(
        product.cost ?? '0',
        'product cost'
      );
      const lineTotalMinorUnits = checkedLineTotal(unitPriceMinorUnits, quantity);
      subtotalMinorUnits = checkedSubtotal(subtotalMinorUnits, lineTotalMinorUnits);

      lineItems.push({
        product_id:
          product.id,

        variant_id: null,

        product_name:
          product.name,

        variant_name: null,

        variant_sku: null,

        quantity,

        unit_cost: minorUnitsToDatabaseDecimal(unitCostMinorUnits),
        unit_price: minorUnitsToDatabaseDecimal(unitPriceMinorUnits),
        line_total: minorUnitsToDatabaseDecimal(lineTotalMinorUnits),
        product_sku: product.sku,
        stock_unit_ids: item.stock_unit_ids || [],
        serial_tracking_enabled: product.serial_tracking_enabled === true,
        warranty_policy: {
          shopWarrantyEligible: product.shop_warranty_enabled === true,
          shopWarrantyMonths: product.shop_warranty_enabled === true
            ? Number(product.shop_warranty_months) : null,
        },
      });

      if (product.serial_tracking_enabled !== true) inventoryMutations.push({
        productId: Number(product.id),
        variantId: null,
        quantity,
        previousStock: Number(product.stock_quantity),
        threshold: Number(product.low_stock_threshold ?? 5),
        productName: product.name,
        variantName: null,
      });
  }

    if (checkoutContractVersion === 2) {
      for (const item of lineItems.filter((entry) => entry.serial_tracking_enabled)) {
        const units = await client.query(
          `
            SELECT su.id, su.product_id, su.variant_id, su.state,
                   EXISTS (
                     SELECT 1 FROM sale_item_stock_units sis
                     WHERE sis.stock_unit_id = su.id AND sis.released_at IS NULL
                   ) AS assigned
            FROM stock_units su
            WHERE su.id = ANY($1::bigint[])
            ORDER BY su.id
            FOR UPDATE
          `,
          [item.stock_unit_ids]
        );
        if (units.rows.length !== item.stock_unit_ids.length || units.rows.some((unit) =>
          Number(unit.product_id) !== Number(item.product_id)
          || (unit.variant_id === null ? null : Number(unit.variant_id)) !== item.variant_id
          || unit.state !== 'available'
          || unit.assigned === true
        )) {
          const error = new CheckoutValidationError(
            'Selected stock units are unavailable or do not match the checkout item'
          );
          error.statusCode = 409;
          throw error;
        }
      }
    }

    /*
     * =====================================================
     * TOTALS
     * =====================================================
     */

    assertDiscountWithinSubtotal(discountMinorUnits, subtotalMinorUnits);

    const settingsResult = await client.query(
      `
        SELECT tax_rate
        FROM store_settings
        WHERE id = 1
        FOR SHARE
      `
    );

    if (!settingsResult.rows[0]) {
      throw new CheckoutValidationError('Store settings not found');
    }

    const taxRatePercent = parseStoreTaxRatePercent(settingsResult.rows[0].tax_rate);
    const netMinorUnits = subtotalMinorUnits - discountMinorUnits;
    const taxMinorUnits = taxMinorUnitsOnNet(netMinorUnits, taxRatePercent);
    const totalMinorUnits = netMinorUnits + taxMinorUnits;

    if (!Number.isSafeInteger(totalMinorUnits)) {
      throw new CheckoutValidationError('Total exceeds safe arithmetic range');
    }

    assertNumericRange(totalMinorUnits, 'total');

    const subtotal = minorUnitsToDatabaseDecimal(subtotalMinorUnits);
    const discountAmount = minorUnitsToDatabaseDecimal(discountMinorUnits);
    const taxAmount = minorUnitsToDatabaseDecimal(taxMinorUnits);
    const total = minorUnitsToDatabaseDecimal(totalMinorUnits);
    const warrantyMonths = checkoutContractVersion === 2
      ? null
      : requestedWarrantyMonths === null
        ? suggestWarrantyMonths(totalMinorUnits)
        : requestedWarrantyMonths;

    /* All inventory and monetary validation is complete before this point. */
    const quantityLedgerRows = inventoryMutations.length
      ? await applyQuantityMovements(domainTransaction, {
        actorUserId: req.user.id,
        movements: inventoryMutations.map((mutation) => ({
          productId: mutation.productId,
          variantId: mutation.variantId,
          movementType: 'sold',
          quantityChange: -mutation.quantity,
          reason: 'Sale checkout',
          sourceReference: `checkout:${idempotencyKey}`,
        })),
      })
      : [];
    for (let index = 0; index < inventoryMutations.length; index += 1) {
      const mutation = inventoryMutations[index];
      const newStock = Number(quantityLedgerRows[index].quantity_after);
      if (mutation.previousStock > mutation.threshold && newStock <= mutation.threshold) {
        await createLowStockNotifications(client, {
          productName: mutation.productName,
          variantName: mutation.variantName,
          stockQuantity: newStock,
          threshold: mutation.threshold,
        });
      }
    }

    const invoiceNumber =
      await generateInvoiceNumber(
        client
      );
      
    /*
     * =====================================================
     * SALE
     * =====================================================
     */

    const saleResult = await client.query(
  `
    INSERT INTO sales (
      invoice_number,
      user_id,
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      customer_address,
      subtotal,
      discount,
      tax,
      total,
      payment_method,
      checkout_contract_version,
      idempotency_key,
      checkout_request_fingerprint,
      warranty_months
    )
    VALUES (
      $1, $2, $3,
      $4, $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14, $15, $16
    )
    RETURNING *, created_at::date::text AS purchase_date
  `,
  [
    invoiceNumber,
    req.user.id,
    saleCustomer.customer_id,

    saleCustomer.customer_name,
    saleCustomer.customer_phone,
    saleCustomer.customer_email,
    saleCustomer.customer_address,

    subtotal,
    discountAmount,
    taxAmount,
    total,
    paymentMethod,

    checkoutContractVersion === 2 ? 2 : null,
    idempotencyKey,
    checkoutFingerprint,
    warrantyMonths,
  ]
);

    const sale =
      saleResult.rows[0];

    /*
     * =====================================================
     * SALE ITEMS
     * =====================================================
     */

    for (const item of lineItems) {
      const snapshot = checkoutContractVersion === 2
        ? buildShopWarrantySnapshot(item.warranty_policy, sale.purchase_date)
        : {
          shopWarrantyEligible: null, shopWarrantyMonths: null,
          shopWarrantyStartDate: null, shopWarrantyEndDate: null,
        };
  const savedItemResult = await client.query(
    `
    INSERT INTO sale_items
    (
      sale_id,
      product_id,
      variant_id,
      product_name,
      variant_name,
      variant_sku,
      quantity,
      unit_cost,
      unit_price,
      line_total,
      shop_warranty_eligible, shop_warranty_months,
      shop_warranty_start_date, shop_warranty_end_date,
      product_sku_snapshot, variant_sku_snapshot
    )

    VALUES
    (
      $1, $2, $3,
      $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16
    )
    RETURNING *
    `,
    [
      sale.id,
      item.product_id,
      item.variant_id,
      item.product_name,
      item.variant_name,
      item.variant_sku,
      item.quantity,
      item.unit_cost,
      item.unit_price,
      item.line_total,
      snapshot.shopWarrantyEligible,
      snapshot.shopWarrantyMonths,
      snapshot.shopWarrantyStartDate,
      snapshot.shopWarrantyEndDate,
      checkoutContractVersion === 2 ? item.product_sku : null,
      checkoutContractVersion === 2 ? item.variant_sku : null,
    ]
  );
      if (checkoutContractVersion === 2 && item.serial_tracking_enabled) {
        await sellStockUnits(domainTransaction, {
          unitIds: item.stock_unit_ids,
          saleId: sale.id,
          saleItemId: savedItemResult.rows[0].id,
          actorUserId: req.user.id,
        });
      }
}

    assertTransactionCanCommit(domainTransaction);
    const responseItems = checkoutContractVersion === 2
      ? await loadSaleItemsWithStockUnits(client, sale.id)
      : lineItems;
    await client.query('COMMIT');

    res.status(201).json({
      sale,
      items: responseItems,
    });
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }

    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    console.error('Checkout failed:', err);
    return res.status(500).json({ error: 'Checkout failed' });
  } finally {
    client?.release();
  }
});

// GET /api/sales
// Returns real sales history with sale items

router.get('/', requireAuth, async (req, res) => {
  try {
    const salesResult = await pool.query(
      `
      SELECT
  s.*,

  u.name AS cashier_name,

  refund_user.name AS refunded_by_name

FROM sales s

LEFT JOIN users u
  ON u.id = s.user_id

LEFT JOIN users refund_user
  ON refund_user.id = s.refunded_by

ORDER BY s.created_at DESC
      `
    );

    const result = [];

    for (const sale of salesResult.rows) {
      result.push({
        ...sale,
        items: await loadSaleItemsWithStockUnits(pool, sale.id),
      });
    }

    res.json(result);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Failed to load sales',
    });
  }
});

// PATCH /api/sales/:id/warranty
// Admin-only correction for an invoice that has already been created.
router.patch(
  '/:id/warranty',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    let warrantyMonths;

    try {
      warrantyMonths = normalizeWarrantySelection(
        req.body?.warranty_months
      );
    } catch (err) {
      return res.status(err.statusCode || 400).json({
        error: err.message,
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await revalidateCurrentAdmin(client, req.user.id);

      const currentResult = await client.query(
        `
          SELECT id, invoice_number, warranty_months
          FROM sales
          WHERE id = $1
          FOR UPDATE
        `,
        [req.params.id]
      );

      const current = currentResult.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Sale not found' });
      }

      const updatedResult = await client.query(
        `
          UPDATE sales
          SET warranty_months = $2
          WHERE id = $1
          RETURNING id, invoice_number, warranty_months
        `,
        [current.id, warrantyMonths]
      );

      await client.query(
        `
          INSERT INTO audit_log (user_id, action, details)
          VALUES ($1, 'UPDATE_INVOICE_WARRANTY', $2)
        `,
        [
          req.user.id,
          JSON.stringify({
            saleId: current.id,
            invoiceNumber: current.invoice_number,
            previousWarrantyMonths: current.warranty_months,
            warrantyMonths,
          }),
        ]
      );

      await client.query('COMMIT');

      return res.json({
        id: String(updatedResult.rows[0].id),
        invoiceNumber: updatedResult.rows[0].invoice_number,
        warrantyMonths: Number(updatedResult.rows[0].warranty_months),
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});

      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }

      console.error('Warranty update failed:', err);
      return res.status(500).json({ error: 'Failed to update warranty' });
    } finally {
      client.release();
    }
  }
);

// POST /api/sales/:id/void
// Admin only - restores exact product/variant stock

router.post(
  '/:id/void',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const domainTransaction = attachTransaction(client);

      await revalidateCurrentAdmin(client, req.user.id);

      // Find and lock the sale
      const saleResult = await client.query(
        `
        SELECT *
        FROM sales
        WHERE id = $1
        FOR UPDATE
        `,
        [req.params.id]
      );

      const sale = saleResult.rows[0];

      if (!sale) {
        throw new SaleReversalError('Sale not found', 404);
      }

      assertSaleCanBeReversed(sale, 'void');

      // Get sale items
      const itemsResult = await client.query(
        `
        SELECT *
        FROM sale_items
        WHERE sale_id = $1
        `,
        [req.params.id]
      );

      assertSaleItemsCanBeReversed(itemsResult.rows, 'void');
      await reverseSaleInventory(client, domainTransaction, itemsResult.rows, {
        action: 'voided', saleId: sale.id, actorUserId: req.user.id,
        reason: 'sale voided',
      });

      // Mark sale as voided
      await client.query(
  `
    UPDATE sales
    SET
      status = 'voided',
      voided_at = NOW()
    WHERE id = $1
  `,
  [req.params.id]
);

      // Audit log
      await client.query(
        `
        INSERT INTO audit_log
        (
          user_id,
          action,
          details
        )
        VALUES ($1, $2, $3)
        `,
        [
          req.user.id,
          'VOID_SALE',
          `Voided sale ${sale.invoice_number}`,
        ]
      );

      assertTransactionCanCommit(domainTransaction);
      await client.query('COMMIT');

      res.json({
        message:
          'Sale voided and stock restored',
      });
    } catch (err) {
      await client.query('ROLLBACK');

      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      console.error('Failed to void sale:', err);
      return res.status(500).json({ error: 'Failed to void sale' });
    } finally {
      client.release();
    }
  }
);


// =========================================================
// POST /api/sales/:id/refund
// Admin only - refunds full sale, restores stock,
// and records refund audit information
// =========================================================

router.post(
  '/:id/refund',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      /*
       * =====================================================
       * VALIDATE REFUND REASON
       * =====================================================
       */

      const refundReason =
        typeof req.body?.reason === 'string'
          ? req.body.reason.trim()
          : '';

      if (!refundReason) {
        return res.status(400).json({
          error: 'Refund reason is required',
        });
      }

      if (refundReason.length > 1000) {
        return res.status(400).json({
          error:
            'Refund reason must be 1000 characters or less',
        });
      }

      /*
       * =====================================================
       * START TRANSACTION
       * =====================================================
       */

      await client.query('BEGIN');
      const domainTransaction = attachTransaction(client);

      await revalidateCurrentAdmin(client, req.user.id);

      /*
       * =====================================================
       * FIND AND LOCK SALE
       * =====================================================
       */

      const saleResult =
        await client.query(
          `
            SELECT *
            FROM sales
            WHERE id = $1
            FOR UPDATE
          `,
          [req.params.id]
        );

      const sale =
        saleResult.rows[0];

      if (!sale) {
        throw new SaleReversalError('Sale not found', 404);
      }

      /*
       * =====================================================
       * PREVENT INVALID REFUNDS
       * =====================================================
       */

      assertSaleCanBeReversed(sale, 'refund');

      /*
       * =====================================================
       * LOAD SALE ITEMS
       * =====================================================
       */

      const itemsResult =
        await client.query(
          `
            SELECT *
            FROM sale_items
            WHERE sale_id = $1
          `,
          [req.params.id]
        );

      assertSaleItemsCanBeReversed(itemsResult.rows, 'refund');

      /*
       * =====================================================
       * RESTORE EXACT INVENTORY
       * =====================================================
       */

      await reverseSaleInventory(client, domainTransaction, itemsResult.rows, {
        action: 'refunded', saleId: sale.id, actorUserId: req.user.id,
        reason: refundReason,
      });

      /* =====================================================
   LOAD REFUNDING USER
   ===================================================== */

const refundUserResult =
  await client.query(
    `
      SELECT name

      FROM users

      WHERE id = $1
    `,
    [
      req.user.id,
    ]
  );

const refundedByName =
  refundUserResult.rows[0]?.name ||
  req.user.username ||
  'Admin';

      /*
       * =====================================================
       * UPDATE SALE
       * =====================================================
       */

      const updatedSaleResult =
        await client.query(
          `
            UPDATE sales

            SET
              status = 'refunded',
              refunded_at = NOW(),
              refund_reason = $2,
              refunded_by = $3

            WHERE id = $1

            RETURNING *
          `,
          [
            req.params.id,
            refundReason,
            req.user.id,
          ]
        );

      const updatedSale =
        updatedSaleResult.rows[0];

      /*
       * =====================================================
       * AUDIT LOG
       * =====================================================
       */

      assertTransactionCanCommit(domainTransaction);
      await client.query(
        `
          INSERT INTO audit_log
          (
            user_id,
            action,
            details
          )

          VALUES ($1, $2, $3)
        `,
        [
          req.user.id,

          'REFUND_SALE',

          `Refunded sale ${sale.invoice_number}. Reason: ${refundReason}`,
        ]
      );
      /* =====================================================
   REFUND NOTIFICATION
   ===================================================== */

await createRefundNotifications(
  client,
  {
    saleId:
      sale.id,

    invoiceNumber:
      sale.invoice_number,

    refundAmount:
      sale.total,

    refundReason,

    refundedByName,
  }
);

      /*
       * =====================================================
       * COMMIT
       * =====================================================
       */

      await client.query(
        'COMMIT'
      );

      /*
       * =====================================================
       * RESPONSE
       * =====================================================
       */

      res.json({
        message:
          'Sale refunded and stock restored',

        sale_id:
          sale.id,

        invoice_number:
          sale.invoice_number,

        refund_amount:
          Number(
            sale.total
          ),

        refund_reason:
          updatedSale.refund_reason,

        refunded_at:
          updatedSale.refunded_at,

        refunded_by:
          updatedSale.refunded_by,
      });
    } catch (err) {
      await client.query(
        'ROLLBACK'
      );

      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      console.error('Refund error:', err);
      return res.status(500).json({ error: 'Failed to refund sale' });
    } finally {
      client.release();
    }
  }
);

// =========================================================
// GET /api/sales/:id/invoice
// Returns complete data for printing/reprinting an invoice
// =========================================================

router.get(
  '/:id/invoice',
  requireAuth,
  async (req, res) => {
    try {
      // ---------------------------------
      // 1. Load sale + cashier
      // ---------------------------------
      const saleResult = await pool.query(
  `
    SELECT
      s.id,
      s.invoice_number,
      s.subtotal,
      s.discount,
      s.tax,
      s.total,
      s.payment_method,
      s.warranty_months,
      s.checkout_contract_version,
      s.status,
      s.created_at,

      s.refunded_at,
      s.refund_reason,
      s.refunded_by,
      s.voided_at,

      s.customer_name,
      s.customer_phone,
      s.customer_email,
      s.customer_address,

      u.name AS cashier_name,
      refund_user.name AS refunded_by_name

    FROM sales s

    LEFT JOIN users u
      ON u.id = s.user_id

    LEFT JOIN users refund_user
      ON refund_user.id = s.refunded_by

    WHERE s.id = $1
  `,
  [req.params.id]
);

      const sale = saleResult.rows[0];

      if (!sale) {
        return res.status(404).json({
          error: 'Sale not found',
        });
      }

      // ---------------------------------
      // 2. Load invoice items
      // ---------------------------------
      const invoiceItems = await loadSaleItemsWithStockUnits(pool, req.params.id);

      // ---------------------------------
      // 3. Return invoice
      // ---------------------------------
      res.json({
        id: String(sale.id),

        invoiceNumber:
          sale.invoice_number,

        createdAt:
          sale.created_at,

        status:
          sale.status,

        cashier:
          sale.cashier_name || 'Staff',

        paymentMethod:
  sale.payment_method,

customer: {
  name:
    sale.customer_name || null,

  phone:
    sale.customer_phone || null,

  email:
    sale.customer_email || null,

  address:
    sale.customer_address || null,
},

subtotal:
  Number(sale.subtotal),

        discount:
          Number(sale.discount),

        tax:
          Number(sale.tax ?? 0),

        total:
          Number(sale.total),

        warrantyMonths:
          sale.warranty_months === null
            ? null
            : Number(sale.warranty_months),

        checkoutContractVersion: sale.checkout_contract_version === null
          ? null : Number(sale.checkout_contract_version),

        refundedAt:
  sale.refunded_at,

refundReason:
  sale.refund_reason,

refundedBy:
  sale.refunded_by_name || null,

voidedAt:
  sale.voided_at,

        items: invoiceItems.map(
  (item) => ({
    id: String(item.id),

    productId:
      item.product_id !== null
        ? String(item.product_id)
        : null,

    variantId:
      item.variant_id !== null
        ? String(item.variant_id)
        : null,

    productName:
      item.product_name,

    variantName:
      item.variant_name,

    sku:
      item.variant_sku || '',

    quantity:
      Number(item.quantity),

    unitPrice:
      Number(item.unit_price),

    lineTotal:
      Number(item.line_total),

    shopWarrantyEligible: item.shop_warranty_eligible,
    shopWarrantyMonths: item.shop_warranty_months === null
      ? null : Number(item.shop_warranty_months),
    shopWarrantyStartDate: item.shop_warranty_start_date,
    shopWarrantyEndDate: item.shop_warranty_end_date,
    productSku: item.product_sku_snapshot,
    variantSku: item.variant_sku_snapshot,
    stockUnits: item.stock_units.map((unit) => ({
      id: String(unit.stock_unit_id),
      internalSku: unit.internal_sku_snapshot,
      serialNumber: unit.manufacturer_serial_number_snapshot,
      state: unit.current_state,
      releasedAt: unit.released_at,
      releaseReason: unit.release_reason,
    })),
  })
),
      });
    } catch (err) {
      console.error(
        'Invoice load error:',
        err
      );

      res.status(500).json({
        error: 'Failed to load invoice',
      });
    }
  }
);

module.exports = router;
