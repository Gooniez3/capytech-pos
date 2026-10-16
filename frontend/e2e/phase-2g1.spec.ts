import { expect, test, type Locator, type Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const password = 'E2eOnly!2026';

async function login(page: Page, username = 'e2e_admin') {
  await page.goto('/login');
  await page.getByPlaceholder('Enter your username').fill(username);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function selectOptionContaining(select: Locator, text: string) {
  const value = await select.locator('option').filter({ hasText: text }).first().getAttribute('value');
  if (!value) throw new Error(`Option containing "${text}" was not found`);
  await select.selectOption(value);
}

async function addProduct(page: Page, name: string) {
  const search = page.getByPlaceholder('Search products or scan barcode, then press Enter...');
  await search.fill(name);
  const product = page.getByRole('button', { name: new RegExp(name) }).first();
  await expect(product).toBeVisible();
  await product.click();
  await search.fill('');
}

async function openCheckout(page: Page) {
  await page.getByRole('button', { name: 'Complete Sale' }).click();
  await expect(page.getByRole('heading', { name: 'Complete Sale' })).toBeVisible();
}

async function saveInventoryPolicy(page: Page) {
  const message = page.getByText('Inventory policy saved.', { exact: true });
  await expect(message).toHaveCount(0);
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(message).toHaveCount(1);
  const notification = message.locator('..');
  await expect(notification).toBeVisible();
  await notification.getByRole('button').click();
  await expect(message).toHaveCount(0);
}

async function selectPhysicalUnit(page: Page, serial: string, exerciseDismissals = false) {
  const input = page.getByPlaceholder('Scan or enter manufacturer SN / SU- code').first();
  const openConfirmation = async () => {
    await input.fill(serial);
    await input.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Confirm Physical Unit' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(dialog.getByText(serial, { exact: true })).toBeVisible();
    return dialog;
  };

  let confirmation = await openConfirmation();
  if (exerciseDismissals) {
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Complete Sale' })).toBeVisible();
    await expect(input).toBeFocused();

    confirmation = await openConfirmation();
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Complete Sale' })).toBeVisible();

    confirmation = await openConfirmation();
    await page.locator('[data-modal-root]').last().locator('[data-modal-backdrop]').click({ position: { x: 2, y: 2 } });
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Complete Sale' })).toBeVisible();

    confirmation = await openConfirmation();
  }
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Confirm & Add to Cart' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Complete Sale' })).toBeVisible();
}

async function addSerializedProductByCpSearch(page: Page, cpCode: string, productName: string) {
  const search = page.getByPlaceholder('Search products or scan barcode, then press Enter...');
  await search.fill(cpCode);

  const product = page.getByRole('button', { name: new RegExp(productName) }).first();
  await expect(product).toBeVisible();
  await expect(product.getByText(cpCode, { exact: true })).toBeVisible();
  await product.click();
  await expect(page.getByText(`${productName} added to cart.`, { exact: true })).toBeVisible();
  await search.fill('');
}

