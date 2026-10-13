const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWorkflow, ProductWorkflowError } = require('./product-workflow-service');
const workflowRoutes = require('../routes/product-workflows');

function base(overrides = {}) {
  return {
    name: 'Phone', sku: 'PH-1', category_id: 2, price: 500000, cost: 400000,
    opening_quantity: 2, low_stock_threshold: 1, serial_tracking_enabled: false,
    serial_numbers: [], variants: [], ...overrides,
  };
}

test('normal products retain quantity opening stock without serials', () => {
  const value = normalizeWorkflow(base());
  assert.equal(value.openingQuantity, 2);
  assert.equal(value.serialTrackingEnabled, false);
  assert.deepEqual(value.serialNumbers, []);
});

test('serialized opening stock requires an exact normalized-unique serial batch', () => {
  const value = normalizeWorkflow(base({
    serial_tracking_enabled: true,
    serial_numbers: [' 00-A-1 ', '00-A-2'],
  }));
  assert.deepEqual(value.serialNumbers, [' 00-A-1 ', '00-A-2']);
  assert.throws(() => normalizeWorkflow(base({
    serial_tracking_enabled: true, serial_numbers: ['AA-1'],
  })), /exactly 2/);
  assert.throws(() => normalizeWorkflow(base({
    serial_tracking_enabled: true, serial_numbers: ['AA-1', 'AA1'],
  })), /Duplicate normalized/);
});

test('variants require explicit prices and support safe serial inheritance', () => {
  const value = normalizeWorkflow(base({
    serial_tracking_enabled: true,
    opening_quantity: 0,
    variants: [{
      name: 'Blue', sku: 'PH-1-B', price: 520000, cost: 410000,
      opening_quantity: 1, serial_tracking_enabled: 'inherit', serial_numbers: ['B-001'],
    }, {
      name: 'Display', sku: 'PH-1-D', price: 510000, cost: 405000,
      opening_quantity: 3, serial_tracking_enabled: false, serial_numbers: [],
    }],
  }));
  assert.equal(value.openingQuantity, 0);
  assert.equal(value.variants[0].serialTrackingEnabled, null);
  assert.equal(value.variants[0].price, 520000);
  assert.equal(value.variants[1].openingQuantity, 3);
});

test('duplicate SKUs, reserved stock-unit SKUs, unknown fields, and edit opening stock are rejected or ignored safely', () => {
  assert.throws(() => normalizeWorkflow(base({
    variants: [{ name: 'Same', sku: 'PH-1', price: 1, cost: 0 }],
  })), /must be unique/);
  assert.throws(() => normalizeWorkflow(base({ sku: 'SU-123' })), ProductWorkflowError);
  assert.throws(() => normalizeWorkflow({ ...base(), stock_quantity: 99 }), /Unknown workflow field/);
  const edit = normalizeWorkflow(base({ opening_quantity: 99, serial_numbers: ['unsafe'] }), { edit: true });
  assert.equal(edit.openingQuantity, 0);
  assert.deepEqual(edit.serialNumbers, []);
});

test('workflow mutations retain authentication and admin authorization', () => {
  for (const [path, method] of [['/workflow', 'post'], ['/:id/workflow', 'put']]) {
    const layer = workflowRoutes.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
    assert.ok(layer);
    assert.deepEqual(layer.route.stack.slice(0, 2).map((entry) => entry.name), ['requireAuth', 'requireAdmin']);
  }
});
