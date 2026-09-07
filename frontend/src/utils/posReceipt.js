function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

export function invoiceFromCheckout(response) {
  const sale = response?.sale || {};
  const items = Array.isArray(response?.items) ? response.items : [];
  return {
    invoiceNumber: sale.invoice_number || '',
    createdAt: sale.created_at || new Date().toISOString(),
    cashier: sale.cashier_name || '',
    paymentMethod: sale.payment_method || '',
    customer: {
      name: sale.customer_name || null,
      phone: sale.customer_phone || null,
    },
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    items: items.map((item) => ({
      name: item.variant_name
        ? `${item.product_name} — ${item.variant_name}`
        : item.product_name || item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,
    })),
  };
}

export function receiptHtml(invoice) {
  const itemRows = (invoice.items || [])
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.name)} × ${escapeHtml(item.quantity)}</td>
        <td class="right">₱${money(item.lineTotal)}</td>
      </tr>
    `)
    .join('');

  const customer = invoice.customer?.name
    ? `<p>Customer: ${escapeHtml(invoice.customer.name)}${invoice.customer.phone ? ` · ${escapeHtml(invoice.customer.phone)}` : ''}</p>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 16px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p, td { font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    td { padding: 4px 0; vertical-align: top; }
    .right { text-align: right; white-space: nowrap; }
    .totals td { border-top: 1px solid #ddd; padding-top: 8px; font-weight: 600; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>CapyTech POS</h1>
  <p>Computer Accessories</p>
  <p>${escapeHtml(invoice.invoiceNumber)}</p>
  <p>${escapeHtml(invoice.createdAt ? new Date(invoice.createdAt).toLocaleString() : '')}</p>
  <p>Payment: ${escapeHtml(invoice.paymentMethod)}</p>
  ${customer}
  <table>
    ${itemRows}
    <tr><td>Subtotal</td><td class="right">₱${money(invoice.subtotal)}</td></tr>
    <tr><td>Discount</td><td class="right">₱${money(invoice.discount)}</td></tr>
    <tr class="totals"><td>Total</td><td class="right">₱${money(invoice.total)}</td></tr>
  </table>
  <p>Thank you</p>
</body>
</html>`;
}

export function printReceipt(invoice, openWindow = (...args) => window.open(...args)) {
  const popup = openWindow('', '_blank', 'width=480,height=720');
  if (!popup) return false;
  popup.document.write(receiptHtml(invoice));
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}
