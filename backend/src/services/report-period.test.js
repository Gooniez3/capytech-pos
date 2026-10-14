const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/pool');
const reportsRouter = require('../routes/reports');
const {
  ReportPeriodError,
  normalizeReportPeriod,
  timestampPredicate,
} = require('./report-period');

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function reportHandler(path) {
  const layer = reportsRouter.stack.find(
    (entry) => entry.route?.path === path && entry.route.methods.get
  );
  assert.ok(layer, `${path} route must be registered`);
  return layer.route.stack.at(-1).handle;
}

test('presets retain their inclusive shop-calendar boundaries', () => {
  const today = '2026-01-01';
  assert.deepEqual(normalizeReportPeriod({ range: 'today' }, today).values, ['2026-01-01', '2026-01-01']);
  assert.deepEqual(normalizeReportPeriod({ range: 'yesterday' }, today).values, ['2025-12-31', '2025-12-31']);
  assert.deepEqual(normalizeReportPeriod({ range: 'week' }, today).values, ['2025-12-26', '2026-01-01']);
  assert.deepEqual(normalizeReportPeriod({ range: 'month' }, today).values, ['2025-12-03', '2026-01-01']);
  assert.deepEqual(normalizeReportPeriod({ range: 'year' }, today).values, ['2026-01-01', '2026-01-01']);
});

test('custom single dates and inclusive multi-day ranges have stable labels and grains', () => {
  const single = normalizeReportPeriod(
    { range: 'custom', from: '2026-10-12', to: '2026-10-12' },
    '2026-10-14'
  );
  assert.equal(single.label, '12 Oct 2026');
  assert.equal(single.trendGrain, 'hourly');

  const range = normalizeReportPeriod(
    { range: 'custom', from: '2025-12-31', to: '2026-01-02' },
    '2026-10-14'
  );
  assert.deepEqual(range.values, ['2025-12-31', '2026-01-02']);
  assert.equal(range.label, '31 Dec 2025 – 2 Jan 2026');
  assert.equal(range.trendGrain, 'daily');
});

test('invalid, impossible, reversed, future, and unsupported dates fail closed', () => {
  for (const query of [
    { range: 'custom', from: '2026-02-30', to: '2026-03-01' },
    { range: 'custom', from: '12/10/2026', to: '2026-10-12' },
    { range: 'custom', from: '2026-10-13', to: '2026-10-12' },
    { range: 'custom', from: '2026-10-12', to: '2026-10-15' },
    { range: 'unknown' },
  ]) {
    assert.throws(() => normalizeReportPeriod(query, '2026-10-14'), ReportPeriodError);
  }
});

test('date-only calculations and labels are independent of the process timezone', () => {
  const originalTimezone = process.env.TZ;
  try {
    const results = [];
    for (const timezone of ['UTC', 'Pacific/Honolulu', 'Asia/Yangon']) {
      process.env.TZ = timezone;
      results.push(normalizeReportPeriod({ range: 'yesterday' }, '2026-03-01'));
    }
    assert.deepEqual(results.map((entry) => entry.values), [
      ['2026-02-28', '2026-02-28'],
      ['2026-02-28', '2026-02-28'],
      ['2026-02-28', '2026-02-28'],
    ]);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
  assert.equal(
    timestampPredicate('s.created_at'),
    "s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')"
  );
});

test('all five period routes reject invalid ranges before report queries', async (t) => {
  const originalQuery = pool.query;
  t.after(() => { pool.query = originalQuery; });

  for (const path of ['/summary', '/sales-trend', '/top-products', '/payment-methods', '/refunds']) {
    const calls = [];
    pool.query = async (sql, values) => {
      calls.push({ sql: String(sql), values });
      return { rows: [{ today: '2026-10-14' }] };
    };
    const res = responseRecorder();
    await reportHandler(path)(
      { query: { range: 'custom', from: '2026-10-15', to: '2026-10-15' } },
      res
    );
    assert.equal(res.statusCode, 400, path);
    assert.match(res.body.error, /future/, path);
    assert.equal(calls.length, 1, `${path} must reject before report SQL`);
  }
});

test('all five period routes use identical parameterized half-open custom bounds', async (t) => {
  const originalQuery = pool.query;
  t.after(() => { pool.query = originalQuery; });
  const bounds = ['2026-10-10', '2026-10-12'];

  for (const path of ['/summary', '/sales-trend', '/top-products', '/payment-methods', '/refunds']) {
    const calls = [];
    pool.query = async (sql, values) => {
      const text = String(sql);
      calls.push({ sql: text, values });
      if (text.includes('CURRENT_DATE::text')) return { rows: [{ today: '2026-10-14' }] };
      if (path === '/summary') {
        if (text.includes('gross_units_sold')) return { rows: [{ gross_cogs: 0, gross_units_sold: 0 }] };
        if (text.includes('refunded_units')) return { rows: [{ refunded_cogs: 0, refunded_units: 0 }] };
        if (text.includes('refund_count')) return { rows: [{ refund_count: 0, refund_amount: 0, refunded_tax: 0 }] };
        return { rows: [{ gross_sales: 0, gross_tax: 0, transactions: 0, discounts: 0 }] };
      }
      return { rows: [] };
    };

    const res = responseRecorder();
    await reportHandler(path)(
      { query: { range: 'custom', from: bounds[0], to: bounds[1], limit: '10' } },
      res
    );
    assert.equal(res.statusCode, 200, path);
    const reportCalls = calls.slice(1);
    assert.ok(reportCalls.length > 0, `${path} must execute report SQL`);
    for (const call of reportCalls) {
      assert.deepEqual(call.values.slice(0, 2), bounds, path);
      assert.match(call.sql, />= \$1::date/);
      assert.match(call.sql, /< \(\$2::date \+ INTERVAL '1 day'\)/);
    }
  }
});

test('refund event semantics and detail limit remain unchanged', () => {
  const source = require('fs').readFileSync(require.resolve('../routes/reports'), 'utf8');
  assert.match(source, /created_at >= \$1::date/);
  assert.match(source, /refunded_at >= \$1::date/);
  assert.match(source, /grossSales - refundAmount/);
  assert.match(source, /grossCogs - refundedCogs/);
  assert.match(source, /LIMIT 50/);
});
