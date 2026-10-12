const TRANSACTION_CONTEXT = Symbol('capytech.transaction-context');
const TRANSACTION_STATE = Symbol('capytech.transaction-state');
let operationSequence = 0;

function assertClient(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('A PostgreSQL transaction client is required');
  }
}

function attachTransaction(client) {
  assertClient(client);
  return Object.freeze({
    client,
    [TRANSACTION_CONTEXT]: true,
    [TRANSACTION_STATE]: { rollbackRequired: false },
  });
}

function transactionClient(transaction) {
  if (!transaction || transaction[TRANSACTION_CONTEXT] !== true) {
    throw new TypeError('An explicit CapyTech transaction context is required');
  }
  assertClient(transaction.client);
  return transaction.client;
}

function transactionState(transaction) {
  transactionClient(transaction);
  return transaction[TRANSACTION_STATE];
}

function assertTransactionCanCommit(transaction) {
  if (transactionState(transaction).rollbackRequired) {
    throw new Error(
      'The transaction must be rolled back because a domain operation failed'
    );
  }
}

// Every mutating domain service runs inside a savepoint. If a caller catches a
// service error, that service's writes have already been rolled back, and the
// context remains marked rollback-required. Attached-transaction owners must
// call assertTransactionCanCommit before COMMIT and roll back when it rejects.
async function withTransactionOperation(transaction, operationName, work) {
  const client = transactionClient(transaction);
  if (typeof work !== 'function') throw new TypeError('Transaction operation must be a function');
  const safeName = String(operationName || 'domain').replace(/[^a-z0-9_]/gi, '_').slice(0, 32);
  operationSequence = (operationSequence + 1) % Number.MAX_SAFE_INTEGER;
  const savepoint = `capytech_${safeName}_${operationSequence}`;
  const state = transactionState(transaction);
  if (state.rollbackRequired) {
    throw new Error('The transaction is already marked for rollback');
  }

  try {
    await client.query(`SAVEPOINT ${savepoint}`);
    const result = await work(client);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    state.rollbackRequired = true;
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (rollbackError) {
      error.savepointRollbackError = rollbackError;
    }
    throw error;
  }
}

async function withTransaction(pool, work, { isolationLevel = 'READ COMMITTED' } = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required');
  }
  if (typeof work !== 'function') {
    throw new TypeError('Transaction work must be a function');
  }
  if (!['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].includes(isolationLevel)) {
    throw new TypeError('Unsupported transaction isolation level');
  }

  const client = await pool.connect();
  let began = false;
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
    began = true;
    const transaction = attachTransaction(client);
    const result = await work(transaction);
    assertTransactionCanCommit(transaction);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (began) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  attachTransaction,
  assertTransactionCanCommit,
  transactionClient,
  withTransactionOperation,
  withTransaction,
};
