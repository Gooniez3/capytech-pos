const test = require('node:test');
const assert = require('node:assert/strict');
const {
  attachTransaction,
  assertTransactionCanCommit,
  transactionClient,
  withTransactionOperation,
  withTransaction,
} = require('./domain-transaction');
const {
  assertLifecycleTransition,
  registerReceivedUnits,
} = require('./stock-unit-service');

function mockPool({ fail = false } = {}) {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push('RELEASE'); },
  };
  return {
    calls,
    async connect() { return client; },
    work: async () => {
      if (fail) throw new Error('forced failure');
      return 'done';
    },
  };
}

test('owned transaction commits and releases exactly once', async () => {
  const pool = mockPool();
  const result = await withTransaction(pool, async (transaction) => {
    assert.equal(transactionClient(transaction).query instanceof Function, true);
    return pool.work();
  });
  assert.equal(result, 'done');
  assert.deepEqual(pool.calls, [
    'BEGIN ISOLATION LEVEL READ COMMITTED',
    'COMMIT',
    'RELEASE',
  ]);
});

test('owned transaction rolls back and releases on failure', async () => {
  const pool = mockPool({ fail: true });
  await assert.rejects(
    withTransaction(pool, async () => pool.work()),
    /forced failure/
  );
  assert.deepEqual(pool.calls, [
    'BEGIN ISOLATION LEVEL READ COMMITTED',
    'ROLLBACK',
    'RELEASE',
  ]);
});

test('attached transaction participates without opening or committing independently', () => {
  const client = { query() {} };
  assert.equal(transactionClient(attachTransaction(client)), client);
  assert.throws(() => transactionClient({ client }), /explicit/);
});

test('caught domain failure prevents an owned transaction from committing', async () => {
  const pool = mockPool();
  await assert.rejects(
    withTransaction(pool, async (transaction) => {
      await withTransactionOperation(transaction, 'partial_write', async (client) => {
        await client.query('PARTIAL WRITE');
        throw new Error('service failed');
      }).catch(() => {});
      return 'must not commit';
    }),
    /must be rolled back/
  );
  assert.equal(pool.calls[0], 'BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.match(pool.calls[1], /^SAVEPOINT capytech_partial_write_\d+$/);
  assert.equal(pool.calls[2], 'PARTIAL WRITE');
  assert.equal(pool.calls[3], `ROLLBACK TO ${pool.calls[1]}`);
  assert.equal(pool.calls[4], `RELEASE ${pool.calls[1]}`);
  assert.deepEqual(pool.calls.slice(5), ['ROLLBACK', 'RELEASE']);
});

test('attached transaction owner must roll back after a caught service error', async () => {
  const calls = [];
  const client = { async query(sql) { calls.push(sql); return { rows: [] }; } };
  const transaction = attachTransaction(client);
  await assert.rejects(
    withTransactionOperation(transaction, 'attached_write', async (queryClient) => {
      await queryClient.query('ATTACHED PARTIAL WRITE');
      throw new Error('attached service failed');
    }),
    /attached service failed/
  );
  assert.throws(() => assertTransactionCanCommit(transaction), /must be rolled back/);
  await client.query('ROLLBACK');
  assert.match(calls[0], /^SAVEPOINT capytech_attached_write_\d+$/);
  assert.equal(calls[1], 'ATTACHED PARTIAL WRITE');
  assert.equal(calls[2], `ROLLBACK TO ${calls[0]}`);
  assert.equal(calls[3], `RELEASE ${calls[0]}`);
  assert.equal(calls[4], 'ROLLBACK');
});

test('stock mutations reject calls without an explicit transaction context', async () => {
  await assert.rejects(
    registerReceivedUnits(null, { batches: [] }),
    /explicit CapyTech transaction context/
  );
});

test('invalid lifecycle transitions fail before database mutation', () => {
  assert.doesNotThrow(() => assertLifecycleTransition('sold', 'available', 'sold'));
  assert.doesNotThrow(() => assertLifecycleTransition('retired', 'quarantined', 'retired'));
  for (const transition of [
    ['sold', 'sold', 'sold'],
    ['released', 'retired', 'available'],
    ['retired', 'sold', 'retired'],
    ['received', null, 'sold'],
  ]) {
    assert.throws(() => assertLifecycleTransition(...transition), /Invalid stock-unit transition/);
  }
});
