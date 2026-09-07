import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cartProductFromLookup,
  cartProductFromVariant,
  catalogItemKey,
  filterProducts,
  needsVariantSelection,
  productFromSearchRow,
} from './posCatalog.js';

test('filterProducts matches name, sku, and category', () => {
  const products = [
    { id: 1, name: 'USB-C Hub', sku: 'HUB-01', category_name: 'Adapters' },
    { id: 2, name: 'Gaming Mouse', sku: 'MOUSE-9', category_name: 'Peripherals' },
  ];
  assert.equal(filterProducts(products, '').length, 2);
  assert.equal(filterProducts(products, 'hub')[0].id, 1);
  assert.equal(filterProducts(products, 'mouse-9')[0].id, 2);
  assert.equal(filterProducts(products, 'adapters')[0].id, 1);
  assert.equal(filterProducts(products, 'ssd').length, 0);
});

test('variant cart identity stays separate from the parent product', () => {
  const parent = { id: 5, name: 'Mouse', price: 20 };
  const variant = { id: 10, name: 'Black', effective_price: 22, stock_quantity: 4, sku: 'MOUSE-BLK' };
  const cartProduct = cartProductFromVariant(parent, variant);
  assert.equal(cartProduct.product_id, 5);
  assert.equal(cartProduct.variant_id, 10);
  assert.equal(cartProduct.name, 'Mouse — Black');
  assert.equal(cartProduct.price, 22);
  assert.notEqual(catalogItemKey(parent), catalogItemKey(cartProduct));
});

test('lookup and search rows preserve variant_id when present', () => {
  const lookup = cartProductFromLookup({
    id: 5,
    product_id: 5,
    variant_id: 10,
    name: 'Mouse',
    variant_name: 'Black',
    price: 22,
    stock_quantity: 4,
    variant_sku: 'MOUSE-BLK',
  });
  assert.equal(lookup.variant_id, 10);
  assert.equal(lookup.name, 'Mouse — Black');

  const search = productFromSearchRow({
    type: 'variant',
    product_id: 5,
    variant_id: 11,
    product_name: 'Mouse',
    variant_name: 'White',
    price: 21,
    stock_quantity: 2,
    sku: 'MOUSE-WHT',
  });
  assert.equal(search.variant_id, 11);
  assert.equal(needsVariantSelection(search), false);
});

test('parents with variants require a selection before cart add', () => {
  const parent = { id: 5, name: 'Mouse', has_variants: true };
  assert.equal(needsVariantSelection(parent), true);
  assert.equal(needsVariantSelection({ id: 5, variant_id: 10, has_variants: true }), false);
  assert.equal(needsVariantSelection({ id: 6, name: 'HDMI cable' }, [{ id: 6, has_variants: false }]), false);
  assert.equal(needsVariantSelection({ id: 5, name: 'Mouse' }, [{ id: 5, has_variants: true }]), true);
});
