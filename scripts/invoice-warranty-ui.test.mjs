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
  });
  for (const months of [3, 6, 12]) {
    assert.equal(invoiceWarrantyDisplay(months).duration, `${months} MONTHS`);
  }
});

test('no-warranty and historical invoices remain explicit and distinct', () => {
  assert.deepEqual(invoiceWarrantyDisplay(0), {
    duration: 'NO WARRANTY',
  });
  assert.deepEqual(invoiceWarrantyDisplay(null), {
    duration: 'NOT RECORDED',
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

test('warranty panel contains the required text-only presentation', () => {
  const totals = invoiceSource.indexOf('TOTALS');
  const warranty = invoiceSource.indexOf('data-testid="invoice-warranty-panel"');
  const refund = invoiceSource.indexOf('REFUND INFORMATION');
  assert.ok(totals >= 0 && warranty > totals && refund > warranty);
  assert.match(invoiceSource, /WARRANTY &amp; PURCHASE INFORMATION/);
  assert.match(invoiceSource, /Shop Warranty/);
  assert.match(invoiceSource, /Warranty Period:/);
  assert.match(invoiceSource, /From the purchase date/);
  assert.match(
    invoiceSource,
    /Please retain this invoice as proof of purchase for warranty claims\s*and after-sales support\. Warranty coverage is subject to shop terms\s*and conditions\./
  );
  assert.doesNotMatch(invoiceSource, /ShieldCheck/);
  assert.doesNotMatch(invoiceSource, /invoice reference/i);
});

test('warranty panel is compact and protected from awkward print page breaks', () => {
  assert.match(invoiceSource, /break-inside-avoid/);
  assert.match(invoiceSource, /print:border-black/);
  assert.match(invoiceSource, /print:bg-white/);
  assert.match(invoiceSource, /print:text-black/);
  assert.doesNotMatch(invoiceSource, /min-h-\[297mm\]/);
  assert.match(invoiceSource, /min-height: auto !important/);
});