async function addProductByCpBarcode(page: Page, cpCode: string, productName: string) {
  const search = page.getByPlaceholder('Search products or scan barcode, then press Enter...');
  await search.fill(cpCode);
  await search.press('Enter');

  const confirmation = page.getByRole('dialog', { name: 'Scanned Product' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByText(productName, { exact: true })).toBeVisible();
  const barcodeField = confirmation.locator('p').filter({ hasText: /^Barcode:/ });
  await expect(barcodeField.getByText(cpCode, { exact: true })).toBeVisible();
  await confirmation.getByRole('button', { name: 'Confirm & Add to Cart' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText(`${productName} added to cart.`, { exact: true })).toBeVisible();
}

async function finishCashSale(page: Page, doubleClick = false) {
  const loadSales = () => page.evaluate(async () => {
    const token = localStorage.getItem('pos-auth-token');
    const response = await fetch('/api/sales', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await response.json();
    return { ok: response.ok, status: response.status, rows: Array.isArray(body) ? body : body.sales ?? [] };
  });
  const beforeResult = await loadSales();
  expect(beforeResult.ok, `GET /api/sales returned HTTP ${beforeResult.status}`).toBe(true);
  const before = beforeResult.rows.length;
  const confirm = page.getByRole('button', { name: /^Confirm / });
  if (doubleClick) await confirm.click({ clickCount: 2, delay: 10 });
  else await confirm.click();
  const receipt = page.getByRole('dialog', { name: 'Sale Completed' });
  await expect(receipt).toBeVisible();
  const invoice = (await receipt.getByText(/^INV-\d+$/).textContent())!;
  const receiptText = await receipt.textContent();
  await expect.poll(async () => {
    const result = await loadSales();
    return result.ok ? result.rows.length : -result.status;
  }, { message: 'the completed sale to appear exactly once in sales history' }).toBe(before + 1);
  const { rows } = await loadSales();
  expect(rows).toHaveLength(before + 1);
  const savedSale = rows.find((sale: { invoice_number?: string }) => sale.invoice_number === invoice);
  expect(savedSale?.id).toBeTruthy();
  await page.keyboard.press('Escape');
  return { invoice, saleId: savedSale.id as number, receiptText: receiptText || '' };
}

test('Phase 3F.2 consolidated product, inventory, checkout, and warranty workflows', async ({ browser }) => {
  const adminContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await adminContext.newPage();
  let firstCtCode = '';

  await test.step('admin login and product/variant policies', async () => {
    await login(page);
    await expect(page.getByRole('link', { name: 'Stock Units' })).toBeVisible();
    await page.getByRole('link', { name: 'Stock Units' }).click();
    await expect(page.getByRole('heading', { name: 'Inventory policy' })).toBeVisible();

    const policySelects = page.locator('select');
    await selectOptionContaining(policySelects.nth(0), 'E2E Serialized Device');
    await policySelects.nth(2).selectOption('on');
    await page.getByPlaceholder('One manufacturer serial per line').fill('SN-0001\nSN-0002');
    await saveInventoryPolicy(page);

    await selectOptionContaining(policySelects.nth(0), 'E2E Warranty Device');
    await policySelects.nth(3).selectOption('on');
    await policySelects.nth(4).selectOption('6');
    await saveInventoryPolicy(page);

    await selectOptionContaining(policySelects.nth(0), 'E2E Variant Device');
    await selectOptionContaining(policySelects.nth(1), 'Red');
    await expect(policySelects.nth(2)).toHaveValue('inherit');
    await policySelects.nth(2).selectOption('on');
    await page.getByPlaceholder('One manufacturer serial per line').fill('VAR-RED-001');
    await saveInventoryPolicy(page);
  });

  await test.step('receiving, lookup, filters, and immutable unit detail', async () => {
    await page.getByRole('button', { name: 'Receive units' }).click();
    const modal = page
      .getByPlaceholder('One manufacturer serial per line')
      .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " relative ")][1]');
    await selectOptionContaining(modal.locator('select').nth(0), 'E2E Serialized Device');
    const longSerial = `SN-LONG-${'1234567890'.repeat(10)}`;
    await modal.getByPlaceholder('One manufacturer serial per line').fill(longSerial);
    await modal.getByRole('button', { name: 'Receive units' }).click();
    await expect(page.getByText('1 stock unit received.')).toBeVisible();

    const stockUnitSearch = page.getByPlaceholder('Search CT code, serial, product, or variant');
    await stockUnitSearch.fill(longSerial);
    await expect(page.getByText(longSerial, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByRole('heading', { name: /^CT\d{6,}$/ })).toBeVisible();
    await expect(page.getByText('Immutable history')).toBeVisible();
    await page.keyboard.press('Escape');
    await stockUnitSearch.fill('SN-0001');
    const firstUnitRow = page.getByRole('row').filter({ hasText: 'SN-0001' });
    await expect(firstUnitRow).toBeVisible();
    firstCtCode = (await firstUnitRow.getByText(/^CT\d{6,}$/).textContent())?.trim() || '';
    expect(firstCtCode).toMatch(/^CT\d{6,}$/);
    await stockUnitSearch.fill('');
    const stateFilter = page.getByRole('combobox').filter({
      has: page.getByRole('option', { name: 'All states', exact: true }),
    });
    await stateFilter.selectOption({ label: 'available' });
    await expect(stateFilter).toHaveValue('available');
    await expect(page.getByRole('cell', { name: 'available', exact: true })).toHaveCount(4);
  });

  await test.step('staff login has read-only stock-unit access', async () => {
    const staffContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const staffPage = await staffContext.newPage();
    await login(staffPage, 'e2e_staff');
    await staffPage.goto('/stock-units');
    await expect(staffPage.getByRole('heading', { name: 'Stock Units' })).toBeVisible();
    await expect(staffPage.getByRole('heading', { name: 'Inventory policy' })).toHaveCount(0);
    await expect(staffPage.getByRole('button', { name: 'Receive units' })).toHaveCount(0);
    await expect(staffPage.getByRole('button', { name: 'Details' }).first()).toBeVisible();
    await staffContext.close();
  });

  let serializedInvoice = '';
  let serializedSaleId = 0;
  let serializedCtCode = '';
  await test.step('serialized checkout, manual scan confirmation, and duplicate-click protection', async () => {
    await page.goto('/pos');
    expect(firstCtCode).toMatch(/^CT\d{6,}$/);
    const productCard = page.getByRole('button', { name: /E2E Serialized Device/ }).first();
    await expect(productCard).toBeVisible();
    const cpCode = (await productCard.getByText(/^CP\d{6,}$/).textContent())?.trim() || '';
    expect(cpCode).toMatch(/^CP\d{6,}$/);
    await addSerializedProductByCpSearch(page, cpCode, 'E2E Serialized Device');
    await openCheckout(page);
    await expect(page.getByText('0 / 1 selected')).toBeVisible();
    await selectPhysicalUnit(page, firstCtCode, true);
    await expect(page.getByText('1 / 1 selected')).toBeVisible();
    const sale = await finishCashSale(page, true);
    serializedInvoice = sale.invoice;
    serializedSaleId = sale.saleId;
    expect(serializedInvoice).toMatch(/^INV-\d+$/);
    expect(sale.receiptText).toContain('E2E Serialized Device');
    expect(sale.receiptText).toContain('SN-0001');
    serializedCtCode = firstCtCode;
  });

  let warrantyInvoice = '';
  await test.step('warranty-only V2 checkout stores item warranty', async () => {
    await page.goto('/pos');
    await addProduct(page, 'E2E Warranty Device');
    await openCheckout(page);
    await expect(page.getByText('Saved item warranties')).toBeVisible();
    const sale = await finishCashSale(page);
    warrantyInvoice = sale.invoice;
    expect(sale.receiptText).toContain('6 months');
  });

  await test.step('CP barcode scan selects the correct ordinary product for checkout', async () => {
    await page.goto('/pos');
    const productCard = page.getByRole('button', { name: /E2E Normal Item/ }).first();
    await expect(productCard).toBeVisible();
    const cpCode = (await productCard.getByText(/^CP\d{6,}$/).textContent())?.trim() || '';
    expect(cpCode).toMatch(/^CP\d{6,}$/);
    await addProductByCpBarcode(page, cpCode, 'E2E Normal Item');
    await openCheckout(page);
    const checkout = page.getByRole('dialog', { name: 'Complete Sale' });
    await expect(checkout.getByText('1 item • 20,000 Ks', { exact: true })).toBeVisible();
    await expect(page.getByText('Invoice Warranty')).toBeVisible();
    const sale = await finishCashSale(page);
    expect(sale.receiptText).toContain('E2E Normal Item');
  });

  await test.step('mixed cart requires exact serialized unit selection', async () => {
    await page.goto('/pos');
    await addProduct(page, 'E2E Serialized Device');
    await addProduct(page, 'E2E Normal Item');
    await addProduct(page, 'E2E Warranty Device');
    await openCheckout(page);
    await expect(page.getByText('0 / 1 selected')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Confirm / })).toBeDisabled();
    await selectPhysicalUnit(page, 'SN-0002', true);
    await expect(page.getByRole('button', { name: /^Confirm / })).toBeEnabled();
    await finishCashSale(page);
  });

  await test.step('competing checkout produces explicit conflict review', async () => {
    const rivalContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const rival = await rivalContext.newPage();
    await login(rival);

    for (const target of [page, rival]) {
      await target.goto('/pos');
      await addProduct(target, 'E2E Serialized Device');
      await openCheckout(target);
      await selectPhysicalUnit(target, `SN-LONG-${'1234567890'.repeat(10)}`);
    }

    await finishCashSale(page);
    await rival.getByRole('button', { name: /^Confirm / }).click();
    await expect(rival.getByText(/select and confirm every physical unit again before retrying/i)).toBeVisible();
    await expect(rival.getByRole('button', { name: /^Confirm / })).toBeDisabled();
    await expect(rival.getByRole('button', { name: 'I reviewed the cart' })).toBeVisible();
    await rivalContext.close();
  });

  await test.step('warranty lookup supports invoice, manufacturer serial, and SU code', async () => {
    await page.goto('/warranty-lookup');
    const kind = page.locator('select').first();
    const input = page.locator('input').first();
    await kind.selectOption('invoice_number');
    await input.fill(warrantyInvoice);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('6 months', { exact: false }).first()).toBeVisible();

    await kind.selectOption('serial_number');
    await input.fill('SN-0001');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText(new RegExp(`^${serializedInvoice} · `))).toBeVisible();

    await kind.selectOption('unit_code');
    await input.fill(serializedCtCode);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('SN-0001', { exact: true })).toBeVisible();
  });

  await test.step('refund quarantines serialized unit and sale history shows refunded status', async () => {
    await page.goto('/sales');
    await page.getByPlaceholder('Search by invoice number...').fill(serializedInvoice);
    await page.getByRole('row').filter({ hasText: serializedInvoice }).click();
    await page.getByRole('button', { name: 'Refund' }).click();
    await page.getByPlaceholder('Example: Customer returned defective item...').fill('Phase 2G.1 browser refund');
    await page.getByRole('button', { name: 'Confirm Refund' }).click();
    await expect(page.getByText(`${serializedInvoice} refunded successfully.`)).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Refunded', exact: true })).toBeVisible();

    await page.goto('/stock-units');
    await page.getByPlaceholder('Search CT code, serial, product, or variant').fill('SN-0001');
    await expect(page.getByRole('table').getByText('quarantined', { exact: true })).toBeVisible();
  });

  await test.step('sale details and A4 print rendering use saved snapshots', async () => {
    await page.goto('/sales');
    await page.getByPlaceholder('Search by invoice number...').fill(warrantyInvoice);
    await page.getByRole('row').filter({ hasText: warrantyInvoice }).click();
    await expect(page.getByText(/6 months/).first()).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(`/invoice/${serializedSaleId}`);
    await expect(page.getByText('SN-0001', { exact: false })).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    const overflow = await page.locator('.invoice-page').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    const database = process.env.CAPYTECH_E2E_DB_NAME!;
    const artifactRoot = path.join(os.tmpdir(), 'capytech-e2e', database);
    await page.pdf({
      path: path.join(artifactRoot, 'invoice-a4.pdf'),
      format: 'A4',
      printBackground: true,
    });
  });

  await adminContext.close();
});
