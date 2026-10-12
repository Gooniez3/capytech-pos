const ALLOWED_SHOP_WARRANTY_MONTHS = Object.freeze([1, 3, 6, 12]);

class StockPolicyError extends Error {
  constructor(message, code = 'INVALID_STOCK_POLICY') {
    super(message);
    this.name = 'StockPolicyError';
    this.code = code;
    this.statusCode = 409;
  }
}

function booleanOrNull(value, field) {
  if (value === null || value === undefined) return null;
  if (value !== true && value !== false) {
    throw new StockPolicyError(`${field} must be boolean or null`);
  }
  return value;
}

function warrantyMonthsOrNull(value, field) {
  if (value === null || value === undefined) return null;
  const months = Number(value);
  if (!Number.isInteger(months) || !ALLOWED_SHOP_WARRANTY_MONTHS.includes(months)) {
    throw new StockPolicyError(`${field} must be 1, 3, 6, or 12 months`);
  }
  return months;
}

function validateWarrantyPolicy(enabled, months, owner) {
  if (enabled && months === null) {
    throw new StockPolicyError(`${owner} warranty duration is required when enabled`);
  }
  if (!enabled && months !== null) {
    throw new StockPolicyError(`${owner} warranty duration must be null when disabled`);
  }
}

function resolveEffectiveStockPolicy(product, variant = null) {
  if (!product || typeof product !== 'object') {
    throw new StockPolicyError('Product policy is required');
  }

  const productSerial = booleanOrNull(
    product.serial_tracking_enabled,
    'product serial tracking'
  );
  const productWarranty = booleanOrNull(
    product.shop_warranty_enabled,
    'product shop warranty'
  );
  const productMonths = warrantyMonthsOrNull(
    product.shop_warranty_months,
    'product shop warranty duration'
  );
  if (productSerial === null || productWarranty === null) {
    throw new StockPolicyError('Product policy fields cannot be null');
  }
  validateWarrantyPolicy(productWarranty, productMonths, 'Product');

  if (!variant) {
    return Object.freeze({
      serialTrackingEnabled: productSerial,
      shopWarrantyEligible: productWarranty,
      shopWarrantyMonths: productWarranty ? productMonths : null,
      serialTrackingSource: 'product',
      shopWarrantySource: 'product',
    });
  }

  if (
    variant.product_id !== undefined
    && product.id !== undefined
    && Number(variant.product_id) !== Number(product.id)
  ) {
    throw new StockPolicyError('Variant does not belong to the product');
  }

  const variantSerial = booleanOrNull(
    variant.serial_tracking_enabled,
    'variant serial tracking override'
  );
  const variantWarranty = booleanOrNull(
    variant.shop_warranty_enabled,
    'variant shop warranty override'
  );
  const variantMonths = warrantyMonthsOrNull(
    variant.shop_warranty_months,
    'variant shop warranty duration'
  );

  if (variantWarranty === null && variantMonths !== null) {
    throw new StockPolicyError('Inheriting variant warranty duration must be null');
  }
  if (variantWarranty !== null) {
    validateWarrantyPolicy(variantWarranty, variantMonths, 'Variant');
  }

  const effectiveWarranty = variantWarranty ?? productWarranty;
  const effectiveMonths = variantWarranty === null ? productMonths : variantMonths;
  return Object.freeze({
    serialTrackingEnabled: variantSerial ?? productSerial,
    shopWarrantyEligible: effectiveWarranty,
    shopWarrantyMonths: effectiveWarranty ? effectiveMonths : null,
    serialTrackingSource: variantSerial === null ? 'product' : 'variant',
    shopWarrantySource: variantWarranty === null ? 'product' : 'variant',
  });
}

module.exports = {
  ALLOWED_SHOP_WARRANTY_MONTHS,
  StockPolicyError,
  resolveEffectiveStockPolicy,
};
