import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = await readFile(
  new URL('../src/components/reports/HistoricalSalesPanel.tsx', import.meta.url),
  'utf8'
);
const reports = await readFile(
  new URL('../src/pages/ReportsPage.tsx', import.meta.url),
  'utf8'
);

test('Reports exposes distinct Current Reports and Historical Sales tabs', () => {
  assert.match(reports, />\s*Current Reports\s*</);
  assert.match(reports, />\s*Historical Sales\s*</);
  assert.match(reports, /<HistoricalSalesPanel \/>/);
});

test('historical import requires all three named files, preview, and explicit confirmation', () => {
  for (const name of ['historical-sales.csv', 'monthly-sales-summary.csv', 'all-time-sales-summary.csv']) {
    assert.match(panel, new RegExp(name.replace('.', '\\.')));
  }
  assert.match(panel, /historical\/preview/);
  assert.match(panel, /IMPORT ARCHIVED SALES/);
  assert.match(panel, /ConfirmDialog/);
});

test('historical records are labeled read-only and have no mutation actions', () => {
  assert.match(panel, /Archived \/ Legacy POS/);
  assert.match(panel, /read-only/);
  assert.match(panel, /may share numbers with current invoices/);
  assert.doesNotMatch(panel, /Refund Sale|Restore Inventory|Delete Transaction|Edit Transaction/);
});

test('legacy timestamps render from text parts and CSV cells neutralize formulas', () => {
  assert.match(panel, /browser[\s\S]*cannot silently reinterpret/);
  assert.match(panel, /legacy local time/);
  assert.match(panel, /\^\[=\+\\-@\\t\\r\]/);
  assert.match(panel, /safe\.replace\(\/"\/g, '""'\)/);
});
