const ALLOWED_PAYMENT_METHODS = Object.freeze([
  'cash',
  'banking',
  'kbzpay',
  'wavepay',
  'mmqr',
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN = /^\d+$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d{1,2})?$/;

const POSTGRES_INTEGER_MAX = 2147483647;
const POSTGRES_NUMERIC_10_2_MAX_MINOR = 9999999999;
const MAX_CHECKOUT_LINES = 100;
const MAX_CUSTOMER_ADDRESS_LENGTH = 2000;
const { normalizeWarrantySelection } = require('./warranty');

class CheckoutValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutValidationError';
    this.statusCode = 400;
  }
}

function assertPlainObject(value, fieldName = 'Request body') {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new CheckoutValidationError(`${fieldName} must be a JSON object`);
  }
  return value;
}

function normalizeRequiredInteger(value, fieldName) {
  let normalized;

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new CheckoutValidationError(`${fieldName} must be a positive integer`);
    }
    normalized = value;
  } else if (typeof value === 'string') {
    const candidate = value.trim();
    if (!POSITIVE_INTEGER_PATTERN.test(candidate)) {
      throw new CheckoutValidationError(`${fieldName} must be a positive integer`);
    }
    normalized = Number(candidate);
  } else {
    throw new CheckoutValidationError(`${fieldName} must be a positive integer`);
  }

  if (
    !Number.isSafeInteger(normalized) ||
    normalized <= 0 ||
    normalized > POSTGRES_INTEGER_MAX
  ) {
    throw new CheckoutValidationError(`${fieldName} must be a positive integer`);
  }

  return normalized;
}

function normalizeOptionalInteger(value, fieldName) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }
  return normalizeRequiredInteger(value, fieldName);
}

function normalizePaymentMethod(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CheckoutValidationError('payment_method is required');
  }

  const normalized = value.trim().toLowerCase();
  if (!ALLOWED_PAYMENT_METHODS.includes(normalized)) {
    throw new CheckoutValidationError('Unsupported payment_method');
  }
  return normalized;
}

function normalizeRequiredIdempotencyKey(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CheckoutValidationError('Checkout idempotency key is required');
  }

  const key = value.trim();
  if (!UUID_PATTERN.test(key)) {
    throw new CheckoutValidationError('Invalid checkout idempotency key');
  }
  return key.toLowerCase();
}

function decimalParts(value, fieldName) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new CheckoutValidationError(`${fieldName} must be a valid monetary amount`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new CheckoutValidationError(`${fieldName} must be a finite number`);
  }

  const candidate = typeof value === 'string' ? value.trim() : String(value);
  if (!DECIMAL_PATTERN.test(candidate)) {
    throw new CheckoutValidationError(`${fieldName} must have at most two decimal places`);
  }

  const [wholePart, fractionalPart = ''] = candidate.split('.');
  const whole = Number(wholePart);
  const fraction = Number(fractionalPart.padEnd(2, '0'));
  const minorUnits = whole * 100 + fraction;

  if (!Number.isSafeInteger(minorUnits)) {
    throw new CheckoutValidationError(`${fieldName} is too large`);
  }
  return minorUnits;
}

function assertNumericRange(minorUnits, fieldName) {
  if (
    !Number.isSafeInteger(minorUnits) ||
    minorUnits < 0 ||
    minorUnits > POSTGRES_NUMERIC_10_2_MAX_MINOR
  ) {
    throw new CheckoutValidationError(`${fieldName} exceeds the supported monetary range`);
  }
  return minorUnits;
}

function minorUnitsToDatabaseDecimal(minorUnits) {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new CheckoutValidationError('Invalid monetary amount');
  }
  return `${Math.floor(minorUnits / 100)}.${String(minorUnits % 100).padStart(2, '0')}`;
}

function minorUnitsToCanonicalDecimal(minorUnits) {
  const fixed = minorUnitsToDatabaseDecimal(minorUnits);
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function normalizeDiscount(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return { minorUnits: 0, canonical: '0' };
  }

  const minorUnits = assertNumericRange(decimalParts(value, 'discount'), 'discount');
  return {
    minorUnits,
    canonical: minorUnitsToCanonicalDecimal(minorUnits),
  };
}

function normalizeCustomerText(value, fieldName, maximumLength) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new CheckoutValidationError(`${fieldName} must be text`);
  }

  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximumLength) {
    throw new CheckoutValidationError(`${fieldName} must be ${maximumLength} characters or fewer`);
  }
  return normalized;
}

function storedCustomerText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function customerIdentityForFingerprint(intent) {
  if (intent.customer_id !== null) {
    return {
      id: intent.customer_id,
      name: null,
      phone: null,
      email: null,
      address: null,
    };
  }

  return {
    id: null,
    name: intent.customer_name,
    phone: intent.customer_phone,
    email: intent.customer_email,
    address: intent.customer_address,
  };
}

