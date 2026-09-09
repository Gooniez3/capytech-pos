const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWED_PAYMENT_METHODS,
  CheckoutValidationError,
  POSTGRES_INTEGER_MAX,
  POSTGRES_NUMERIC_10_2_MAX_MINOR,
  assertDiscountWithinSubtotal,
  authoritativeDecimalToMinorUnits,
  checkedLineTotal,
  checkedSubtotal,
  customerIdentityForFingerprint,
  minorUnitsToDatabaseDecimal,
  normalizeCheckoutIntent,
  normalizeDiscount,
  normalizeItems,
  normalizePaymentMethod,
  normalizeRequiredIdempotencyKey,
  normalizeRequiredInteger,
  parseStoreTaxRatePercent,
  resolveCheckoutCustomerSnapshot,
  taxMinorUnitsOnNet,
  validateCheckoutRequest,
} = require('./checkout-validation');

const validBody = () => ({
  idempotency_key: '123e4567-e89b-42d3-a456-426614174000',
  items: [{ product_id: 5, quantity: 1 }],
  payment_method: 'cash',
});

test('accepts a normal plain checkout body', () => {
  assert.equal(validateCheckoutRequest(validBody()).items[0].quantity, 1);
});

for (const [name, body] of [
  ['null', null],
  ['array', []],
  ['string', 'checkout'],
  ['number', 4],
  ['boolean', true],
]) {
  test(`rejects a ${name} request body`, () => {
    assert.throws(() => validateCheckoutRequest(body), CheckoutValidationError);
  });
}

for (const [value, expected] of [[1, 1], [25, 25], ['1', 1], ['25', 25], [' 25 ', 25]]) {
  test(`strict integer accepts ${JSON.stringify(value)}`, () => {
    assert.equal(normalizeRequiredInteger(value, 'quantity'), expected);
  });
}

for (const value of [
  0, -1, 1.5, true, false, [2], { value: 2 }, NaN, Infinity,
  '0x10', '1e2', '2.0', 'abc', '', POSTGRES_INTEGER_MAX + 1,
]) {
  test(`strict integer rejects ${String(value)}`, () => {
    assert.throws(() => normalizeRequiredInteger(value, 'quantity'), CheckoutValidationError);
  });
}

test('items must be non-empty and are limited to 100 submitted lines', () => {
  assert.throws(() => normalizeItems([]), /Cart is empty/);
  assert.throws(
    () => normalizeItems(Array.from({ length: 101 }, (_, index) => ({
      product_id: index + 1,
      quantity: 1,
    }))),
    /more than 100 lines/
  );
});

test('duplicate targets aggregate once while variants of one parent remain separate', () => {
  assert.deepEqual(normalizeItems([
    { product_id: 5, quantity: 1 },
    { product_id: '5', variant_id: '', quantity: '2' },
    { product_id: 5, variant_id: 10, quantity: 1 },
    { product_id: 5, variant_id: 11, quantity: 1 },
  ]), [
    { product_id: 5, variant_id: null, quantity: 3 },
    { product_id: 5, variant_id: 10, quantity: 1 },
    { product_id: 5, variant_id: 11, quantity: 1 },
  ]);
});

test('aggregated quantity overflow is rejected', () => {
  assert.throws(() => normalizeItems([
    { product_id: 5, quantity: POSTGRES_INTEGER_MAX },
    { product_id: 5, quantity: 1 },
  ]), /Aggregated quantity/);
});

test('100 distinct targets are accepted and a 101st submitted target is rejected', () => {
  const hundred = Array.from({ length: 100 }, (_, index) => ({ product_id: index + 1, quantity: 1 }));
  assert.equal(normalizeItems(hundred).length, 100);
  assert.throws(() => normalizeItems([...hundred, { product_id: 101, quantity: 1 }]));
});

test('all supported payment methods are accepted', () => {
  for (const method of ALLOWED_PAYMENT_METHODS) {
    assert.equal(normalizePaymentMethod(method), method);
  }
});

test('payment method normalizes case and whitespace', () => {
  assert.equal(normalizePaymentMethod(' CASH '), 'cash');
  assert.equal(normalizePaymentMethod(' WavePay '), 'wavepay');
});

for (const value of [undefined, null, '', 'card', 1, true]) {
  test(`payment method rejects ${String(value)} without a cash fallback`, () => {
    assert.throws(() => normalizePaymentMethod(value), CheckoutValidationError);
  });
}

for (const value of [undefined, null, '', ' ']) {
  test(`discount ${String(value)} normalizes to zero`, () => {
    assert.deepEqual(normalizeDiscount(value), { minorUnits: 0, canonical: '0' });
  });
}

for (const [value, minorUnits, canonical] of [
  [0, 0, '0'], [12, 1200, '12'], [1.5, 150, '1.5'], ['10.25', 1025, '10.25'],
]) {
  test(`valid discount ${value} is exact`, () => {
    assert.deepEqual(normalizeDiscount(value), { minorUnits, canonical });
  });
}

for (const value of [-1, '-1', 'abc', true, [], {}, '1e2', '0x10', '1.234', Infinity, NaN]) {
  test(`invalid discount ${String(value)} is rejected`, () => {
    assert.throws(() => normalizeDiscount(value), CheckoutValidationError);
  });
}

test('discount must not exceed authoritative subtotal', () => {
  assert.doesNotThrow(() => assertDiscountWithinSubtotal(100, 100));
  assert.throws(() => assertDiscountWithinSubtotal(101, 100), /exceed subtotal/);
});

