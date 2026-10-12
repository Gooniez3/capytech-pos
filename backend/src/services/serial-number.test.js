const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeManufacturerSerial,
  prepareManufacturerSerial,
  prepareUniqueSerialBatch,
} = require('./serial-number');

test('serial normalization matches the Phase 2B database contract', () => {
  assert.equal(normalizeManufacturerSerial('  sn-00 12 / ab  '), 'SN0012AB');
  assert.equal(normalizeManufacturerSerial('000-001'), '000001');
  assert.equal(normalizeManufacturerSerial('a_b.c'), 'ABC');
});

test('original serial text preserves spaces, dashes, case, and leading zeros', () => {
  const serial = prepareManufacturerSerial('  00-ab 12  ');
  assert.equal(serial.original, '  00-ab 12  ');
  assert.equal(serial.normalized, '00AB12');
});

test('batch validation rejects normalization collisions and empty serials', () => {
  assert.throws(
    () => prepareUniqueSerialBatch(['AB-12', 'a b_12']),
    /Duplicate normalized/
  );
  for (const value of ['', '---', null, 123]) {
    assert.throws(() => normalizeManufacturerSerial(value));
  }
});
