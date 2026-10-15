const test = require('node:test');
const assert = require('node:assert/strict');
const reportsRouter = require('../routes/reports');
const {
  parseCsv,
  validateArchive,
  previewArchive,
  importArchive,
  csvSafe,
} = require('./historical-sales-service');

const SALES_HEADER = 'id,invoice_number,created_at,status,subtotal,tax,discount,total,payment_method,refunded_at,voided_at';
const MONTH_HEADER = 'sale_month,completed_transactions,completed_amount,refunded_transactions,refunded_amount';
const ALL_HEADER = 'total_transactions,completed_transactions,completed_amount,refunded_transactions,refunded_amount';

function transaction(id, month, status, total, invoice = `OLD-${String(id).padStart(3, '0')}`) {
  const refunded = status === 'refunded' ? `${month}-${id < 10 ? '20' : '21'} 12:00:00+06:30` : '';
  return `${id},${invoice},${month}-${String((id % 18) + 1).padStart(2, '0')} 10:30:00,${status},${total}.00,0.00,0.00,${total}.00,kbzpay,${refunded},`;
}

function validBuffers() {
  const sales = [
    transaction(1, '2026-09', 'completed', 75000),
    transaction(2, '2026-09', 'refunded', 12000),
    transaction(3, '2026-09', 'refunded', 15200),
    transaction(4, '2026-09', 'refunded', 15000),
    transaction(5, '2026-10', 'completed', 50000),
    transaction(6, '2026-10', 'completed', 60000),
    transaction(7, '2026-10', 'completed', 70000),
    transaction(8, '2026-10', 'completed', 80000),
    transaction(9, '2026-10', 'completed', 90000),
    transaction(10, '2026-10', 'completed', 100000),
    transaction(11, '2026-10', 'completed', 40000),
    transaction(12, '2026-10', 'completed', 27200),
    transaction(13, '2026-10', 'refunded', 80000),
    transaction(14, '2026-10', 'refunded', 79500),
  ];
  return {
    historicalSales: Buffer.from(`${SALES_HEADER}\n${sales.join('\n')}\n`),
    monthlySummary: Buffer.from(`${MONTH_HEADER}\n2026-09-01,1,75000.00,3,42200.00\n2026-10-01,8,517200.00,2,159500.00\n`),
    allTimeSummary: Buffer.from(`${ALL_HEADER}\n14,9,592200.00,5,201700.00\n`),
  };
}

function route(path, method) {
  return reportsRouter.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
}

test('CSV parser accepts RFC-style commas, escaped quotes, and embedded newlines', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,"two, ""quoted"""\r\n2,"line\nvalue"\r\n'), [
    ['a', 'b'],
    ['1', 'two, "quoted"'],
    ['2', 'line\nvalue'],
  ]);
  assert.throws(() => parseCsv('a\n"unfinished'), /unterminated/);
  assert.throws(() => parseCsv('a\n"ok"bad'), /closing quote/);
});

test('the 14-row fixture reconciles exact monthly and all-time accounting totals', () => {
  const archive = validateArchive(validBuffers());
  assert.equal(archive.sales.length, 14);
  assert.deepEqual(archive.months.map((month) => ({
    month: month.key,
    completed: month.completedTransactions,
    completedAmount: month.completedAmount,
    refunded: month.refundedTransactions,
    refundedAmount: month.refundedAmount,
  })), [
    { month: '2026-09', completed: 1, completedAmount: '75000.00', refunded: 3, refundedAmount: '42200.00' },
    { month: '2026-10', completed: 8, completedAmount: '517200.00', refunded: 2, refundedAmount: '159500.00' },
  ]);
  assert.deepEqual({
    total: archive.allTime.totalTransactions,
    completed: archive.allTime.completedTransactions,
    completedAmount: archive.allTime.completedAmount,
    refunded: archive.allTime.refundedTransactions,
    refundedAmount: archive.allTime.refundedAmount,
  }, { total: 14, completed: 9, completedAmount: '592200.00', refunded: 5, refundedAmount: '201700.00' });
});

test('invalid headers, malformed amounts, duplicate identities, and inconsistent summaries fail closed', () => {
  const header = validBuffers();
  header.monthlySummary = Buffer.from(header.monthlySummary.toString().replace('sale_month', 'month'));
  assert.throws(() => validateArchive(header), /headers must be exactly/);

  const amount = validBuffers();
  amount.historicalSales = Buffer.from(amount.historicalSales.toString().replace('75000.00,0.00', '75,000.00,0.00'));
  assert.throws(() => validateArchive(amount), /columns|decimal/);

  const duplicateId = validBuffers();
  duplicateId.historicalSales = Buffer.from(duplicateId.historicalSales.toString().replace('\n2,OLD-002', '\n1,OLD-002'));
  assert.throws(() => validateArchive(duplicateId), /Duplicate historical id/);

  const duplicateInvoice = validBuffers();
  duplicateInvoice.historicalSales = Buffer.from(duplicateInvoice.historicalSales.toString().replace('2,OLD-002', '2,OLD-001'));
  assert.throws(() => validateArchive(duplicateInvoice), /Duplicate historical invoice/);

  const mismatch = validBuffers();
  mismatch.allTimeSummary = Buffer.from(mismatch.allTimeSummary.toString().replace('592200.00', '592201.00'));
  assert.throws(() => validateArchive(mismatch), /does not match/);

  const invalidUtf8 = validBuffers();
  invalidUtf8.allTimeSummary = Buffer.from([0xff, 0xfe, 0xfd]);
  assert.throws(() => validateArchive(invalidUtf8), /valid UTF-8/);
});

