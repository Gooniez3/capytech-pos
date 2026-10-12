const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED_SHOP_WARRANTY_MONTHS,
  resolveEffectiveStockPolicy,
} = require('./stock-unit-policy');

const product = Object.freeze({
  id: 10,
  serial_tracking_enabled: true,
  shop_warranty_enabled: true,
  shop_warranty_months: 6,
});

test('product policy is effective when there is no variant', () => {
  assert.deepEqual(resolveEffectiveStockPolicy(product), {
    serialTrackingEnabled: true,
    shopWarrantyEligible: true,
    shopWarrantyMonths: 6,
    serialTrackingSource: 'product',
    shopWarrantySource: 'product',
  });
  assert.deepEqual(ALLOWED_SHOP_WARRANTY_MONTHS, [1, 3, 6, 12]);
});

test('nullable variant fields inherit product serial and shop-warranty policy', () => {
  assert.deepEqual(resolveEffectiveStockPolicy(product, {
    product_id: 10,
    serial_tracking_enabled: null,
    shop_warranty_enabled: null,
    shop_warranty_months: null,
  }), {
    serialTrackingEnabled: true,
    shopWarrantyEligible: true,
    shopWarrantyMonths: 6,
    serialTrackingSource: 'product',
    shopWarrantySource: 'product',
  });
});

test('explicit variant overrides can disable tracking and warranty', () => {
  assert.deepEqual(resolveEffectiveStockPolicy(product, {
    product_id: 10,
    serial_tracking_enabled: false,
    shop_warranty_enabled: false,
    shop_warranty_months: null,
  }), {
    serialTrackingEnabled: false,
    shopWarrantyEligible: false,
    shopWarrantyMonths: null,
    serialTrackingSource: 'variant',
    shopWarrantySource: 'variant',
  });
});

test('variant may override shop warranty with an allowed duration', () => {
  const policy = resolveEffectiveStockPolicy(product, {
    product_id: 10,
    serial_tracking_enabled: null,
    shop_warranty_enabled: true,
    shop_warranty_months: 12,
  });
  assert.equal(policy.shopWarrantyEligible, true);
  assert.equal(policy.shopWarrantyMonths, 12);
  assert.equal(policy.shopWarrantySource, 'variant');
  assert.equal(Object.hasOwn(policy, 'manufacturerWarranty'), false);
  assert.equal(Object.hasOwn(policy, 'priceSuggestion'), false);
});

test('invalid and conflicting policies fail closed', () => {
  assert.throws(() => resolveEffectiveStockPolicy({
    ...product,
    shop_warranty_months: 2,
  }), /1, 3, 6, or 12/);
  assert.throws(() => resolveEffectiveStockPolicy(product, {
    product_id: 10,
    serial_tracking_enabled: null,
    shop_warranty_enabled: null,
    shop_warranty_months: 3,
  }), /must be null/);
  assert.throws(() => resolveEffectiveStockPolicy(product, {
    product_id: 11,
    serial_tracking_enabled: null,
    shop_warranty_enabled: null,
    shop_warranty_months: null,
  }), /does not belong/);
});
