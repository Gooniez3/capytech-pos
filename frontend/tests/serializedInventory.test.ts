import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCheckoutSelections,
  checkoutAttemptSignature,
  normalizedSerialKey,
  serialLines,
  validateSerialBatch,
  warrantySnapshotLabel,
} from '../src/lib/serializedInventory.ts';

test('manual and scanner serial normalization are equivalent', () => {
  assert.equal(normalizedSerialKey(' sn-00 1 '), normalizedSerialKey('SN001'));
  assert.deepEqual(serialLines(' A-1\n\n B 2 \n'), ['A-1', 'B 2']);
});

test('guided adoption requires the exact unique physical quantity', () => {
  assert.deepEqual(validateSerialBatch('SN-1\nSN-2', 2), ['SN-1', 'SN-2']);
  assert.throws(() => validateSerialBatch('SN-1', 2), /exactly 2/);
  assert.throws(() => validateSerialBatch('SN-1\nsn 1', 2), /unique/);
});

test('serialized and mixed-cart checkout selections fail closed', () => {
  const unit = (id: string) => ({ id, internal_sku: `SU-${id}`, manufacturer_serial_number: `SN-${id}` }) as never;
  assert.doesNotThrow(() => assertCheckoutSelections([
    { cartKey: 'tracked', quantity: 2, tracked: true },
    { cartKey: 'ordinary', quantity: 1, tracked: false },
  ], { tracked: [unit('2'), unit('1')] }));
  assert.throws(() => assertCheckoutSelections([
    { cartKey: 'tracked', quantity: 2, tracked: true },
  ], { tracked: [unit('1')] }), /exactly 2/);
  assert.throws(() => assertCheckoutSelections([
    { cartKey: 'a', quantity: 1, tracked: true },
    { cartKey: 'b', quantity: 1, tracked: true },
  ], { a: [unit('1')], b: [unit('1')] }), /cannot be selected twice/);
});

test('attempt signatures change with cart or unit selections and remain stable for retries', () => {
  const attempt = {
    checkoutContractVersion: 2,
    items: [{ product_id: '1', quantity: 1, stock_unit_ids: ['4'] }],
    discount: 0,
    warrantyMonths: 'automatic',
  };
  assert.equal(checkoutAttemptSignature(attempt), checkoutAttemptSignature(attempt));
  assert.notEqual(checkoutAttemptSignature(attempt), checkoutAttemptSignature({
    ...attempt, items: [{ product_id: '1', quantity: 1, stock_unit_ids: ['5'] }],
  }));
  assert.notEqual(checkoutAttemptSignature(attempt), checkoutAttemptSignature({
    ...attempt, checkoutContractVersion: 1,
  }));
  assert.notEqual(checkoutAttemptSignature(attempt), checkoutAttemptSignature({
    ...attempt, warrantyMonths: 12,
  }));
});

test('saved warranty snapshots distinguish legacy and explicit no-warranty items', () => {
  assert.equal(warrantySnapshotLabel({ shopWarrantyEligible: null }), 'Warranty not recorded');
  assert.equal(warrantySnapshotLabel({ shopWarrantyEligible: false }), 'No shop warranty');
  assert.match(warrantySnapshotLabel({
    shopWarrantyEligible: true, shopWarrantyMonths: 12, shopWarrantyEndDate: '2027-01-31',
  }), /12 months.*2027-01-31/);
});
