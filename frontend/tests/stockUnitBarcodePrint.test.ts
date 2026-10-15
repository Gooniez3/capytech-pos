import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStockUnitBarcodePrintDocument } from '../src/lib/stockUnitBarcode.ts';

const documentHtml = buildStockUnitBarcodePrintDocument({
  unit_code: 'CT000003',
  product_name: 'Aula S12 pro 1000hz',
  variant_name: 'White',
  manufacturer_serial_number: 'MSS12ProBk260800851',
  barcode: 'data:image/png;base64,EXACT_CT_IMAGE',
});

test('CT print document carries the exact permanent code and generated barcode', () => {
  assert.match(documentHtml, /CT000003/);
  assert.match(documentHtml, /data:image\/png;base64,EXACT_CT_IMAGE/);
  assert.match(documentHtml, /Aula S12 pro 1000hz - White/);
  assert.match(documentHtml, /MSS12ProBk260800851/);
});

test('CT print lifecycle is explicit and single-shot rather than automatic', () => {
  assert.match(documentHtml, /id="print-label"/);
  assert.match(documentHtml, /if\(printing\)return/);
  assert.match(documentHtml, /addEventListener\('afterprint'/);
  assert.doesNotMatch(documentHtml, /image\.complete|image\.onload|setTimeout\([^)]*window\.print/);
  assert.equal((documentHtml.match(/window\.print\(\)/g) || []).length, 1);
});

test('print-label text is HTML escaped', () => {
  const hostile = buildStockUnitBarcodePrintDocument({
    unit_code: 'CT000003', product_name: '<script>alert(1)</script>',
    variant_name: '"White"', manufacturer_serial_number: "A&B'", barcode: 'data:image/png;base64,x',
  });
  assert.doesNotMatch(hostile, /<script>alert/);
  assert.match(hostile, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(hostile, /&quot;White&quot;/);
  assert.match(hostile, /A&amp;B&#039;/);
});
