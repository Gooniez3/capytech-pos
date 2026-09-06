const crypto = require('crypto');
const {
  ALLOWED_PAYMENT_METHODS,
  CheckoutValidationError,
  normalizeCheckoutIntent,
  normalizeDiscount: normalizeDiscountValue,
  normalizePaymentMethod,
  normalizeRequiredIdempotencyKey,
  normalizeRequiredInteger,
} = require('./checkout-validation');

const CheckoutIntentError = CheckoutValidationError;

class CheckoutIdempotencyConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckoutIdempotencyConflictError';
    this.statusCode = 409;
  }
}

function normalizeDiscount(value) {
  return normalizeDiscountValue(value).canonical;
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
  const normalized = normalizeCheckoutIntent({
    items,
    payment_method,
    discount,
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    customer_address,
  });

  return {
    version: 1,
    user_id: normalizeRequiredInteger(user_id, 'user_id'),
    items: normalized.items,
    payment_method: normalized.payment_method,
    discount: normalized.discount,
    customer: {
      id: normalized.customer_id,
      name: normalized.customer_name,
      phone: normalized.customer_phone,
      email: normalized.customer_email,
      address: normalized.customer_address,
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
