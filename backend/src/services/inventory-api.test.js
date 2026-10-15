const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryPolicyRoutes = require('../routes/inventory-policies');
const stockUnitRoutes = require('../routes/stock-units');
const warrantyLookupRoutes = require('../routes/warranty-lookup');
const { normalizePolicyPatch } = require('./inventory-policy-service');
const { listParameters, listStockUnits, lookupStockUnit } = require('./stock-unit-api-service');
const { normalizeWarrantyLookup } = require('./warranty-lookup-service');

function route(router, path, method) {
  return router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
}

function middlewareNames(layer) {
  return layer.route.stack.map((entry) => entry.name);
}

test('policy payload validation accepts inheritance and rejects unsafe fields', () => {
  assert.deepEqual(normalizePolicyPatch({
    serial_tracking_enabled: null,
    shop_warranty_enabled: null,
    shop_warranty_months: null,
  }, { variant: true }), {
    serial_tracking_enabled: null,
    shop_warranty_enabled: null,
    shop_warranty_months: null,
  });
  assert.throws(
    () => normalizePolicyPatch({ shop_warranty_enabled: true, manufacturer_warranty: 12 }),
    /Unknown request body field/
  );
  assert.throws(
    () => normalizePolicyPatch({ shop_warranty_months: 24 }),
    /1, 3, 6, 12/
  );
});

test('stock-unit pagination and filters are bounded', () => {
  assert.deepEqual(listParameters({ page: '2', limit: '50', state: 'quarantined' }), {
    page: 2,
    limit: 50,
    offset: 50,
    state: 'quarantined',
    productId: null,
    variantId: null,
    search: null,
  });
  assert.throws(() => listParameters({ limit: 101 }), /between 1 and 100/);
  assert.throws(() => listParameters({ state: 'deleted' }), /state must be/);
});

test('stock-unit free-text filtering accepts non-serial punctuation', async () => {
  const calls = [];
  const queryable = {
    async query(sql, values) {
      calls.push({ sql, values: [...values] });
      return calls.length === 1 ? { rows: [{ count: 0 }] } : { rows: [] };
    },
  };
  const result = await listStockUnits(queryable, { q: '---' });
  assert.equal(result.pagination.total, 0);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0].sql, /normalized_serial_number\s*=/);
  assert.deepEqual(calls[0].values, ['%---%']);
});

test('stock-unit lookup gives the permanent CT code explicit precedence', async () => {
  const calls = [];
  const queryable = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (calls.length === 1) return { rows: [{ id: 7, matched_by: 'unit_code' }] };
      if (calls.length === 2) return { rows: [{
        id: 7, unit_code: 'CT000007', internal_sku: 'SU-7',
        manufacturer_serial_number: 'SER-7', product_id: 2, variant_id: 3,
        product_name: 'Phone', product_sku: 'PHONE', variant_name: 'White',
        product_is_active: true, variant_is_active: true, effective_price: '100',
        state: 'available',
      }] };
      return { rows: [] };
    },
  };
  const unit = await lookupStockUnit(queryable, ' ct000007 ');
  assert.equal(unit.unit_code, 'CT000007');
  assert.equal(unit.matched_by, 'unit_code');
  assert.equal(unit.product_id, 2);
  assert.equal(unit.variant_id, 3);
  assert.equal(unit.variant_name, 'White');
  assert.equal(unit.product_is_active, true);
  assert.equal(unit.variant_is_active, true);
  assert.match(calls[0].sql, /UPPER\(unit_code\) = UPPER\(\$1\)/);
  assert.equal(calls[0].values[0], 'ct000007');
});

test('warranty lookup requires exactly one supported identity', () => {
  assert.deepEqual(normalizeWarrantyLookup({ invoice_number: ' INV-1 ' }), {
    field: 'invoice_number', value: 'INV-1',
  });
  assert.throws(
    () => normalizeWarrantyLookup({ invoice_number: 'INV-1', serial_number: 'SN-1' }),
    /exactly one/
  );
  assert.throws(() => normalizeWarrantyLookup({ product_id: '1' }), /Unknown query field/);
});

test('read APIs require authentication and mutation APIs require admin', () => {
  assert.deepEqual(middlewareNames(route(stockUnitRoutes, '/', 'get')), ['requireAuth', '<anonymous>']);
  assert.deepEqual(
    middlewareNames(route(stockUnitRoutes, '/:id/barcode', 'get')),
    ['requireAuth', '<anonymous>']
  );
  assert.deepEqual(
    middlewareNames(route(stockUnitRoutes, '/receive', 'post')).slice(0, 2),
    ['requireAuth', 'requireAdmin']
  );
  assert.deepEqual(
    middlewareNames(route(stockUnitRoutes, '/:id/serial', 'patch')).slice(0, 2),
    ['requireAuth', 'requireAdmin']
  );
  assert.deepEqual(
    middlewareNames(route(stockUnitRoutes, '/release', 'post')).slice(0, 2),
    ['requireAuth', 'requireAdmin']
  );
  assert.deepEqual(
    middlewareNames(route(stockUnitRoutes, '/retire', 'post')).slice(0, 2),
    ['requireAuth', 'requireAdmin']
  );
  assert.deepEqual(
    middlewareNames(route(inventoryPolicyRoutes, '/:productId/inventory-policy', 'patch')).slice(0, 2),
    ['requireAuth', 'requireAdmin']
  );
  assert.deepEqual(
    middlewareNames(route(warrantyLookupRoutes, '/', 'get')),
    ['requireAuth', '<anonymous>']
  );
});

test('scanner and manual batches share one strict payload contract', () => {
  const normalized = stockUnitRoutes.normalizeBatches({
    batches: [{ product_id: 4, variant_id: null, serial_numbers: [' 00-A-1 '] }],
  });
  assert.deepEqual(normalized, [{
    productId: 4, variantId: null, serialNumbers: [' 00-A-1 '],
  }]);
  assert.throws(
    () => stockUnitRoutes.normalizeBatches({
      batches: [{ product_id: 4, serial_numbers: ['A'], quantity: 1 }],
    }),
    /Unknown batch field/
  );
});
