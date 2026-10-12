import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('authenticated routes and role-dependent stock-unit controls are wired', async () => {
  const [app, sidebar, page] = await Promise.all([
    read('frontend/src/App.tsx'), read('frontend/src/components/layout/Sidebar.tsx'),
    read('frontend/src/pages/StockUnitsPage.tsx'),
  ]);
  assert.match(app, /ProtectedRoute><StockUnitsPage/);
  assert.match(app, /ProtectedRoute><WarrantyLookupPage/);
  assert.match(sidebar, /\/stock-units/);
  assert.match(sidebar, /\/warranty-lookup/);
  assert.match(page, /const admin = user\?\.role === 'admin'/);
  assert.match(page, /\{admin && <Card>/);
  assert.match(page, /effective_serial_tracking_enabled/);
  assert.match(page, /Inherit product/);
});

test('policy activation and stock receiving use exact serial batches', async () => {
  const page = await read('frontend/src/pages/StockUnitsPage.tsx');
  assert.match(page, /Boolean\(chosenVariant\) \|\| adoptionTargets\[0\]\.variantId === null/);
  assert.match(page, /adoptionInputs\[adoptionTargets\[0\]\.id\]/);
  assert.match(page, /payload\.serial_numbers = validateSerialBatch/);
  assert.match(page, /adoption_batches/);
  assert.match(page, /serialSetting === 'inherit' && chosenProduct\?\.effective_serial_tracking_enabled === true/);
  assert.match(page, /\/api\/stock-units\/\$\{batchOpen\}/);
  assert.match(page, /Retire & replace/);
  assert.match(page, /old serial remains reserved/i);
  assert.doesNotMatch(page, /api\.(post|patch|put)\([^\n]+stock_quantity/);
});

test('serialized checkout is explicit, idempotent, conflict-aware, and double-submit safe', async () => {
  const pos = await read('frontend/src/pages/POSPage.tsx');
  assert.match(pos, /checkout_contract_version: 2/);
  assert.match(pos, /product\.serialTrackingEnabled === true \|\| product\.shopWarrantyEnabled === true/);
  assert.match(pos, /checkoutContractVersion: usesCheckoutV2 \? 2 : 1/);
  assert.match(pos, /warrantyMonths: !usesCheckoutV2 && warrantyOverridden/);
  assert.match(pos, /stock_unit_ids: selectedUnitIds/);
  assert.match(pos, /checkoutKeyRef\.current/);
  assert.match(pos, /checkoutAttemptSignature/);
  assert.match(pos, /error instanceof ApiError && error\.status === 409/);
  assert.match(pos, /setSelectedStockUnits\(\{\}\)/);
  assert.match(pos, /I reviewed the cart/);
  assert.match(pos, /submittingSale \|\| Boolean\(checkoutConflict\) \|\| !serializedSelectionsComplete/);
  assert.match(pos, /refreshCartPoliciesBeforeCheckout/);
  assert.match(pos, /if \(!await refreshCartPoliciesBeforeCheckout\(\)\) return/);
  assert.match(pos, /latestCheckoutAttemptRef\.current !== startedCheckoutAttempt/);
  assert.match(pos, /!code \|\| checkoutSubmittingRef\.current/);
  assert.match(pos, /submittingSale \? 'pointer-events-none opacity-70'/);
  assert.match(pos, /Confirm Physical Unit/);
  assert.match(pos, /Product barcodes do not identify a physical unit/);
  assert.match(pos, /selectedStockUnits/);
  assert.match(pos, /Shop warranty: \{warrantySnapshotLabel\(item\)\}/);
  assert.match(pos, /unit\.manufacturer_serial_number_snapshot/);
});

test('warranty lookup and invoices render saved snapshots and long serials safely', async () => {
  const [lookup, invoice, sales] = await Promise.all([
    read('frontend/src/pages/WarrantyLookupPage.tsx'),
    read('frontend/src/pages/InvoicePage.tsx'),
    read('frontend/src/pages/SalesHistoryPage.tsx'),
  ]);
  assert.match(lookup, /\/api\/warranty-lookup/);
  assert.match(lookup, /Current product warranty settings are not consulted/);
  assert.match(invoice, /warrantySnapshotLabel\(item\)/);
  assert.match(invoice, /unit\.manufacturer_serial_number_snapshot|unit\.serialNumber/);
  assert.match(invoice, /invoice\.checkoutContractVersion !== 2/);
  assert.match(invoice, /overflow-wrap: anywhere/);
  assert.match(sales, /manufacturer_serial_number_snapshot/);
});
