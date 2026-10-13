const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SaleReversalError,
  assertSaleCanBeReversed,
  assertSaleItemsCanBeReversed,
  revalidateCurrentAdmin,
  restoreExactInventory,
} = require('./sale-reversal');
const { attachTransaction } = require('./domain-transaction');

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

function inventoryTransaction({ variant = false, serialized = false, missing = false } = {}) {
  const queries = [];
  const client = {
    queries,
    async query(sql, values) {
      queries.push({ sql, values });
      if (/^SAVEPOINT |^RELEASE SAVEPOINT |^ROLLBACK TO SAVEPOINT /.test(sql)) return { rows: [] };
      if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) return { rows: missing ? [] : [{
        id: 4, stock_quantity: 5, is_active: false, serial_tracking_enabled: serialized,
        shop_warranty_enabled: false, shop_warranty_months: null,
      }] };
      if (sql.includes('FROM product_variants') && sql.includes('FOR UPDATE')) return { rows: variant ? [{
        id: 9, product_id: 4, stock_quantity: 6, is_active: false, serial_tracking_enabled: null,
        shop_warranty_enabled: null, shop_warranty_months: null,
      }] : [] };
      if (sql.includes('FROM stock_units')) return { rows: [{ count: 0 }] };
      if (/UPDATE (products|product_variants)/.test(sql)) {
        return { rowCount: 1, rows: [{ stock_quantity: values[0] }] };
      }
      if (sql.includes('INSERT INTO inventory_movements')) {
        return { rows: [{ quantity_before: values[4], quantity_after: values[5], movement_type: values[2] }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return { client, transaction: attachTransaction(client) };
}

test('refund restoration records the exact product movement once', async () => {
  const { client, transaction } = inventoryTransaction();
  await restoreExactInventory(transaction, [{ product_id: 4, variant_id: null, quantity: 3 }], {
    action: 'refunded', saleId: 20, actorUserId: 7, reason: 'return',
  });
  const update = client.queries.find((entry) => /UPDATE products/.test(entry.sql));
  const ledger = client.queries.find((entry) => entry.sql.includes('INSERT INTO inventory_movements'));
  assert.deepEqual(update.values, [8, 4, 5]);
  assert.deepEqual(ledger.values.slice(0, 9), [4, null, 'refunded', 3, 5, 8, 7, 'return', 'sale:20:refunded']);
});

test('void restoration records the exact variant movement once', async () => {
  const { client, transaction } = inventoryTransaction({ variant: true });
  await restoreExactInventory(transaction, [{ product_id: 4, variant_id: 9, quantity: 2 }], {
    action: 'voided', saleId: 21, actorUserId: 7,
  });
  const update = client.queries.find((entry) => /UPDATE product_variants/.test(entry.sql));
  const ledger = client.queries.find((entry) => entry.sql.includes('INSERT INTO inventory_movements'));
  assert.deepEqual(update.values, [8, 9, 6]);
  assert.equal(ledger.values[2], 'voided');
});

test('an item without an inventory target fails before any stock update', async () => {
  const client = clientWithResults([]);

  await assert.rejects(
    restoreExactInventory({}, [{ product_id: null, variant_id: null, quantity: 1 }], {
      action: 'refunded', saleId: 1, actorUserId: 7,
    }),
    error => error instanceof SaleReversalError && error.statusCode === 409
  );
  assert.equal(client.queries.length, 0);
});

test('a missing inventory row fails closed without a stock or ledger write', async () => {
  const { client, transaction } = inventoryTransaction({ missing: true });
  await assert.rejects(restoreExactInventory(transaction, [{ product_id: 4, variant_id: null, quantity: 1 }], {
    action: 'refunded', saleId: 1, actorUserId: 7,
  }), error => error.statusCode === 404);
  assert.equal(client.queries.some((entry) => /UPDATE products/.test(entry.sql)), false);
  assert.equal(client.queries.some((entry) => entry.sql.includes('INSERT INTO inventory_movements')), false);
});

test('serialized inventory restoration fails closed without a quantity change', async () => {
  const { client, transaction } = inventoryTransaction({ serialized: true });
  await assert.rejects(restoreExactInventory(transaction, [{ product_id: 4, variant_id: null, quantity: 1 }], {
    action: 'refunded', saleId: 1, actorUserId: 7,
  }), error => error.statusCode === 409 && /serialized inventory/.test(error.message));
  assert.equal(client.queries.some((entry) => /UPDATE products/.test(entry.sql)), false);
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
    restoreExactInventory({}, [{ product_id: null, variant_id: null, quantity: 1 }], {
      action: 'voided', saleId: 1, actorUserId: 7,
    }),
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
