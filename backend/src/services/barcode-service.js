const bwipjs = require('bwip-js');

async function generateBarcodeDataUrl(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('Barcode value is required');
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
    paddingwidth: 8,
    paddingheight: 8,
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = { generateBarcodeDataUrl };
