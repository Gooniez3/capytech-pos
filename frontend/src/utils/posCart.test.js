import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addProductToCart,
  cartCheckoutItems,
  inventoryTargetKey,
} from './posCart.js';

test('same exact inventory target increments one cart row', () => {
  const product = { id: 5, name: 'Mouse' };
  const cart = addProductToCart(addProductToCart([], product), product);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
});

test('two variants of one parent remain separate targets', () => {
  const first = { id: 5, product_id: 5, variant_id: 10 };
  const second = { id: 5, product_id: 5, variant_id: 11 };
  const cart = addProductToCart(addProductToCart([], first), second);
  assert.equal(cart.length, 2);
  assert.notEqual(inventoryTargetKey(first), inventoryTargetKey(second));
});

test('checkout items send variant_id only when present', () => {
  assert.deepEqual(cartCheckoutItems([
    { product: { id: 5 }, quantity: 2 },
    { product: { id: 5, product_id: 5, variant_id: 10 }, quantity: 1 },
  ]), [
    { product_id: 5, quantity: 2 },
    { product_id: 5, variant_id: 10, quantity: 1 },
  ]);
});

test('POS retains cash checkout and uses normalized cart payload', async () => {
  const source = await readFile(new URL('../pages/POS.jsx', import.meta.url), 'utf8');
  assert.match(source, /items: cartCheckoutItems\(cart\)/);
  assert.match(source, /checkoutRequestBody\(/);
  assert.match(source, /paymentMethod/);
});
