import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const posSource = await readFile(new URL('../src/pages/POSPage.tsx', import.meta.url), 'utf8');
const stockUnitsSource = await readFile(new URL('../src/pages/StockUnitsPage.tsx', import.meta.url), 'utf8');

test('POS resolves CT codes as physical units and retains explicit confirmation', () => {
  assert.match(posSource, /if \(isUnitBarcode\(code\)\)/);
  assert.match(posSource, /\/api\/stock-units\/lookup\?code=/);
  assert.match(posSource, /Confirm Physical Unit/);
  assert.match(posSource, /Confirm & Add to Cart/);
  assert.match(posSource, /Selling price/);
  assert.match(posSource, /Manufacturer serial/);
  assert.match(posSource, /This physical unit is already selected/);
  assert.match(posSource, /unit\.state !== 'available'/);
  assert.match(posSource, /\[pendingScannedUnit\.cartKey\]: \[pendingScannedUnit\.unit\]/);
});

test('CT matching reads the latest catalog and normalizes numeric and string IDs', () => {
  assert.match(posSource, /const productsRef = useRef<POSProduct\[\]>\(products\)/);
  assert.match(posSource, /productsRef\.current = products/);
  assert.match(
    posSource,
    /productsRef\.current\.find\(\(product\) =>\s*String\(product\.id\) === String\(unit\.product_id\)/
  );
  assert.doesNotMatch(
    posSource,
    /const parent = products\.find\(\(product\) =>\s*String\(product\.id\) === String\(unit\.product_id\)/
  );
});

test('catalog refreshes update the ref without restarting or changing scanner transports', () => {
  assert.match(posSource, /setProducts\(\s*productData\.map\(\s*mapProduct/);
  assert.match(posSource, /lookupBarcode\(\s*lastScan\.code/);
  assert.match(posSource, /await lookupBarcode\(search\)/);
  assert.match(posSource, /await lookupBarcode\(code\)/);
});

test('all scanner transports share one guarded confirmation lifecycle', () => {
  assert.match(posSource, /barcodeLookupInFlightRef\.current/);
  assert.match(posSource, /scanConfirmationPendingRef\.current/);
  assert.match(posSource, /lookupBarcode\(\s*lastScan\.code/);
  assert.match(posSource, /await lookupBarcode\(search\)/);
  assert.match(posSource, /await lookupBarcode\(code\)/);
  assert.match(posSource, /Serialized products must be scanned using their unique CT unit barcode/);
});

test('non-serialized scan preview uses the matched authoritative lookup values', () => {
  assert.match(posSource, /barcodeValue: result\.product_code \|\| code/);
  assert.match(posSource, /price: Number\(result\.price\)/);
  assert.match(posSource, /stock: Number\(result\.stock_quantity\)/);
  assert.match(posSource, />Cancel</);
});

test('Stock Units exposes permanent CT labels without changing invoice rendering', () => {
  assert.match(stockUnitsSource, /\/api\/stock-units\/\$\{unit\.id\}\/barcode/);
  assert.match(stockUnitsSource, /CT barcode/);
  assert.doesNotMatch(stockUnitsSource, />Internal ID</);
  assert.match(stockUnitsSource, /Print/);
  assert.doesNotMatch(stockUnitsSource, /InvoicePage/);
});
