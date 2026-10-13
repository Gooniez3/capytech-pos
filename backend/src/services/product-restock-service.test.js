const test = require('node:test');
const assert = require('node:assert/strict');
const routes = require('../routes/product-workflows');
const { fingerprint, normalizeRestockRequest } = require('./product-restock-service');

const key = '123e4567-e89b-42d3-a456-426614174000';

test('quantity receiving requires a positive integer and rejects unknown fields', () => {
  const request = normalizeRestockRequest(4, { idempotency_key: key, variant_id: 9, quantity: 3, reason: ' PO-1 ' });
  assert.equal(request.quantity, 3);
  assert.equal(request.reason, 'PO-1');
  assert.throws(() => normalizeRestockRequest(4, { idempotency_key: key, quantity: 0 }), /positive/);
  assert.throws(() => normalizeRestockRequest(4, { idempotency_key: key, quantity: 1, stock_quantity: 2 }), /Unknown/);
});

test('serialized quantity is represented by normalized unique serial entries', () => {
  const request = normalizeRestockRequest(4, { idempotency_key: key, serial_numbers: [' 00-A-2 ', '00-A-1'] });
  assert.deepEqual(request.normalizedSerials, ['00A1', '00A2']);
  assert.throws(() => normalizeRestockRequest(4, { idempotency_key: key, serial_numbers: ['AA-1', 'AA1'] }), /Duplicate normalized/);
});

test('fingerprints are stable for serial order but change with target or quantity', () => {
  const first = normalizeRestockRequest(4, { idempotency_key: key, serial_numbers: ['A-2', 'A-1'] });
  const reordered = normalizeRestockRequest(4, { idempotency_key: key, serial_numbers: ['A-1', 'A-2'] });
  assert.deepEqual(fingerprint(first), fingerprint(reordered));
  assert.notDeepEqual(fingerprint(first), fingerprint(normalizeRestockRequest(5, { idempotency_key: key, serial_numbers: ['A-1', 'A-2'] })));
});

test('restock route requires authentication and admin authorization', () => {
  const layer = routes.stack.find((entry) => entry.route?.path === '/:id/restock' && entry.route.methods.post);
  assert.ok(layer);
  assert.deepEqual(layer.route.stack.slice(0, 2).map((entry) => entry.name), ['requireAuth', 'requireAdmin']);
});
