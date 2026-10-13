import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/ProductsPage.tsx', import.meta.url), 'utf8');

test('product form uses one workflow request and never sends editable aggregate stock', () => {
  assert.match(source, /\/api\/products\/workflow/);
  assert.match(source, /\/api\/products\/\$\{editingProduct\.id\}\/workflow/);
  assert.doesNotMatch(source, /productFormData\.append\(\s*['"]stock_quantity/);
  assert.match(source, /Current Stock \(read-only\)/);
});

test('serialized opening stock and variant prices are present in the unified form', () => {
  assert.match(source, /Opening manufacturer serial numbers/);
  assert.match(source, /Scan or enter one serial number per line/);
  assert.match(source, /serial_tracking_enabled/);
  assert.match(source, /price: variant\.price/);
  assert.match(source, /cost: variant\.cost/);
});

test('restock UI derives serialized quantity and reuses an idempotency key only for the same attempt', () => {
  assert.match(source, /title="Restock product"/);
  assert.match(source, /Quantity is derived from \{restockSerialCount\}/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /restockAttempt\.current\?\.signature !== signature/);
  assert.match(source, /idempotency_key: restockAttempt\.current\.key/);
  assert.match(source, /Current Stock \(read-only\)/);
});
