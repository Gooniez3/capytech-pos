const { revalidateCurrentAdmin } = require('./sale-reversal');
const { resolveEffectiveStockPolicy } = require('./stock-unit-policy');
const { adoptExistingInventory } = require('./stock-unit-service');
const {
  transactionClient,
  withTransactionOperation,
} = require('./domain-transaction');
const {
  InventoryApiError,
  positiveInteger,
  rejectUnknownFields,
} = require('./inventory-api-validation');

const POLICY_FIELDS = Object.freeze([
  'serial_tracking_enabled',
  'shop_warranty_enabled',
  'shop_warranty_months',
  'serial_numbers',
  'adoption_batches',
]);

function normalizeBoolean(value, field, { nullable }) {
  if (nullable && value === null) return null;
  if (value !== true && value !== false) {
    throw new InventoryApiError(`${field} must be true${nullable ? ', false, or null' : ' or false'}`);
  }
  return value;
}

function normalizeMonths(value, field, { nullable }) {
  if (nullable && value === null) return null;
  const months = Number(value);
  if (![1, 3, 6, 12].includes(months)) {
    throw new InventoryApiError(`${field} must be 1, 3, 6, 12${nullable ? ', or null' : ''}`);
  }
  return months;
}

function normalizePolicyPatch(body, { variant = false } = {}) {
  const value = rejectUnknownFields(body, POLICY_FIELDS);
  const patch = {};
  for (const field of ['serial_tracking_enabled', 'shop_warranty_enabled']) {
    if (Object.hasOwn(value, field)) {
      patch[field] = normalizeBoolean(value[field], field, { nullable: variant });
    }
  }
  if (Object.hasOwn(value, 'shop_warranty_months')) {
    patch.shop_warranty_months = normalizeMonths(
      value.shop_warranty_months,
      'shop_warranty_months',
      { nullable: true }
    );
  }
  if (Object.hasOwn(value, 'serial_numbers')) {
    if (!Array.isArray(value.serial_numbers)) {
      throw new InventoryApiError('serial_numbers must be an array');
    }
    patch.serial_numbers = value.serial_numbers;
  }
  if (Object.hasOwn(value, 'adoption_batches')) {
    if (!Array.isArray(value.adoption_batches)) {
      throw new InventoryApiError('adoption_batches must be an array');
    }
    patch.adoption_batches = value.adoption_batches;
  }
  if (!Object.keys(patch).some((field) => !['serial_numbers', 'adoption_batches'].includes(field))) {
    throw new InventoryApiError('At least one policy field is required');
  }
  return patch;
}

function policyPayload(product, variant = null) {
  const effective = resolveEffectiveStockPolicy(product, variant);
  return {
    product_id: Number(product.id),
    variant_id: variant ? Number(variant.id) : null,
    serial_tracking_enabled: variant
      ? variant.serial_tracking_enabled
      : product.serial_tracking_enabled,
    shop_warranty_enabled: variant
      ? variant.shop_warranty_enabled
      : product.shop_warranty_enabled,
    shop_warranty_months: variant
      ? variant.shop_warranty_months
      : product.shop_warranty_months,
    effective_serial_tracking_enabled: effective.serialTrackingEnabled,
    effective_shop_warranty_enabled: effective.shopWarrantyEligible,
    effective_shop_warranty_months: effective.shopWarrantyMonths,
    serial_tracking_source: effective.serialTrackingSource,
    shop_warranty_source: effective.shopWarrantySource,
  };
}

async function loadPolicyTarget(client, productId, variantId, { lock = false } = {}) {
  const productResult = await client.query(
    `
      SELECT id, sku, name, stock_quantity, is_active,
             serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months
      FROM products
      WHERE id = $1
      ${lock ? 'FOR UPDATE' : ''}
    `,
    [productId]
  );
  const product = productResult.rows[0];
  if (!product || product.is_active !== true) {
    throw new InventoryApiError('Product not found', 404, 'INVENTORY_TARGET_NOT_FOUND');
  }

  if (variantId === null) return { product, variant: null };
  const variantResult = await client.query(
    `
      SELECT id, product_id, sku, name, stock_quantity, is_active,
             serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months
      FROM product_variants
      WHERE id = $1 AND product_id = $2
      ${lock ? 'FOR UPDATE' : ''}
    `,
    [variantId, productId]
  );
  const variant = variantResult.rows[0];
  if (!variant || variant.is_active !== true) {
    throw new InventoryApiError('Variant not found', 404, 'INVENTORY_TARGET_NOT_FOUND');
  }
  return { product, variant };
}