function resolveCheckoutCustomerSnapshot(intent, databaseCustomer = null) {
  if (intent.customer_id === null) {
    return {
      customer_id: null,
      customer_name: intent.customer_name,
      customer_phone: intent.customer_phone,
      customer_email: intent.customer_email,
      customer_address: intent.customer_address,
    };
  }

  if (!databaseCustomer || Number(databaseCustomer.id) !== intent.customer_id) {
    throw new CheckoutValidationError('Customer not found');
  }

  return {
    customer_id: intent.customer_id,
    customer_name: storedCustomerText(databaseCustomer.name),
    customer_phone: storedCustomerText(databaseCustomer.phone),
    customer_email: storedCustomerText(databaseCustomer.email),
    customer_address: storedCustomerText(databaseCustomer.address),
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CheckoutValidationError('Cart is empty');
  }
  if (items.length > MAX_CHECKOUT_LINES) {
    throw new CheckoutValidationError(`Checkout cannot contain more than ${MAX_CHECKOUT_LINES} lines`);
  }

  const aggregated = new Map();
  for (const rawItem of items) {
    assertPlainObject(rawItem, 'Each checkout item');
    const productId = normalizeRequiredInteger(rawItem.product_id, 'product_id');
    const variantId = normalizeOptionalInteger(rawItem.variant_id, 'variant_id');
    const quantity = normalizeRequiredInteger(rawItem.quantity, 'quantity');
    const key = `${productId}:${variantId === null ? 'null' : variantId}`;
    const aggregate = (aggregated.get(key)?.quantity || 0) + quantity;

    if (!Number.isSafeInteger(aggregate) || aggregate > POSTGRES_INTEGER_MAX) {
      throw new CheckoutValidationError('Aggregated quantity is too large');
    }
    aggregated.set(key, {
      product_id: productId,
      variant_id: variantId,
      quantity: aggregate,
    });
  }

  if (aggregated.size > MAX_CHECKOUT_LINES) {
    throw new CheckoutValidationError(`Checkout cannot contain more than ${MAX_CHECKOUT_LINES} inventory targets`);
  }

  return [...aggregated.values()].sort((left, right) =>
    left.product_id - right.product_id ||
    (left.variant_id === right.variant_id
      ? 0
      : left.variant_id === null
        ? -1
        : right.variant_id === null
          ? 1
          : left.variant_id - right.variant_id)
  );
}

function normalizeStockUnitId(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text)) {
    throw new CheckoutValidationError('stock_unit_ids must contain positive integer IDs');
  }
  return text;
}

function normalizeV2Items(items) {
  if (!Array.isArray(items) || items.length === 0) throw new CheckoutValidationError('Cart is empty');
  if (items.length > MAX_CHECKOUT_LINES) {
    throw new CheckoutValidationError(`Checkout cannot contain more than ${MAX_CHECKOUT_LINES} lines`);
  }
  const allowed = new Set(['product_id', 'variant_id', 'quantity', 'stock_unit_ids']);
  const targets = new Map();
  const allUnitIds = new Set();
  for (const rawItem of items) {
    assertPlainObject(rawItem, 'Each checkout item');
    const unknown = Object.keys(rawItem).find((key) => !allowed.has(key));
    if (unknown) throw new CheckoutValidationError(`Unknown checkout item field: ${unknown}`);
    const productId = normalizeRequiredInteger(rawItem.product_id, 'product_id');
    const variantId = normalizeOptionalInteger(rawItem.variant_id, 'variant_id');
    const quantity = normalizeRequiredInteger(rawItem.quantity, 'quantity');
    const unitIds = rawItem.stock_unit_ids === undefined ? [] : rawItem.stock_unit_ids;
    if (!Array.isArray(unitIds)) throw new CheckoutValidationError('stock_unit_ids must be an array');
    const normalizedIds = unitIds.map(normalizeStockUnitId);
    for (const id of normalizedIds) {
      if (allUnitIds.has(id)) throw new CheckoutValidationError('Stock unit IDs must be unique across the cart');
      allUnitIds.add(id);
    }
    const key = `${productId}:${variantId === null ? 'null' : variantId}`;
    if (targets.has(key)) throw new CheckoutValidationError('V2 checkout inventory targets must be unique');
    targets.set(key, {
      product_id: productId,
      variant_id: variantId,
      quantity,
      stock_unit_ids: normalizedIds.sort((left, right) => {
        const a = BigInt(left); const b = BigInt(right);
        return a < b ? -1 : a > b ? 1 : 0;
      }),
    });
  }
  return [...targets.values()].sort((left, right) =>
    left.product_id - right.product_id ||
    (left.variant_id === right.variant_id ? 0 : left.variant_id === null ? -1 : right.variant_id === null ? 1 : left.variant_id - right.variant_id)
  );
}

