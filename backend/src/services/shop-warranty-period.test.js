const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildShopWarrantySnapshot,
  evaluateStoredWarrantySnapshot,
  lookupStoredWarrantyBySerial,
  warrantyCoverageDates,
} = require('./shop-warranty-period');

for (const [purchaseDate, months, endDate] of [
  ['2026-01-15', 1, '2026-02-14'],
  ['2024-01-31', 1, '2024-02-29'],
  ['2023-01-31', 1, '2023-02-28'],
  ['2024-02-29', 12, '2025-02-28'],
  ['2025-08-31', 6, '2026-02-28'],
  ['2026-10-12', 3, '2027-01-11'],
]) {
  test(`warranty from ${purchaseDate} for ${months} months ends ${endDate}`, () => {
    assert.deepEqual(warrantyCoverageDates(purchaseDate, months), {
      startDate: purchaseDate,
      endDate,
      months,
    });
  });
}

test('warranty snapshots use policy and purchase date without price inference', () => {
  assert.deepEqual(buildShopWarrantySnapshot({
    shopWarrantyEligible: true,
    shopWarrantyMonths: 3,
  }, '2026-10-12'), {
    shopWarrantyEligible: true,
    shopWarrantyMonths: 3,
    shopWarrantyStartDate: '2026-10-12',
    shopWarrantyEndDate: '2027-01-11',
  });
  assert.deepEqual(buildShopWarrantySnapshot({
    shopWarrantyEligible: false,
    shopWarrantyMonths: null,
  }, '2026-10-12'), {
    shopWarrantyEligible: false,
    shopWarrantyMonths: null,
    shopWarrantyStartDate: null,
    shopWarrantyEndDate: null,
  });
});

test('stored snapshot evaluation never consults current product policy', () => {
  const stored = {
    shop_warranty_eligible: true,
    shop_warranty_months: 1,
    shop_warranty_start_date: '2026-01-31',
    shop_warranty_end_date: '2026-02-28',
  };
  assert.deepEqual(evaluateStoredWarrantySnapshot(stored, '2026-02-28'), {
    status: 'active', active: true, months: 1,
    startDate: '2026-01-31', endDate: '2026-02-28',
  });
  assert.equal(evaluateStoredWarrantySnapshot(stored, '2026-03-01').status, 'expired');
  assert.deepEqual(evaluateStoredWarrantySnapshot({
    shop_warranty_eligible: null,
  }, '2026-03-01'), { status: 'not_recorded', active: null });
});

test('warranty lookup normalizes serial and returns stored sale-item snapshots', async () => {
  const calls = [];
  const queryable = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        shop_warranty_eligible: true,
        shop_warranty_months: 12,
        shop_warranty_start_date: '2024-02-29',
        shop_warranty_end_date: '2025-02-28',
      }] };
    },
  };
  const rows = await lookupStoredWarrantyBySerial(queryable, ' sn-00 1 ', {
    asOfDate: '2025-02-28',
  });
  assert.deepEqual(calls[0].params, ['SN001']);
  assert.match(calls[0].sql, /si\.shop_warranty_months/);
  assert.match(calls[0].sql, /shop_warranty_end_date::text/);
  assert.doesNotMatch(calls[0].sql, /products|shop_warranty_enabled/);
  assert.equal(rows[0].warranty.status, 'active');
});
