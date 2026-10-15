export interface StockUnitBarcodeLabel {
  unit_code: string;
  product_name: string;
  variant_name: string | null;
  manufacturer_serial_number: string;
  barcode: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] || character));
}

export function buildStockUnitBarcodePrintDocument(label: StockUnitBarcodeLabel): string {
  const code = escapeHtml(label.unit_code);
  const name = `${escapeHtml(label.product_name)}${
    label.variant_name ? ` - ${escapeHtml(label.variant_name)}` : ''
  }`;
  const serial = escapeHtml(label.manufacturer_serial_number);
  const barcode = escapeHtml(label.barcode);
  return `<!doctype html><html><head><meta charset="UTF-8"><title>CT Barcode - ${code}</title><style>
    @page{size:50mm 30mm;margin:0}*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,sans-serif;background:#fff}
    .toolbar{display:flex;justify-content:center;padding:12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}.toolbar button{border:0;border-radius:8px;background:#0f172a;color:#fff;padding:9px 16px;font-weight:700;cursor:pointer}
    .label{box-sizing:border-box;width:50mm;height:30mm;padding:2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;margin:12px auto}
    img{width:42mm;height:12mm;object-fit:contain}.code{font:700 8pt monospace}.name,.serial{max-width:46mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:7pt}.name{font-weight:700}
    @media print{.toolbar{display:none}.label{margin:0}html,body{width:50mm;height:30mm;overflow:hidden}}
  </style></head><body><div class="toolbar"><button id="print-label" type="button">Print CT Barcode</button></div><div class="label"><img id="barcode" src="${barcode}" alt="${code}"><div class="code">${code}</div><div class="name">${name}</div><div class="serial">SN: ${serial}</div></div><script>
    (()=>{let printing=false;const button=document.getElementById('print-label');button.addEventListener('click',()=>{if(printing)return;printing=true;button.disabled=true;window.focus();window.print();});window.addEventListener('afterprint',()=>{printing=false;button.disabled=false;});})();
  </script></body></html>`;
}
