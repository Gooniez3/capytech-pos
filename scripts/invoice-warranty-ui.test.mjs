import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoiceWarrantyDisplay } from '../frontend/src/lib/warranty.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const invoiceSource = fs.readFileSync(
  path.join(projectRoot, 'frontend', 'src', 'pages', 'InvoicePage.tsx'),
  'utf8'
);

test('stored warranty values render the expected prominent duration', () => {
  assert.deepEqual(invoiceWarrantyDisplay(1), {
    duration: '1 MONTH',
    detail: 'Valid from the invoice date. Keep this invoice as proof of purchase.',
    state: 'covered',
  });
  for (const months of [3, 6, 12]) {
    assert.equal(invoiceWarrantyDisplay(months).duration, `${months} MONTHS`);
    assert.equal(invoiceWarrantyDisplay(months).state, 'covered');
  }
});

test('no-warranty and historical invoices remain explicit and distinct', () => {
  assert.deepEqual(invoiceWarrantyDisplay(0), {
    duration: 'NO WARRANTY',
    detail: 'No shop warranty was selected for this invoice.',
    state: 'none',
  });
  assert.deepEqual(invoiceWarrantyDisplay(null), {
    duration: 'NOT RECORDED',
    detail: 'Warranty was not recorded for this historical invoice.',
    state: 'historical',
  });
});

test('invoice panel consumes the stored value and never recalculates or hardcodes a duration', () => {
  assert.match(
    invoiceSource,
    /invoiceWarrantyDisplay\(\s*invoice\.warrantyMonths\s*\)/
  );
  assert.doesNotMatch(invoiceSource, /suggestWarrantyMonths/);
  assert.doesNotMatch(invoiceSource, /12 MONTHS/);
});

test('warranty panel is directly below totals and uses print-safe responsive styling', () => {
  const totals = invoiceSource.indexOf('TOTALS');
  const warranty = invoiceSource.indexOf('data-testid="invoice-warranty-panel"');
  const refund = invoiceSource.indexOf('REFUND INFORMATION');
  assert.ok(totals >= 0 && warranty > totals && refund > warranty);
  assert.match(invoiceSource, /ShieldCheck/);
  assert.match(invoiceSource, /Shop Warranty/);
  assert.match(invoiceSource, /break-inside-avoid/);
  assert.match(invoiceSource, /print:border-black/);
  assert.match(invoiceSource, /print:bg-white/);
  assert.match(invoiceSource, /print:text-black/);
  assert.match(invoiceSource, /sm:flex-row/);
  assert.match(invoiceSource, /print:flex-row/);
  assert.doesNotMatch(invoiceSource, /min-h-\[297mm\]/);
  assert.match(invoiceSource, /min-height: auto !important/);
});
