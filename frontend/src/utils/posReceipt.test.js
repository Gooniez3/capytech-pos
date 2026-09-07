import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceFromCheckout, printReceipt, receiptHtml } from './posReceipt.js';

test('checkout response is mapped into a printable invoice', () => {
  const invoice = invoiceFromCheckout({
    sale: {
      invoice_number: 'INV-000123',
      created_at: '2026-09-08T01:00:00.000Z',
      payment_method: 'kbzpay',
      customer_name: 'Ada',
      customer_phone: '091234',
      subtotal: '100.00',
      discount: '10.00',
      total: '90.00',
    },
    items: [{
      product_name: 'Mouse',
      variant_name: 'Black',
      quantity: 2,
      unit_price: '50.00',
      line_total: '100.00',
    }],
  });
  assert.equal(invoice.invoiceNumber, 'INV-000123');
  assert.equal(invoice.items[0].name, 'Mouse — Black');
  assert.equal(invoice.total, '90.00');
});

test('receipt HTML includes sale details and escapes customer text', () => {
  const html = receiptHtml({
    invoiceNumber: 'INV-000123',
    createdAt: '2026-09-08T01:00:00.000Z',
    paymentMethod: 'cash',
    customer: { name: '<script>Ada</script>', phone: '091234' },
    subtotal: 100,
    discount: 0,
    total: 100,
    items: [{ name: 'USB-C Hub', quantity: 1, lineTotal: 100 }],
  });
  assert.match(html, /INV-000123/);
  assert.match(html, /USB-C Hub/);
  assert.match(html, /Payment: cash/);
  assert.match(html, /&lt;script&gt;Ada&lt;\/script&gt;/);
  assert.equal(html.includes('<script>Ada</script>'), false);
});

test('printReceipt writes the invoice into a popup window', () => {
  const writes = [];
  let printed = false;
  const popup = {
    document: {
      write(html) { writes.push(html); },
      close() {},
    },
    focus() {},
    print() { printed = true; },
  };
  assert.equal(printReceipt({ invoiceNumber: 'INV-1', items: [] }, () => popup), true);
  assert.equal(printed, true);
  assert.match(writes[0], /INV-1/);
  assert.equal(printReceipt({ invoiceNumber: 'INV-1', items: [] }, () => null), false);
});
