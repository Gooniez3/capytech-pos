const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../db/pool');
const salesRouter = require('./sales');

function warrantyRoute() {
  const layer = salesRouter.stack.find(
    (entry) => entry.route?.path === '/:id/warranty' && entry.route.methods.patch
  );
  assert.ok(layer, 'warranty correction route must be registered');
  return layer.route.stack;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('existing-invoice warranty correction remains auth and admin protected', () => {
  const stack = warrantyRoute();
  assert.equal(stack.length, 3);
  assert.equal(stack[0].name, 'requireAuth');
  assert.equal(stack[1].name, 'requireAdmin');
});

test('admin warranty correction locks, audits, and commits the invoice change', async (t) => {
  const calls = [];
  const client = {
    async query(sql, parameters) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, parameters });
      if (normalized.includes('FROM users')) {
        return { rows: [{ id: 7, role: 'admin' }] };
      }
      if (normalized.startsWith('SELECT id, invoice_number, warranty_months')) {
        return {
          rows: [{ id: 42, invoice_number: 'INV-000042', warranty_months: 3 }],
        };
      }
      if (normalized.startsWith('UPDATE sales')) {
        return {
          rows: [{ id: 42, invoice_number: 'INV-000042', warranty_months: 12 }],
        };
      }
      return { rows: [] };
    },
    release() {
      calls.push({ sql: 'RELEASE' });
    },
  };
  const originalConnect = pool.connect;
  pool.connect = async () => client;
  t.after(() => {
    pool.connect = originalConnect;
  });

  const handler = warrantyRoute()[2].handle;
  const req = {
    body: { warranty_months: 12 },
    params: { id: '42' },
    user: { id: 7, role: 'admin' },
  };
  const res = responseRecorder();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    id: '42',
    invoiceNumber: 'INV-000042',
    warrantyMonths: 12,
  });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /FROM users .* FOR UPDATE/);
  assert.match(calls[2].sql, /FROM sales .* FOR UPDATE/);
  assert.deepEqual(calls[3].parameters, [42, 12]);
  assert.match(calls[4].sql, /UPDATE_INVOICE_WARRANTY/);
  assert.deepEqual(JSON.parse(calls[4].parameters[1]), {
    saleId: 42,
    invoiceNumber: 'INV-000042',
    previousWarrantyMonths: 3,
    warrantyMonths: 12,
  });
  assert.equal(calls[5].sql, 'COMMIT');
  assert.equal(calls[6].sql, 'RELEASE');
});

test('invalid existing-invoice warranty is rejected before opening a transaction', async (t) => {
  const originalConnect = pool.connect;
  let connected = false;
  pool.connect = async () => {
    connected = true;
    throw new Error('must not connect');
  };
  t.after(() => {
    pool.connect = originalConnect;
  });

  const handler = warrantyRoute()[2].handle;
  const res = responseRecorder();
  await handler(
    { body: { warranty_months: 24 }, params: { id: '42' }, user: { id: 7 } },
    res
  );

  assert.equal(connected, false);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Warranty must be/);
});