test('historical invoice numbers are isolated and never checked against active sales', async () => {
  const buffers = validBuffers();
  buffers.historicalSales = Buffer.from(buffers.historicalSales.toString().replace('OLD-001', 'INV-000001'));
  const secret = 'unit-test-only-secret';
  const { preview } = previewArchive(buffers, secret, 2000000000000);
  const calls = [];
  const client = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized.includes('SELECT id, role FROM users')) return { rows: [{ id: 7, role: 'admin' }] };
      if (normalized.includes('SELECT archive_digest')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  const result = await importArchive({ connect: async () => client }, buffers, {
    previewToken: preview.previewToken,
    userId: 7,
    secret,
    now: 2000000000001,
  });
  assert.equal(result.imported, true);
  const sql = calls.join('\n');
  assert.doesNotMatch(sql, /INSERT INTO (sales|sale_items|payments|inventory|stock_units)\b/);
  assert.doesNotMatch(sql, /invoice_number_seq|nextval|setval/);
  assert.doesNotMatch(sql, /FROM sales\b/);
  assert.match(sql, /INSERT INTO historical_sales /);
});

test('same digest is idempotent and a different installed digest is refused', async () => {
  const buffers = validBuffers();
  const secret = 'unit-test-only-secret';
  const { preview } = previewArchive(buffers, secret, 2000000000000);
  async function run(existingDigest) {
    const calls = [];
    const client = {
      async query(sql) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        calls.push(normalized);
        if (normalized.includes('SELECT id, role FROM users')) return { rows: [{ id: 7, role: 'admin' }] };
        if (normalized.includes('SELECT archive_digest')) return { rows: [{ archive_digest: existingDigest }] };
        return { rows: [] };
      },
      release() {},
    };
    return { calls, promise: importArchive({ connect: async () => client }, buffers, {
      previewToken: preview.previewToken, userId: 7, secret, now: 2000000000001,
    }) };
  }
  const same = await run(preview.digest);
  assert.equal((await same.promise).alreadyImported, true);
  assert.doesNotMatch(same.calls.join('\n'), /INSERT INTO historical_sales /);

  const different = await run('a'.repeat(64));
  await assert.rejects(different.promise, /Replacement is not supported/);
  assert.match(different.calls.join('\n'), /ROLLBACK/);
});

test('a failed row insert rolls the entire import transaction back', async () => {
  const buffers = validBuffers();
  const secret = 'unit-test-only-secret';
  const { preview } = previewArchive(buffers, secret, 2000000000000);
  const calls = [];
  const client = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (normalized.includes('SELECT id, role FROM users')) return { rows: [{ id: 7, role: 'admin' }] };
      if (normalized.includes('SELECT archive_digest')) return { rows: [] };
      if (normalized.startsWith('INSERT INTO historical_sales ') && calls.filter((item) => item.startsWith('INSERT INTO historical_sales ')).length === 2) {
        throw new Error('simulated insert failure');
      }
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(importArchive({ connect: async () => client }, buffers, {
    previewToken: preview.previewToken, userId: 7, secret, now: 2000000000001,
  }), /simulated insert failure/);
  assert.equal(calls[0], 'BEGIN');
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.ok(!calls.includes('COMMIT'));
});

test('historical routes require authentication/admin and expose no update or delete action', () => {
  for (const [path, method] of [
    ['/historical', 'get'],
    ['/historical/preview', 'post'],
    ['/historical/import', 'post'],
  ]) {
    const layer = route(path, method);
    assert.ok(layer, `${method.toUpperCase()} ${path} must exist`);
    assert.deepEqual(layer.route.stack.slice(0, 2).map((entry) => entry.name), ['requireAuth', 'requireAdmin']);
  }
  assert.equal(route('/historical', 'patch'), undefined);
  assert.equal(route('/historical', 'delete'), undefined);
});

test('CSV export cells neutralize spreadsheet formulas before quoting', () => {
  assert.equal(csvSafe('=2+2'), "'=2+2");
  assert.equal(csvSafe('+SUM(A1:A2)'), "'+SUM(A1:A2)");
  assert.equal(csvSafe('normal, value'), '"normal, value"');
});