function normalizeCheckoutIntent(input) {
  assertPlainObject(input);
  const contractVersion = input.checkout_contract_version === undefined
    ? 1
    : normalizeRequiredInteger(input.checkout_contract_version, 'checkout_contract_version');
  if (![1, 2].includes(contractVersion)) {
    throw new CheckoutValidationError('checkout_contract_version must be 1 or 2');
  }
  const discount = normalizeDiscount(input.discount);
  return {
    checkout_contract_version: contractVersion,
    items: contractVersion === 2 ? normalizeV2Items(input.items) : normalizeItems(input.items),
    payment_method: normalizePaymentMethod(input.payment_method),
    discount: discount.canonical,
    discount_minor_units: discount.minorUnits,
    warranty_months: normalizeWarrantySelection(
      input.warranty_months,
      { allowAutomatic: true }
    ),
    customer_id: normalizeOptionalInteger(input.customer_id, 'customer_id'),
    customer_name: normalizeCustomerText(input.customer_name, 'customer_name', 200),
    customer_phone: normalizeCustomerText(input.customer_phone, 'customer_phone', 50),
    customer_email: normalizeCustomerText(input.customer_email, 'customer_email', 200),
    customer_address: normalizeCustomerText(
      input.customer_address,
      'customer_address',
      MAX_CUSTOMER_ADDRESS_LENGTH
    ),
  };
}

function validateCheckoutRequest(body) {
  assertPlainObject(body);
  const requestedVersion = body.checkout_contract_version === undefined
    ? 1 : normalizeRequiredInteger(body.checkout_contract_version, 'checkout_contract_version');
  if (requestedVersion === 2) {
    const allowed = new Set([
      'checkout_contract_version', 'idempotency_key', 'items', 'payment_method', 'discount',
      'customer_id', 'customer_name', 'customer_phone', 'customer_email', 'customer_address',
    ]);
    const unknown = Object.keys(body).find((key) => !allowed.has(key));
    if (unknown) throw new CheckoutValidationError(`Unknown checkout field: ${unknown}`);
  }
  return {
    idempotency_key: normalizeRequiredIdempotencyKey(body.idempotency_key),
    ...normalizeCheckoutIntent(body),
  };
}

function authoritativeDecimalToMinorUnits(value, fieldName) {
  return assertNumericRange(decimalParts(value, fieldName), fieldName);
}

function checkedLineTotal(unitMinorUnits, quantity) {
  const result = unitMinorUnits * quantity;
  if (!Number.isSafeInteger(result)) {
    throw new CheckoutValidationError('Line total exceeds safe arithmetic range');
  }
  return assertNumericRange(result, 'line_total');
}

function checkedSubtotal(currentMinorUnits, lineMinorUnits) {
  const result = currentMinorUnits + lineMinorUnits;
  if (!Number.isSafeInteger(result)) {
    throw new CheckoutValidationError('Subtotal exceeds safe arithmetic range');
  }
  return assertNumericRange(result, 'subtotal');
}

function assertDiscountWithinSubtotal(discountMinorUnits, subtotalMinorUnits) {
  if (discountMinorUnits > subtotalMinorUnits) {
    throw new CheckoutValidationError('Discount cannot exceed subtotal');
  }
}

const ALLOWED_STORE_TAX_RATES = Object.freeze([0, 5, 10]);

function parseStoreTaxRatePercent(value) {
  const hundredths = decimalParts(value, 'tax_rate');
  if (hundredths % 100 !== 0) {
    throw new CheckoutValidationError('Store tax rate is invalid');
  }

  const percent = hundredths / 100;
  if (!ALLOWED_STORE_TAX_RATES.includes(percent)) {
    throw new CheckoutValidationError('Store tax rate is invalid');
  }

  return percent;
}

function taxMinorUnitsOnNet(netMinorUnits, taxRatePercent) {
  if (!Number.isSafeInteger(netMinorUnits) || netMinorUnits < 0) {
    throw new CheckoutValidationError('Taxable amount exceeds the supported monetary range');
  }

  assertNumericRange(netMinorUnits, 'taxable amount');

  if (!ALLOWED_STORE_TAX_RATES.includes(taxRatePercent)) {
    throw new CheckoutValidationError('Store tax rate is invalid');
  }

  if (taxRatePercent === 0 || netMinorUnits === 0) {
    return 0;
  }

  const rateHundredths = taxRatePercent * 100;
  const product = netMinorUnits * rateHundredths;
  if (!Number.isSafeInteger(product)) {
    throw new CheckoutValidationError('Tax exceeds safe arithmetic range');
  }

  return assertNumericRange(Math.round(product / 10000), 'tax');
}

module.exports = {
  ALLOWED_PAYMENT_METHODS,
  ALLOWED_STORE_TAX_RATES,
  CheckoutValidationError,
  MAX_CHECKOUT_LINES,
  POSTGRES_INTEGER_MAX,
  POSTGRES_NUMERIC_10_2_MAX_MINOR,
  assertDiscountWithinSubtotal,
  assertNumericRange,
  assertPlainObject,
  authoritativeDecimalToMinorUnits,
  checkedLineTotal,
  checkedSubtotal,
  customerIdentityForFingerprint,
  minorUnitsToCanonicalDecimal,
  minorUnitsToDatabaseDecimal,
  normalizeCheckoutIntent,
  normalizeDiscount,
  normalizeItems,
  normalizeV2Items,
  normalizeOptionalInteger,
  normalizePaymentMethod,
  normalizeRequiredIdempotencyKey,
  normalizeRequiredInteger,
  normalizeWarrantySelection,
  parseStoreTaxRatePercent,
  resolveCheckoutCustomerSnapshot,
  taxMinorUnitsOnNet,
  validateCheckoutRequest,
};
