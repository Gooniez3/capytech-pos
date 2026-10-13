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

test('inline category creation preserves the draft and selects the created category', () => {
  assert.match(source, /\+ New Category/);
  assert.match(source, /api\.post<ApiCategory>\('\/api\/categories', \{ name \}\)/);
  assert.match(source, /api\.get<ApiCategory\[]>\('\/api\/categories'\)/);
  assert.match(source, /setForm\(\(current\) => \(\{ \.\.\.current, categoryId: String\(created\.id\) \}\)\)/);
  assert.match(source, /Category name is required\./);
  assert.match(source, /setCategoryError\(error instanceof Error \? error\.message/);
  assert.doesNotMatch(source, /setForm\(emptyForm\);[\s\S]{0,200}createCategory/);
});

test('product UX validates prices and stock while product identities are server generated', () => {
  assert.match(source, /selling price is required and must be greater than zero/);
  assert.match(source, /opening stock and reorder level must be non-negative whole numbers/);
  assert.match(source, /Automatically generated on save/);
  assert.doesNotMatch(source, /label="SKU \/ Scan Code"/);
  assert.doesNotMatch(source, /sku: form\.sku\.trim/);
  assert.match(source, /serial numbers must be valid and unique/);
  assert.match(source, /automatically create Stock Units/);
  assert.match(source, /Use Restock from the Products list to receive inventory/);
  assert.match(source, /compactMobile/);
});
