import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const products = await readFile(new URL('../src/pages/ProductsPage.tsx', import.meta.url), 'utf8');
const pos = await readFile(new URL('../src/pages/POSPage.tsx', import.meta.url), 'utf8');

test('normal product creation leaves CP ownership to the backend', () => {
  assert.match(products, /Automatically generated on save/);
  assert.doesNotMatch(products, /label="SKU \/ Scan Code"/);
  assert.doesNotMatch(products, /product_code:\s*form/);
  assert.match(products, /Product added successfully: \$\{saved\.product\.product_code\}/);
});

test('CP scans use current catalog state and cannot bypass serialized selection', () => {
  assert.match(pos, /productsRef\.current\.find/);
  assert.match(pos, /Serialized products must be scanned using their unique CT unit barcode/);
  assert.match(pos, /This product has variants\. Scan the exact variant CP barcode/);
  assert.match(pos, /barcodeValue: result\.variant_product_code \|\| result\.product_code \|\| code/);
  assert.match(pos, /Confirm & Add to Cart/);
});

test('current catalog displays CP without changing checkout identity fields', () => {
  assert.match(products, /product\.product_code \|\| product\.sku/);
  assert.match(pos, /variant\.product_code \|\| variant\.sku/);
  assert.match(pos, /stock_unit_ids/);
});
