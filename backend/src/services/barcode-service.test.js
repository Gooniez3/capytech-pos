const test = require('node:test');
const assert = require('node:assert/strict');
const { barcodeOptions, generateBarcodeDataUrl } = require('./barcode-service');

test('CT barcode generation encodes the exact permanent stock-unit code', async () => {
  const options = barcodeOptions(' CT000003 ');
  assert.equal(options.bcid, 'code128');
  assert.equal(options.text, 'CT000003');
  assert.equal(options.includetext, true);
  assert.match(await generateBarcodeDataUrl('CT000003'), /^data:image\/png;base64,/);
});

test('CP barcode generation behavior remains unchanged', () => {
  assert.equal(barcodeOptions('CP000123').text, 'CP000123');
  assert.throws(() => barcodeOptions('   '), /required/);
});