test('customer text is trimmed, bounded, and empty values become null', () => {
  const normalized = normalizeCheckoutIntent({
    items: [{ product_id: 1, quantity: 1 }],
    payment_method: 'cash',
    customer_name: ' Ada ',
    customer_phone: '',
  });
  assert.equal(normalized.customer_name, 'Ada');
  assert.equal(normalized.customer_phone, null);
  assert.throws(() => normalizeCheckoutIntent({
    items: [{ product_id: 1, quantity: 1 }],
    payment_method: 'cash',
    customer_name: 'x'.repeat(201),
  }), /200 characters/);
});

test('money converts exactly to and from minor units', () => {
  assert.equal(authoritativeDecimalToMinorUnits('10.00', 'price'), 1000);
  assert.equal(authoritativeDecimalToMinorUnits('10.25', 'price'), 1025);
  assert.equal(minorUnitsToDatabaseDecimal(1025), '10.25');
  assert.equal(checkedLineTotal(1025, 3), 3075);
  assert.equal(checkedSubtotal(10, 20), 30);
});

test('money rejects invalid precision, unsafe arithmetic, and NUMERIC(10,2) overflow', () => {
  assert.throws(() => authoritativeDecimalToMinorUnits('1.001', 'price'));
  assert.throws(() => checkedLineTotal(POSTGRES_NUMERIC_10_2_MAX_MINOR, 2));
  assert.throws(() => checkedSubtotal(POSTGRES_NUMERIC_10_2_MAX_MINOR, 1));
});

test('UUID normalization uses one lowercase advisory-lock identity', () => {
  const lower = '123e4567-e89b-42d3-a456-426614174000';
  assert.equal(normalizeRequiredIdempotencyKey(lower.toUpperCase()), lower);
  assert.equal(normalizeRequiredIdempotencyKey(` ${lower} `), lower);
});

test('selected customer snapshot uses the database record', () => {
  const intent = normalizeCheckoutIntent({
    items: [{ product_id: 1, quantity: 1 }],
    payment_method: 'cash',
    customer_id: 5,
    customer_name: 'Someone Else',
    customer_phone: '000',
    customer_email: 'other@example.com',
    customer_address: 'Other Street',
  });

  assert.deepEqual(
    resolveCheckoutCustomerSnapshot(intent, {
      id: 5,
      name: ' Ada Lovelace ',
      phone: ' 091234 ',
      email: ' ada@example.com ',
      address: ' Main Street ',
    }),
    {
      customer_id: 5,
      customer_name: 'Ada Lovelace',
      customer_phone: '091234',
      customer_email: 'ada@example.com',
      customer_address: 'Main Street',
    }
  );
});

test('client snapshot cannot override a selected customer in the fingerprint identity', () => {
  const withSnapshot = normalizeCheckoutIntent({
    items: [{ product_id: 1, quantity: 1 }],
    payment_method: 'cash',
    customer_id: 5,
    customer_name: 'Someone Else',
  });
  const withoutSnapshot = normalizeCheckoutIntent({
    items: [{ product_id: 1, quantity: 1 }],
    payment_method: 'cash',
    customer_id: 5,
  });

  assert.deepEqual(customerIdentityForFingerprint(withSnapshot), {
    id: 5,
    name: null,
    phone: null,
    email: null,
    address: null,
  });
  assert.deepEqual(
    customerIdentityForFingerprint(withSnapshot),
    customerIdentityForFingerprint(withoutSnapshot)
  );
});

test('missing selected customer is a controlled checkout failure', () => {
  const intent = normalizeCheckoutIntent({
    items: [{ product_id: 1, quantity: 1 }],
    payment_method: 'cash',
    customer_id: 99,
  });

  assert.throws(
    () => resolveCheckoutCustomerSnapshot(intent, null),
    error => error instanceof CheckoutValidationError &&
      error.statusCode === 400 &&
      error.message === 'Customer not found'
  );
  assert.throws(
    () => resolveCheckoutCustomerSnapshot(intent, { id: 8, name: 'Wrong customer' }),
    /Customer not found/
  );
});

test('checkout without a customer keeps the submitted walk-in snapshot', () => {
  const intent = normalizeCheckoutIntent({
    items: [{ product_id: 1, quantity: 1 }],
    payment_method: 'cash',
    customer_name: ' Walk-in ',
    customer_phone: '',
  });

  assert.deepEqual(resolveCheckoutCustomerSnapshot(intent, { id: 5, name: 'Ada' }), {
    customer_id: null,
    customer_name: 'Walk-in',
    customer_phone: null,
    customer_email: null,
    customer_address: null,
  });
  assert.deepEqual(customerIdentityForFingerprint(intent), {
    id: null,
    name: 'Walk-in',
    phone: null,
    email: null,
    address: null,
  });
});

test('store tax rate accepts 0, 5, and 10 percent', () => {
  assert.equal(parseStoreTaxRatePercent(0), 0);
  assert.equal(parseStoreTaxRatePercent('5.00'), 5);
  assert.equal(parseStoreTaxRatePercent(10), 10);
});

for (const value of [7, '7.50', 15, -1, 'abc']) {
  test(`store tax rate rejects ${String(value)}`, () => {
    assert.throws(() => parseStoreTaxRatePercent(value), /tax rate is invalid|two decimal places|valid monetary amount/);
  });
}

test('tax on net uses integer rounding after discount', () => {
  assert.equal(taxMinorUnitsOnNet(0, 5), 0);
  assert.equal(taxMinorUnitsOnNet(10000, 0), 0);
  assert.equal(taxMinorUnitsOnNet(10000, 5), 500);
  assert.equal(taxMinorUnitsOnNet(1025, 5), 51);
  assert.equal(taxMinorUnitsOnNet(1025, 10), 103);
  assert.equal(taxMinorUnitsOnNet(2070000, 5), 103500);
});
