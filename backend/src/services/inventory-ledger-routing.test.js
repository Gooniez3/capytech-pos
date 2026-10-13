const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const sales = readFileSync(join(root, 'routes', 'sales.js'), 'utf8');
const products = readFileSync(join(root, 'routes', 'products.js'), 'utf8');
const reversal = readFileSync(join(__dirname, 'sale-reversal.js'), 'utf8');

test('ordinary checkout and reversal use the quantity movement service', () => {
  assert.match(sales, /applyQuantityMovements\(domainTransaction/);
  assert.match(sales, /movementType: 'sold'/);
  assert.match(sales, /sourceReference: `checkout:\$\{idempotencyKey\}`/);
  assert.doesNotMatch(sales, /SET stock_quantity = stock_quantity -/);
  assert.match(reversal, /applyQuantityMovements\(transaction/);
  assert.match(reversal, /sourceReference: `sale:\$\{saleId\}:\$\{action\}`/);
  assert.doesNotMatch(reversal, /SET\s+stock_quantity/);
});

test('legacy product and variant stock writes fail closed', () => {
  assert.match(products, /code: 'PRODUCT_WORKFLOW_REQUIRED'/);
  assert.match(products, /code: 'DIRECT_QUANTITY_EDIT_FORBIDDEN'/);
  assert.match(products, /Create variants with zero stock, then use Restock/);
  assert.match(products, /\$5::integer IS NULL OR pv\.stock_quantity = \$5::integer/);
});

test('serialized checkout remains outside the quantity ledger', () => {
  assert.match(sales, /if \(variant\.serial_tracking_enabled !== true\) inventoryMutations\.push/);
  assert.match(sales, /if \(product\.serial_tracking_enabled !== true\) inventoryMutations\.push/);
  assert.match(sales, /await sellStockUnits\(domainTransaction/);
  assert.match(sales, /await quarantineSoldUnits\(transaction/);
});
