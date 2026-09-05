const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SaleReversalError,
  assertSaleCanBeReversed,
  assertSaleItemsCanBeReversed,
  revalidateCurrentAdmin,
  restoreExactInventory,
} = require('./sale-reversal');

function clientWithResults(results) {
  const queries = [];
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql, values });
      const result = results.shift();
      if (!result) {
        throw new Error('Unexpected query');
      }
      return result;
    },
  };
}

test('refund restoration updates the exact product once', async () => {
  const client = clientWithResults([{ rowCount: 1, rows: [] }]);

  await restoreExactInventory(client, [{ product_id: 4, variant_id: null, quantity: 3 }]);

  assert.match(client.queries[0].sql, /UPDATE products/);
  assert.deepEqual(client.queries[0].values, [3, 4]);
});

test('refund restoration updates the exact variant once', async () => {
  const client = clientWithResults([{ rowCount: 1, rows: [] }]);

  await restoreExactInventory(client, [{ product_id: 4, variant_id: 9, quantity: 2 }]);

  assert.match(client.queries[0].sql, /UPDATE product_variants/);
  assert.deepEqual(client.queries[0].values, [2, 9]);
});

test('an item without an inventory target fails before any stock update', async () => {
  const client = clientWithResults([]);

  await assert.rejects(
    restoreExactInventory(client, [{ product_id: null, variant_id: null, quantity: 1 }]),
    error => error instanceof SaleReversalError && error.statusCode === 409
  );
  assert.equal(client.queries.length, 0);
});

test('a missing inventory row fails closed after its update affects zero rows', async () => {
  const client = clientWithResults([{ rowCount: 0, rows: [] }]);

  await assert.rejects(
    restoreExactInventory(client, [{ product_id: 4, variant_id: null, quantity: 1 }]),
    error => error instanceof SaleReversalError && error.statusCode === 409
  );
  assert.equal(client.queries.length, 1);
});

test('void rejects a sale with no items', () => {
  assert.throws(
    () => assertSaleItemsCanBeReversed([], 'void'),
    error => error instanceof SaleReversalError && error.statusCode === 409
  );
});

test('void rejects an unresolved inventory target', async () => {
  const client = clientWithResults([]);

  await assert.rejects(
    restoreExactInventory(client, [{ product_id: null, variant_id: null, quantity: 1 }]),
    /manual reconciliation/
  );
});

test('refund and void reject terminal sales, preserving double-operation protection', () => {
  for (const [status, action] of [
    ['refunded', 'refund'],
    ['voided', 'refund'],
    ['refunded', 'void'],
    ['voided', 'void'],
  ]) {
    assert.throws(
      () => assertSaleCanBeReversed({ status }, action),
      error => error instanceof SaleReversalError && error.statusCode === 409
    );
  }
  assert.doesNotThrow(() => assertSaleCanBeReversed({ status: 'completed' }, 'refund'));
  assert.doesNotThrow(() => assertSaleCanBeReversed({ status: 'completed' }, 'void'));
});

test('the current database admin role is accepted even when the JWT was checked earlier', async () => {
  const client = clientWithResults([{ rowCount: 1, rows: [{ id: 7, role: 'admin' }] }]);

  assert.deepEqual(await revalidateCurrentAdmin(client, 7), { id: 7, role: 'admin' });
  assert.deepEqual(client.queries[0].values, [7]);
});

test('a demoted user is rejected even if an earlier JWT claimed admin', async () => {
  const client = clientWithResults([{ rowCount: 1, rows: [{ id: 7, role: 'cashier' }] }]);

  await assert.rejects(
    revalidateCurrentAdmin(client, 7),
    error => error instanceof SaleReversalError && error.statusCode === 403
  );
});

test('a deleted user is rejected', async () => {
  const client = clientWithResults([{ rowCount: 0, rows: [] }]);

  await assert.rejects(
    revalidateCurrentAdmin(client, 7),
    error => error instanceof SaleReversalError && error.statusCode === 403
  );
});
