import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reportsPage = await readFile(
  new URL('../src/pages/ReportsPage.tsx', import.meta.url),
  'utf8'
);

test('existing presets remain and Yesterday plus custom dates are available', () => {
  for (const range of ['today', 'yesterday', 'week', 'month', 'year']) {
    assert.match(reportsPage, new RegExp(`'${range}'`));
  }
  assert.match(reportsPage, /type="date"/);
  assert.match(reportsPage, /From Date/);
  assert.match(reportsPage, /To Date/);
  assert.match(reportsPage, /Apply Dates/);
});

test('custom validation rejects incomplete, reversed, and future periods', () => {
  assert.match(reportsPage, /if \(!customFrom \|\| !customTo\)/);
  assert.match(reportsPage, /if \(customFrom > customTo\)/);
  assert.match(reportsPage, /if \(customTo > today\)/);
  assert.match(reportsPage, /max=\{localDateOnly\(\)\}/);
  assert.match(reportsPage, /range=custom&from=\$\{encodeURIComponent\(customFrom\)\}&to=\$\{encodeURIComponent\(customTo\)\}/);
});

test('all five displayed report requests use one applied period query', () => {
  for (const endpoint of ['summary', 'sales-trend', 'top-products', 'payment-methods', 'refunds']) {
    assert.match(reportsPage, new RegExp(`/api/reports/${endpoint}\\?\\$\\{period\\.query\\}`));
  }
  assert.match(reportsPage, /const \[\s*summaryData,[\s\S]*?\] = await Promise\.all/);
  assert.match(reportsPage, /setLoadedPeriod\(period\)/);
});

test('stale or failed requests cannot partially replace a successful report', () => {
  assert.match(reportsPage, /const requestId = \+\+reportRequestRef\.current/);
  assert.match(reportsPage, /if \(requestId !== reportRequestRef\.current\) return/);
  assert.match(reportsPage, /setSummary\([\s\S]*?setTrend\([\s\S]*?setTopProducts\([\s\S]*?setPayments\([\s\S]*?setRefunds\(/);
  assert.match(reportsPage, /previous successful report remains displayed/);
  assert.doesNotMatch(reportsPage, /setSummary\(null\)/);
});

test('low-stock data loads independently rather than on each period change', () => {
  const periodLoader = reportsPage.slice(
    reportsPage.indexOf('async function loadReports'),
    reportsPage.indexOf('function selectPreset')
  );
  assert.doesNotMatch(periodLoader, /\/api\/reports\/low-stock/);
  assert.match(reportsPage, /async function loadLowStock\(\)/);
  assert.match(reportsPage, /\/api\/reports\/low-stock/);
});

test('Excel and displayed labels stay tied to the successfully loaded period', () => {
  assert.match(reportsPage, /Reporting Period: \$\{loadedPeriod\.label\}/);
  assert.match(reportsPage, /loadedPeriod\.label.*Variant-level profitability/);
  assert.match(reportsPage, /CapyTech_Report_\$\{loadedPeriod\.range\}/);
  assert.match(reportsPage, /disabled=\{loading\}/);
  assert.match(reportsPage, /range=\{loadedPeriod\.chartRange\}/);
});

test('empty report collections retain the existing graceful empty states', () => {
  assert.match(reportsPage, /No product sales for this period/);
  assert.match(reportsPage, /No payment data for this period/);
  assert.match(reportsPage, /No refunds for this period/);
});
