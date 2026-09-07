import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_PAYMENT_METHOD,
  PAYMENT_METHODS,
  checkoutRequestBody,
} from './posCheckout.js';

test('default payment method is cash and all supported methods are listed', () => {
  assert.equal(DEFAULT_PAYMENT_METHOD, 'cash');
  assert.deepEqual(PAYMENT_METHODS.map(method => method.value), [
    'cash',
    'banking',
    'kbzpay',
    'wavepay',
    'mmqr',
  ]);
  assert.deepEqual(PAYMENT_METHODS.map(method => method.label), [
    'Cash',
    'Banking',
    'KBZPay',
    'WavePay',
    'MMQR',
  ]);
});

test('checkout payload sends the selected payment method and defaults to cash', () => {
  const items = [{ product_id: 12, quantity: 1 }];
  assert.equal(
    checkoutRequestBody({ items, idempotencyKey: 'key-1' }).payment_method,
    'cash'
  );
  assert.equal(
    checkoutRequestBody({
      items,
      paymentMethod: 'kbzpay',
      idempotencyKey: 'key-1',
    }).payment_method,
    'kbzpay'
  );
});

test('checkout payload sends selected customer_id and otherwise sends null', () => {
  const items = [{ product_id: 12, quantity: 1 }];
  assert.equal(
    checkoutRequestBody({ items, idempotencyKey: 'key-1' }).customer_id,
    null
  );
  assert.equal(
    checkoutRequestBody({
      items,
      customer: { id: '5', name: 'Ada' },
      idempotencyKey: 'key-1',
    }).customer_id,
    '5'
  );
  assert.equal(
    checkoutRequestBody({
      items,
      customer: { id: '5', name: 'Ada' },
      idempotencyKey: 'key-1',
    }).customer_name,
    undefined
  );
});

test('POS selects payment and customer and sends them during checkout', async () => {
  const source = await readFile(new URL('../pages/POS.jsx', import.meta.url), 'utf8');
  assert.match(source, /useState\(DEFAULT_PAYMENT_METHOD\)/);
  assert.match(source, /PAYMENT_METHODS\.map/);
  assert.match(source, /checkoutRequestBody\(/);
  assert.match(source, /paymentMethod/);
  assert.match(source, /selectedCustomer/);
  assert.match(source, /api\.get\('\/customers'/);
  assert.match(source, /setSelectedCustomer\(null\)/);
});
