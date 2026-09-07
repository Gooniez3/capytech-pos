export const PAYMENT_METHODS = Object.freeze([
  { value: 'cash', label: 'Cash' },
  { value: 'banking', label: 'Banking' },
  { value: 'kbzpay', label: 'KBZPay' },
  { value: 'wavepay', label: 'WavePay' },
  { value: 'mmqr', label: 'MMQR' },
]);

export const DEFAULT_PAYMENT_METHOD = 'cash';

export function checkoutRequestBody({
  items,
  paymentMethod = DEFAULT_PAYMENT_METHOD,
  customer = null,
  idempotencyKey,
}) {
  return {
    items,
    payment_method: paymentMethod,
    idempotency_key: idempotencyKey,
    customer_id: customer?.id ?? null,
  };
}
