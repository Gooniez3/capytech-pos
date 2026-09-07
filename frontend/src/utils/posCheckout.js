export const PAYMENT_METHODS = Object.freeze([
  { value: 'cash', label: 'Cash' },
  { value: 'banking', label: 'Banking' },
  { value: 'kbzpay', label: 'KBZPay' },
  { value: 'wavepay', label: 'WavePay' },
  { value: 'mmqr', label: 'MMQR' },
]);

export const DEFAULT_PAYMENT_METHOD = 'cash';

const DISCOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

export function parseCheckoutDiscount(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { canonical: '0', amount: 0, error: null };
  }

  const candidate = String(value).trim();
  if (!DISCOUNT_PATTERN.test(candidate)) {
    return {
      canonical: null,
      amount: null,
      error: 'Discount must have at most two decimal places',
    };
  }

  const amount = Number(candidate);
  if (!Number.isFinite(amount) || amount < 0) {
    return { canonical: null, amount: null, error: 'Discount must be a valid amount' };
  }

  return { canonical: candidate.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'), amount, error: null };
}

export function checkoutRequestBody({
  items,
  paymentMethod = DEFAULT_PAYMENT_METHOD,
  customer = null,
  discount = null,
  idempotencyKey,
}) {
  const parsedDiscount = parseCheckoutDiscount(discount);
  return {
    items,
    payment_method: paymentMethod,
    idempotency_key: idempotencyKey,
    customer_id: customer?.id ?? null,
    discount: parsedDiscount.error ? '0' : parsedDiscount.canonical,
  };
}
