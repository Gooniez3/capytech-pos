import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stockUnitsPage = await readFile(
  new URL('../src/pages/StockUnitsPage.tsx', import.meta.url),
  'utf8'
);

test('stock-unit lifecycle actions use the shared confirmation dialog', () => {
  assert.doesNotMatch(stockUnitsPage, /window\.(?:alert|confirm|prompt)/);
  assert.match(stockUnitsPage, /<ConfirmDialog/);
  assert.match(stockUnitsPage, /type: 'release' \| 'retire'/);
  assert.match(stockUnitsPage, /onConfirm=\{confirmStockUnitAction\}/);
  assert.match(stockUnitsPage, /onCancel=\{cancelConfirmation\}/);
});

test('release explains the inventory effect and preserves the existing API payload', () => {
  assert.match(stockUnitsPage, /quarantined unit will return to available inventory/);
  assert.match(stockUnitsPage, /confirmLabel: 'Release to available'/);
  assert.match(stockUnitsPage, /`\/api\/stock-units\/\$\{action\.type\}`/);
  assert.match(stockUnitsPage, /unit_ids: \[action\.unitId\]/);
  assert.match(stockUnitsPage, /reason: reason\.trim\(\) \|\| null/);
});

test('retirement is permanent, dangerous, and keeps identity history reserved', () => {
  assert.match(stockUnitsPage, /title: `Permanently retire \$\{confirmation\.unitCode\}\?`/);
  assert.match(stockUnitsPage, /cannot return to available inventory/);
  assert.match(stockUnitsPage, /identity and history remain reserved/);
  assert.match(stockUnitsPage, /variant: 'danger' as const/);
});

test('serial correction shows CT and proposed serial while preserving its endpoint', () => {
  assert.match(stockUnitsPage, /title: `Correct serial for \$\{confirmation\.unitCode\}\?`/);
  assert.match(stockUnitsPage, /\$\{confirmation\.proposedSerial\}/);
  assert.match(stockUnitsPage, /original CT code, serial, and identity remain reserved/);
  assert.match(stockUnitsPage, /`\/api\/stock-units\/\$\{action\.unitId\}\/serial`/);
  assert.match(stockUnitsPage, /serial_number: action\.proposedSerial/);
});

test('cancellation and failure preserve form values and selected inventory', () => {
  const cancelHandler = stockUnitsPage.slice(
    stockUnitsPage.indexOf('function cancelConfirmation'),
    stockUnitsPage.indexOf('async function confirmStockUnitAction')
  );
  const catchBlock = stockUnitsPage.match(
    /catch \(error\) \{\s*const fallback = action\.type === 'correct-serial'([\s\S]*?)\} finally/
  )?.[1];

  assert.match(cancelHandler, /setConfirmation\(null\)/);
  assert.doesNotMatch(cancelHandler, /setSelected|setReason|setCorrectedSerial|api\./);
  assert.ok(catchBlock, 'action failure handler must remain present');
  assert.match(catchBlock, /toast\(/);
  assert.doesNotMatch(catchBlock, /setSelected|setReason|setCorrectedSerial/);
});

test('duplicate actions are blocked and dismissal is locked during requests', () => {
  assert.match(stockUnitsPage, /confirmationBusyRef\.current \|\| !admin/);
  assert.match(stockUnitsPage, /confirmationBusyRef\.current = true/);
  assert.match(stockUnitsPage, /busy=\{busy\}/);
  assert.match(stockUnitsPage, /confirmationBusyRef\.current = false/);
});

test('stale CT, state, and serial targets fail closed before mutation', () => {
  assert.match(stockUnitsPage, /String\(selected\.id\) === String\(action\.unitId\)/);
  assert.match(stockUnitsPage, /selected\.unit_code === action\.unitCode/);
  assert.match(stockUnitsPage, /selected\.state === action\.expectedState/);
  assert.match(stockUnitsPage, /selected\.manufacturer_serial_number === action\.expectedSerial/);
  assert.match(stockUnitsPage, /correctedSerial\.trim\(\) === action\.proposedSerial/);
  assert.match(stockUnitsPage, /selected stock unit changed/);
});

test('successful actions refresh inventory and preserve existing toast feedback', () => {
  assert.match(stockUnitsPage, /Original unit retired; replacement created with a new SU- identity/);
  assert.match(stockUnitsPage, /Stock unit \$\{action\.type === 'retire' \? 'retired' : 'released'\}/);
  assert.match(stockUnitsPage, /setSelected\(null\);\s*setReason\(''\);\s*await loadUnits\(\)/);
});
