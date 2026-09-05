const crypto = require('crypto');

const ALLOWED_PAYMENT_METHODS = Object.freeze([
  'cash',
  'banking',
  'kbzpay',
  'wavepay',
  'mmqr',
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CheckoutIntentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutIntentError';
    this.statusCode = 400;
  }
}

class CheckoutIdempotencyConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutIdempotencyConflictError';
    this.statusCode = 409;
  }
}

function normalizeRequiredId(value, fieldName) {
  const candidate =
    typeof value === 'string'
      ? value.trim()
      : value;
  const number = Number(candidate);

  if (
    candidate === '' ||
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    number > 2147483647
  ) {
    throw new CheckoutIntentError(`${fieldName} must be a positive integer`);
  }

  return number;
}

function normalizeOptionalId(value, fieldName) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }

  return normalizeRequiredId(value, fieldName);
}

function normalizeQuantity(value) {
  return normalizeRequiredId(value, 'quantity');
}

function normalizePaymentMethod(value) {
  return ALLOWED_PAYMENT_METHODS.includes(value)
    ? value
    : 'cash';
}

function normalizeRequiredIdempotencyKey(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CheckoutIntentError('Checkout idempotency key is required');
  }

  const key = value.trim();

  if (!UUID_PATTERN.test(key)) {
    throw new CheckoutIntentError('Invalid checkout idempotency key');
  }

  return key;
}

function normalizeDiscount(value) {
  const number = Math.max(0, Number(value) || 0);

  if (!Number.isFinite(number)) {
    throw new CheckoutIntentError('discount must be a finite number');
  }

  return Object.is(number, -0) ? '0' : String(number);
}

function normalizeCustomerText(value, fieldName) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new CheckoutIntentError(`${fieldName} must be text`);
  }

  return value.trim() || null;
}

function canonicalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CheckoutIntentError('Cart is empty');
  }

  const aggregated = new Map();

  for (const item of items) {
    const productId = normalizeRequiredId(item?.product_id, 'product_id');
    const variantId = normalizeOptionalId(item?.variant_id, 'variant_id');
    const quantity = normalizeQuantity(item?.quantity);
    const key = `${productId}:${variantId === null ? 'null' : variantId}`;
    const existing = aggregated.get(key);
    const totalQuantity = (existing?.quantity || 0) + quantity;

    if (!Number.isSafeInteger(totalQuantity) || totalQuantity > 2147483647) {
      throw new CheckoutIntentError('quantity is too large');
    }

    aggregated.set(key, {
      product_id: productId,
      variant_id: variantId,
      quantity: totalQuantity,
    });
  }

  return [...aggregated.values()].sort((left, right) => {
    if (left.product_id !== right.product_id) {
      return left.product_id - right.product_id;
    }

    if (left.variant_id === right.variant_id) {
      return 0;
    }

    if (left.variant_id === null) {
      return -1;
    }

    if (right.variant_id === null) {
      return 1;
    }

    return left.variant_id - right.variant_id;
  });
}

function canonicalizeCheckoutIntent({
  user_id,
  items,
  payment_method,
  discount,
  customer_id,
  customer_name,
  customer_phone,
  customer_email,
  customer_address,
}) {
  return {
    version: 1,
    user_id: normalizeRequiredId(user_id, 'user_id'),
    items: canonicalizeItems(items),
    payment_method: normalizePaymentMethod(payment_method),
    discount: normalizeDiscount(discount),
    customer: {
      id: normalizeOptionalId(customer_id, 'customer_id'),
      name: normalizeCustomerText(customer_name, 'customer_name'),
      phone: normalizeCustomerText(customer_phone, 'customer_phone'),
      email: normalizeCustomerText(customer_email, 'customer_email'),
      address: normalizeCustomerText(customer_address, 'customer_address'),
    },
  };
}

function serializeCheckoutIntent(input) {
  return JSON.stringify(canonicalizeCheckoutIntent(input));
}

function createCheckoutFingerprint(input) {
  return crypto
    .createHash('sha256')
    .update(serializeCheckoutIntent(input), 'utf8')
    .digest();
}

function assertCheckoutFingerprintMatches(existingSale, fingerprint) {
  const existingFingerprint = existingSale.checkout_request_fingerprint;

  if (existingFingerprint === null || existingFingerprint === undefined) {
    throw new CheckoutIdempotencyConflictError(
      'This checkout key belongs to a legacy sale and cannot be safely replayed; verify the original sale before starting a new checkout'
    );
  }

  if (
    !Buffer.isBuffer(existingFingerprint) ||
    existingFingerprint.length !== fingerprint.length ||
    !crypto.timingSafeEqual(existingFingerprint, fingerprint)
  ) {
    throw new CheckoutIdempotencyConflictError(
      'This checkout key has already been used for a different checkout request'
    );
  }
}

async function findExistingCheckout(queryable, idempotencyKey, fingerprint) {
  const saleResult = await queryable.query(
    `
      SELECT *
      FROM sales
      WHERE idempotency_key = $1
      LIMIT 1
    `,
    [idempotencyKey]
  );
  const sale = saleResult.rows[0];

  if (!sale) {
    return null;
  }

  assertCheckoutFingerprintMatches(sale, fingerprint);

  const itemsResult = await queryable.query(
    `
      SELECT *
      FROM sale_items
      WHERE sale_id = $1
      ORDER BY id
    `,
    [sale.id]
  );

  return {
    sale,
    items: itemsResult.rows,
  };
}

module.exports = {
  ALLOWED_PAYMENT_METHODS,
  CheckoutIdempotencyConflictError,
  CheckoutIntentError,
  assertCheckoutFingerprintMatches,
  canonicalizeCheckoutIntent,
  createCheckoutFingerprint,
  findExistingCheckout,
  normalizeDiscount,
  normalizePaymentMethod,
  normalizeRequiredIdempotencyKey,
  serializeCheckoutIntent,
};