async function updatePolicyOperation(transaction, {
  actorUserId, productId, variantId = null, body,
}) {
  const client = transactionClient(transaction);
  const normalizedProductId = positiveInteger(productId, 'product id');
  const normalizedVariantId = variantId === null
    ? null
    : positiveInteger(variantId, 'variant id');
  const patch = normalizePolicyPatch(body, { variant: normalizedVariantId !== null });
  await revalidateCurrentAdmin(client, actorUserId);

  const { product, variant } = await loadPolicyTarget(
    client,
    normalizedProductId,
    normalizedVariantId,
    { lock: true }
  );
  const before = policyPayload(product, variant);
  const target = variant || product;
  const next = { ...target };
  for (const field of ['serial_tracking_enabled', 'shop_warranty_enabled', 'shop_warranty_months']) {
    if (Object.hasOwn(patch, field)) next[field] = patch[field];
  }
  const afterEffective = variant
    ? resolveEffectiveStockPolicy(product, next)
    : resolveEffectiveStockPolicy(next);

  let policyTargets;
  if (variant) {
    policyTargets = [{
      variantId: normalizedVariantId,
      stockQuantity: Number(variant.stock_quantity),
      beforePolicy: resolveEffectiveStockPolicy(product, variant),
      afterPolicy: afterEffective,
    }];
  } else {
    const variantsResult = await client.query(
      `
        SELECT id, product_id, stock_quantity, is_active,
               serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months
        FROM product_variants
        WHERE product_id = $1 AND is_active = TRUE
        ORDER BY id
        FOR UPDATE
      `,
      [normalizedProductId]
    );
    if (
      variantsResult.rows.length > 0
      && Number(product.stock_quantity) !== 0
      && product.serial_tracking_enabled === false
      && next.serial_tracking_enabled === true
    ) {
      throw new InventoryApiError(
        'Parent stock must be reconciled to zero before enabling inherited variant tracking',
        409,
        'PARENT_VARIANT_STOCK_CONFLICT'
      );
    }
    policyTargets = variantsResult.rows.length > 0
      ? variantsResult.rows.map((row) => ({
        variantId: Number(row.id),
        stockQuantity: Number(row.stock_quantity),
        beforePolicy: resolveEffectiveStockPolicy(product, row),
        afterPolicy: resolveEffectiveStockPolicy(next, row),
      }))
      : [{
        variantId: null,
        stockQuantity: Number(product.stock_quantity),
        beforePolicy: resolveEffectiveStockPolicy(product),
        afterPolicy: afterEffective,
      }];
  }

  const activationTargets = policyTargets.filter((entry) =>
    !entry.beforePolicy.serialTrackingEnabled && entry.afterPolicy.serialTrackingEnabled);
  const deactivationTargets = policyTargets.filter((entry) =>
    entry.beforePolicy.serialTrackingEnabled && !entry.afterPolicy.serialTrackingEnabled);

  for (const entry of [...activationTargets, ...deactivationTargets]) {
    const counts = await client.query(
      `
        SELECT COUNT(*)::integer AS total,
               COUNT(*) FILTER (WHERE state <> 'retired')::integer AS live
        FROM stock_units
        WHERE product_id = $1
          AND variant_id IS NOT DISTINCT FROM $2::integer
      `,
      [normalizedProductId, entry.variantId]
    );
    if (activationTargets.includes(entry) && Number(counts.rows[0].total) > 0) {
      throw new InventoryApiError(
        'Serial tracking activation found existing stock-unit records',
        409,
        'SERIAL_ADOPTION_CONFLICT'
      );
    }
    if (deactivationTargets.includes(entry) && Number(counts.rows[0].live) > 0) {
      throw new InventoryApiError(
        'Serial tracking cannot be disabled while live stock units exist',
        409,
        'LIVE_SERIALIZED_UNITS_EXIST'
      );
    }
  }

  const adoptionSerials = new Map();
  if (patch.serial_numbers !== undefined) {
    if (policyTargets.length !== 1) {
      throw new InventoryApiError(
        'Use adoption_batches when product policy activation affects variants'
      );
    }
    adoptionSerials.set(policyTargets[0].variantId, patch.serial_numbers);
  }
  if (patch.adoption_batches !== undefined) {
    if (variant) throw new InventoryApiError('adoption_batches are valid only for product policies');
    for (const rawBatch of patch.adoption_batches) {
      const batch = rejectUnknownFields(rawBatch, ['variant_id', 'serial_numbers'], 'adoption batch');
      const batchVariantId = positiveInteger(batch.variant_id, 'adoption batch variant_id');
      if (!Array.isArray(batch.serial_numbers)) {
        throw new InventoryApiError('adoption batch serial_numbers must be an array');
      }
      if (adoptionSerials.has(batchVariantId)) {
        throw new InventoryApiError(`Duplicate adoption batch for variant ${batchVariantId}`);
      }
      adoptionSerials.set(batchVariantId, batch.serial_numbers);
    }
  }
  if (activationTargets.length === 0 && adoptionSerials.size > 0) {
    throw new InventoryApiError('Adoption serials are allowed only when activating serial tracking');
  }
  const activationIds = new Set(activationTargets.map((entry) => entry.variantId));
  for (const variantKey of adoptionSerials.keys()) {
    if (!activationIds.has(variantKey)) {
      throw new InventoryApiError('Adoption batch does not match an activated inventory target');
    }
  }

  const table = variant ? 'product_variants' : 'products';
  const updatedResult = await client.query(
    `
      UPDATE ${table}
      SET serial_tracking_enabled = $1,
          shop_warranty_enabled = $2,
          shop_warranty_months = $3,
          updated_at = NOW()
      WHERE id = $4
      RETURNING id, ${variant ? 'product_id,' : ''} sku, name, stock_quantity, is_active,
                serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months
    `,
    [
      next.serial_tracking_enabled,
      next.shop_warranty_enabled,
      next.shop_warranty_months,
      target.id,
    ]
  );
  const updatedTarget = updatedResult.rows[0];

  const adoptionTargets = activationTargets.filter((entry) => entry.stockQuantity > 0);
  for (const entry of adoptionTargets) {
    if (!adoptionSerials.has(entry.variantId)) {
      throw new InventoryApiError(
        'Serial numbers are required to adopt every affected inventory target',
        409,
        'SERIAL_ADOPTION_REQUIRED'
      );
    }
  }
  for (const entry of activationTargets.filter((candidate) => candidate.stockQuantity === 0)) {
    if ((adoptionSerials.get(entry.variantId) || []).length > 0) {
      throw new InventoryApiError('A zero-stock target must not include adoption serial numbers');
    }
  }
  if (adoptionTargets.length > 0) {
    await adoptExistingInventory(transaction, {
      actorUserId,
      batches: adoptionTargets.map((entry) => ({
        productId: normalizedProductId,
        variantId: entry.variantId,
        serialNumbers: adoptionSerials.get(entry.variantId),
      })),
    });
  }

  const after = policyPayload(
    variant ? product : updatedTarget,
    variant ? updatedTarget : null
  );
  await client.query(
    `INSERT INTO audit_log (user_id, action, details) VALUES ($1, $2, $3)`,
    [
      actorUserId,
      variant ? 'UPDATE_VARIANT_INVENTORY_POLICY' : 'UPDATE_PRODUCT_INVENTORY_POLICY',
      JSON.stringify({
        before,
        after,
        adoptedUnits: adoptionTargets.reduce((sum, entry) => sum + entry.stockQuantity, 0),
      }),
    ]
  );
  return after;
}

function updateInventoryPolicy(transaction, input) {
  return withTransactionOperation(transaction, 'update_policy', () =>
    updatePolicyOperation(transaction, input)
  );
}

module.exports = {
  POLICY_FIELDS,
  loadPolicyTarget,
  normalizePolicyPatch,
  policyPayload,
  updateInventoryPolicy,
};
