const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProductRecycleBinError,
  normalizedSku,
  revalidateCurrentProductAdmin,
  assertProductCanBeRestored,
} = require('./product-recycle-bin');

function clientWithResults(results) {
  const queries = [];
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql, values });
      const result = results.shift();
      if (!result) throw new Error('Unexpected query');
      return result;
    },
  };
}

test('normalizes restore SKUs case-insensitively', () => {
  assert.equal(normalizedSku('  mouse-01  '), 'MOUSE-01');
});

test('current database admin is accepted and a demoted or missing user is rejected', async () => {
  const admin = clientWithResults([{ rows: [{ id: 7, role: 'admin' }] }]);
  assert.deepEqual(await revalidateCurrentProductAdmin(admin, 7, { lock: true }), { id: 7, role: 'admin' });
  assert.match(admin.queries[0].sql, /FOR UPDATE/);

  for (const rows of [[{ id: 7, role: 'cashier' }], []]) {
    await assert.rejects(
      revalidateCurrentProductAdmin(clientWithResults([{ rows }]), 7),
      error => error instanceof ProductRecycleBinError && error.statusCode === 403
    );
  }
});

test('restoration accepts a product whose child variants preserve mixed active states', async () => {
  const client = clientWithResults([
    { rows: [] }, // other product using parent SKU
    { rows: [] }, // variant using parent SKU
    { rows: [
      { id: 10, product_id: 4, sku: 'MOUSE-BLACK', is_active: true },
      { id: 11, product_id: 4, sku: 'MOUSE-WHITE', is_active: false },
    ] },
    { rows: [] }, { rows: [] }, // first child conflicts
    { rows: [] }, { rows: [] }, // second child conflicts
  ]);

  const variants = await assertProductCanBeRestored(client, { id: 4, sku: 'MOUSE' });
  assert.deepEqual(variants.map(v => v.is_active), [true, false]);
  assert.ok(client.queries.every(query => !/\bUPDATE\s+(products|product_variants)\b/i.test(query.sql)));
});

test('restoration fails closed for product and child SKU conflicts', async () => {
  const parentConflict = clientWithResults([{ rows: [{ id: 8, sku: 'MOUSE' }] }]);
  await assert.rejects(
    assertProductCanBeRestored(parentConflict, { id: 4, sku: 'mouse' }),
    error => error instanceof ProductRecycleBinError && error.statusCode === 409
  );

  const duplicateChild = clientWithResults([
    { rows: [] }, { rows: [] },
    { rows: [
      { id: 10, product_id: 4, sku: 'MOUSE-BLACK', is_active: true },
      { id: 11, product_id: 4, sku: 'mouse-black', is_active: false },
    ] },
    { rows: [] }, { rows: [] },
  ]);
  await assert.rejects(
    assertProductCanBeRestored(duplicateChild, { id: 4, sku: 'mouse' }),
    error => error instanceof ProductRecycleBinError && error.statusCode === 409
  );
});

test('restoration fails closed when a child relationship is unexpected', async () => {
  const client = clientWithResults([
    { rows: [] }, { rows: [] },
    { rows: [{ id: 10, product_id: 99, sku: 'MOUSE-BLACK', is_active: true }] },
  ]);
  await assert.rejects(
    assertProductCanBeRestored(client, { id: 4, sku: 'MOUSE' }),
    /relationship could not be verified/
  );
});
