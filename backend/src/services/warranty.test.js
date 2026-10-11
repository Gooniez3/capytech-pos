const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeWarrantySelection,
  suggestWarrantyMonths,
} = require('./warranty');

for (const [minorUnits, expected] of [
  [0, 0],
  [999_999, 0],
  [1_000_000, 1],
  [5_000_000, 1],
  [5_000_001, 3],
  [10_000_000, 3],
  [10_000_001, 6],
  [20_000_000, 6],
  [20_000_001, 12],
  [40_000_000, 12],
  [40_000_001, 0],
]) {
  test(`warranty suggestion for ${minorUnits} minor units is ${expected}`, () => {
    assert.equal(suggestWarrantyMonths(minorUnits), expected);
  });
}

test('explicit warranty accepts only supported choices', () => {
  for (const value of [0, 1, 3, 6, 12, '0', '12']) {
    assert.equal(normalizeWarrantySelection(value), Number(value));
  }

  for (const value of [undefined, null, -1, 2, 24, 'none', 1.5]) {
    assert.throws(() => normalizeWarrantySelection(value), /Warranty must/);
  }
});

test('omitted checkout warranty is the automatic-selection sentinel', () => {
  assert.equal(
    normalizeWarrantySelection(undefined, { allowAutomatic: true }),
    null
  );
});
