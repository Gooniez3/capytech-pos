const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

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

router.post('/', requireAuth, async (req, res) => {
  const {
  items,
  payment_method,
  discount,
  customer_id,

  customer_name,
  customer_phone,
  customer_email,
  customer_address,

  idempotency_key,
} = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'Cart is empty',
    });
  }

  const allowedPaymentMethods = [
    'cash',
    'banking',
    'kbzpay',
    'wavepay',
    'mmqr',
  ];

  const paymentMethod =
    allowedPaymentMethods.includes(payment_method)
      ? payment_method
      : 'cash';

  const idempotencyKey =
  typeof idempotency_key === 'string'
    ? idempotency_key.trim()
    : '';

if (idempotencyKey) {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(idempotencyKey)) {
    return res.status(400).json({
      error: 'Invalid checkout idempotency key',
    });
  }

  /*
   * If this checkout was already completed,
   * return the original sale instead of
   * deducting inventory again.
   */
  const existingSaleResult =
    await pool.query(
      `
        SELECT *
        FROM sales
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey]
    );

  const existingSale =
    existingSaleResult.rows[0];

  if (existingSale) {
    const existingItemsResult =
      await pool.query(
        `
          SELECT *
          FROM sale_items
          WHERE sale_id = $1
          ORDER BY id
        `,
        [existingSale.id]
      );

    return res.status(200).json({
      sale: existingSale,
      items: existingItemsResult.rows,
      duplicate: true,
    });
  }
}    

  const client = await pool.connect();

  try {
  await client.query('BEGIN');

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
  if (idempotencyKey) {
    await client.query(
      `
        SELECT pg_advisory_xact_lock(
          hashtextextended($1, 0)
        )
      `,
      [idempotencyKey]
    );

    const duplicateSaleResult =
      await client.query(
        `
          SELECT *
          FROM sales
          WHERE idempotency_key = $1
          LIMIT 1
        `,
        [idempotencyKey]
      );

    const duplicateSale =
      duplicateSaleResult.rows[0];

    if (duplicateSale) {
      const duplicateItemsResult =
        await client.query(
          `
            SELECT *
            FROM sale_items
            WHERE sale_id = $1
            ORDER BY id
          `,
          [duplicateSale.id]
        );

      await client.query('COMMIT');

      return res.status(200).json({
        sale: duplicateSale,
        items: duplicateItemsResult.rows,
        duplicate: true,
      });
    }
  }

  let customerId = null;

  if (
    customer_id !== null &&
    customer_id !== undefined &&
    customer_id !== ''
  ) {
    const customerResult =
      await client.query(
        `
        SELECT id
        FROM customers
        WHERE id = $1
        `,
        [customer_id]
      );

    if (
      customerResult.rows.length === 0
    ) {
      throw new Error(
        'Customer not found'
      );
    }

    customerId =
      Number(customer_id);
  }

  let subtotal = 0;
  const lineItems = [];

  for (const item of items) {
  const quantity =
    Number(item.quantity);

  if (
    !Number.isFinite(quantity) ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    throw new Error(
      'Quantity must be a positive whole number'
    );
  }

 
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
          throw new Error(
            `Variant ${item.variant_id} not found`
          );
        }

        if (
          Number(
            variant.stock_quantity
          ) < quantity
        ) {
          throw new Error(
            `Not enough stock for ${variant.product_name} — ${variant.variant_name}`
          );
        }

        const unitPrice =
  Number(variant.price);

const unitCost =
  Number(variant.cost ?? 0);

const lineTotal =
  unitPrice * quantity;

        subtotal += lineTotal;

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
          unit_cost:
          unitCost,

          unit_price:
            unitPrice,

          line_total:
            lineTotal,
        });

        const updatedVariantResult =
  await client.query(
    `
      UPDATE product_variants

      SET
        stock_quantity =
          stock_quantity - $1,

        updated_at = NOW()

      WHERE id = $2

      RETURNING
        stock_quantity,
        low_stock_threshold
    `,
    [
      quantity,
      variant.variant_id,
    ]
  );

const updatedVariant =
  updatedVariantResult.rows[0];

const previousVariantStock =
  Number(variant.stock_quantity);

const newVariantStock =
  Number(updatedVariant.stock_quantity);

const variantThreshold =
  Number(
    updatedVariant.low_stock_threshold ?? 2
  );

if (
  previousVariantStock > variantThreshold &&
  newVariantStock <= variantThreshold
) {
  await createLowStockNotifications(
    client,
    {
      productName:
        variant.product_name,

      variantName:
        variant.variant_name,

      stockQuantity:
        newVariantStock,

      threshold:
        variantThreshold,
    }
  );
}

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
            low_stock_threshold

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
        throw new Error(
          `Product ${item.product_id} not found`
        );
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
        throw new Error(
          `${product.name} requires a variant selection`
        );
      }

      if (
        Number(
          product.stock_quantity
        ) < quantity
      ) {
        throw new Error(
          `Not enough stock for ${product.name}`
        );
      }

      const unitPrice =
  Number(product.price);

const unitCost =
  Number(product.cost ?? 0);

const lineTotal =
  unitPrice * quantity;

      subtotal += lineTotal;

      lineItems.push({
        product_id:
          product.id,

        variant_id: null,

        product_name:
          product.name,

        variant_name: null,

        variant_sku: null,

        quantity,

        unit_cost:
          unitCost,

        unit_price:
          unitPrice,

        line_total:
          lineTotal,
      });

      const updatedProductResult =
  await client.query(
    `
      UPDATE products

      SET
        stock_quantity =
          stock_quantity - $1,

        updated_at = NOW()

      WHERE id = $2

      RETURNING
        stock_quantity,
        low_stock_threshold
    `,
    [
      quantity,
      product.id,
    ]
  );

const updatedProduct =
  updatedProductResult.rows[0];

const previousProductStock =
  Number(product.stock_quantity);

const newProductStock =
  Number(updatedProduct.stock_quantity);

const productThreshold =
  Number(
    updatedProduct.low_stock_threshold ?? 5
  );

if (
  previousProductStock > productThreshold &&
  newProductStock <= productThreshold
) {
  await createLowStockNotifications(
    client,
    {
      productName:
        product.name,

      variantName: null,

      stockQuantity:
        newProductStock,

      threshold:
        productThreshold,
    }
  );
}
  }

    /*
     * =====================================================
     * TOTALS
     * =====================================================
     */

    const discountAmount =
      Math.max(
        0,
        Number(discount) || 0
      );

    if (discountAmount > subtotal) {
      throw new Error(
        'Discount cannot exceed subtotal'
      );
    }

    const total =
      subtotal - discountAmount;

    const invoiceNumber =
      await generateInvoiceNumber(
        client
      );
      
     const customerName =
  customer_name?.trim() || null;

const customerPhone =
  customer_phone?.trim() || null;

const customerEmail =
  customer_email?.trim() || null;

const customerAddress =
  customer_address?.trim() || null;

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
      total,
      payment_method,
      idempotency_key
    )
    VALUES (
      $1, $2, $3,
      $4, $5, $6, $7,
      $8, $9, $10, $11,
      $12
    )
    RETURNING *
  `,
  [
    invoiceNumber,
    req.user.id,
    customerId,

    customerName,
    customerPhone,
    customerEmail,
    customerAddress,

    subtotal,
    discountAmount,
    total,
    paymentMethod,

    idempotencyKey || null,
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
  await client.query(
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
      line_total
    )

    VALUES
    (
      $1, $2, $3,
      $4, $5, $6,
      $7, $8, $9, $10
    )
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
    ]
  );
}

    await client.query('COMMIT');

    res.status(201).json({
      sale,
      items: lineItems,
    });
  } catch (err) {
    await client.query(
      'ROLLBACK'
    );

    console.error(err);

    res.status(400).json({
      error:
        err.message ||
        'Checkout failed',
    });
  } finally {
    client.release();
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
      const itemsResult = await pool.query(
        `
        SELECT
          id,
          sale_id,
          product_id,
          variant_id,
          product_name,
          variant_name,
          variant_sku,
          quantity,
          unit_cost,
          unit_price,
          line_total

        FROM sale_items

        WHERE sale_id = $1

        ORDER BY id
        `,
        [sale.id]
      );

      result.push({
        ...sale,
        items: itemsResult.rows,
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
        throw new Error('Sale not found');
      }

      // Only completed sales can be voided.
// This prevents refunded/voided sales from
// restoring inventory more than once.
if (sale.status !== 'completed') {
  if (sale.status === 'voided') {
    throw new Error(
      'This sale has already been voided'
    );
  }

  if (sale.status === 'refunded') {
    throw new Error(
      'A refunded sale cannot be voided'
    );
  }

  throw new Error(
    'Only completed sales can be voided'
  );
}

      // Get sale items
      const itemsResult = await client.query(
        `
        SELECT *
        FROM sale_items
        WHERE sale_id = $1
        `,
        [req.params.id]
      );

      // Restore exact stock
      for (const item of itemsResult.rows) {
        if (item.variant_id) {
          // Variant sale
          await client.query(
            `
            UPDATE product_variants
            SET
              stock_quantity = stock_quantity + $1,
              updated_at = NOW()
            WHERE id = $2
            `,
            [
              item.quantity,
              item.variant_id,
            ]
          );
        } else {
          // Normal product sale
          await client.query(
            `
            UPDATE products
            SET
              stock_quantity = stock_quantity + $1,
              updated_at = NOW()
            WHERE id = $2
            `,
            [
              item.quantity,
              item.product_id,
            ]
          );
        }
      }

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

      await client.query('COMMIT');

      res.json({
        message:
          'Sale voided and stock restored',
      });
    } catch (err) {
      await client.query('ROLLBACK');

      console.error(err);

      res.status(400).json({
        error:
          err.message ||
          'Failed to void sale',
      });
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
        throw new Error(
          'Sale not found'
        );
      }

      /*
       * =====================================================
       * PREVENT INVALID REFUNDS
       * =====================================================
       */

      if (
        sale.status ===
        'refunded'
      ) {
        throw new Error(
          'This sale has already been refunded'
        );
      }

      if (
        sale.status ===
        'voided'
      ) {
        throw new Error(
          'A voided sale cannot be refunded'
        );
      }

      if (
        sale.status !==
        'completed'
      ) {
        throw new Error(
          'Only completed sales can be refunded'
        );
      }

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

      if (
        itemsResult.rows.length ===
        0
      ) {
        throw new Error(
          'This sale has no items to refund'
        );
      }

      /*
       * =====================================================
       * RESTORE EXACT INVENTORY
       * =====================================================
       */

      for (
        const item of
        itemsResult.rows
      ) {
        /*
         * Variant item
         */

        if (item.variant_id) {
          await client.query(
            `
              UPDATE product_variants

              SET
                stock_quantity =
                  stock_quantity + $1,

                updated_at = NOW()

              WHERE id = $2
            `,
            [
              item.quantity,
              item.variant_id,
            ]
          );
        } else {
          /*
           * Normal product
           */

          if (
            item.product_id
          ) {
            await client.query(
              `
                UPDATE products

                SET
                  stock_quantity =
                    stock_quantity + $1,

                  updated_at = NOW()

                WHERE id = $2
              `,
              [
                item.quantity,
                item.product_id,
              ]
            );
          }
        }
      }

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

      console.error(
        'Refund error:',
        err
      );

      res.status(400).json({
        error:
          err.message ||
          'Failed to refund sale',
      });
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
      s.total,
      s.payment_method,
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
      const itemsResult = await pool.query(
        `
        SELECT
          id,
          product_id,
          variant_id,
          product_name,
          variant_name,
          variant_sku,
          quantity,
          unit_price,
          line_total

        FROM sale_items

        WHERE sale_id = $1

        ORDER BY id
        `,
        [req.params.id]
      );

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

        total:
          Number(sale.total),

        refundedAt:
  sale.refunded_at,

refundReason:
  sale.refund_reason,

refundedBy:
  sale.refunded_by_name || null,

voidedAt:
  sale.voided_at,

        items: itemsResult.rows.map(
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
