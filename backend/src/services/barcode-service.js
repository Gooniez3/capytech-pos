const bwipjs = require('bwip-js');

function barcodeOptions(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('Barcode value is required');
  return {
    bcid: 'code128',
    text,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
    paddingwidth: 8,
    paddingheight: 8,
  };
}

async function generateBarcodeDataUrl(value) {
  const png = await bwipjs.toBuffer(barcodeOptions(value));
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = { barcodeOptions, generateBarcodeDataUrl };
