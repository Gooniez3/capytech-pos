import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const productsPage = await readFile(
  new URL('../src/pages/ProductsPage.tsx', import.meta.url),
  'utf8'
);

test('all three product confirmations use the shared dialog without native confirmation', () => {
  assert.doesNotMatch(productsPage, /window\.confirm/);
  assert.match(productsPage, /type: 'trash-image'/);
  assert.match(productsPage, /type: 'remove-variant'/);
  assert.match(productsPage, /type: 'delete-product'/);
  assert.match(productsPage, /<ConfirmDialog/);
  assert.match(productsPage, /variant: 'danger' as const/);
  assert.match(productsPage, /variant: 'warning' as const/);
});

test('opening and cancelling a confirmation cannot mutate product data', () => {
  assert.match(
    productsPage,
    /function cancelProductConfirmation\(\) \{\s*if \(confirmationBusyRef\.current\) return;\s*setProductConfirmation\(null\);/
  );
  assert.match(productsPage, /onCancel=\{cancelProductConfirmation\}/);
  assert.match(productsPage, /onConfirm=\{confirmProductAction\}/);
});

test('image trash preserves its endpoint, recovery semantics, and success feedback', () => {
  assert.match(productsPage, /`\/api\/products\/\$\{action\.productId\}\/image\/trash`/);
  assert.match(productsPage, /applyImageStatus\(status, action\.productId\)/);
  assert.match(productsPage, /status\.message \|\| 'Image moved to trash\.'/);
  assert.match(productsPage, /recoverable trash/);
});

test('variant confirmation preserves the parent edit draft and defers removal until save', () => {
  assert.match(productsPage, /current\.includes\(action\.variantId\)/);
  assert.match(productsPage, /\[\.\.\.current, action\.variantId\]/);
  assert.match(productsPage, /Your other unsaved product edits will remain unchanged/);
  assert.match(productsPage, /removed_variant_ids: editingProduct \? removedVariantIds\.map\(Number\) : \[\]/);
});

test('product deletion preserves the existing API, refresh, history, and feedback', () => {
  assert.match(productsPage, /`\/api\/products\/\$\{action\.product\.id\}`/);
  assert.match(productsPage, /'Product moved to Recently deleted\.'/);
  assert.match(productsPage, /await loadData\(\)/);
  assert.match(productsPage, /historical sales will remain unchanged/);
});

test('failure remains retryable and repeated confirmations are guarded while busy', () => {
  assert.match(productsPage, /if \(!productConfirmation \|\| confirmationBusyRef\.current\) return/);
  assert.match(productsPage, /confirmationBusyRef\.current = true/);
  assert.match(productsPage, /busy=\{confirmationBusy\}/);
  assert.match(productsPage, /error instanceof Error \? error\.message : fallback/);
  assert.match(
    productsPage,
    /finally \{[\s\S]*?confirmationBusyRef\.current = false;[\s\S]*?setConfirmationBusy\(false\);/
  );
});

test('the shared confirmation is nested without closing the product editor', () => {
  const removeVariant = productsPage.slice(
    productsPage.indexOf('function removeVariant'),
    productsPage.indexOf('function openAddProduct')
  );

  assert.match(productsPage, /open=\{addOpen\}[\s\S]*open=\{!!productConfirmation\}/);
  assert.doesNotMatch(removeVariant, /setAddOpen\(false\)/);
  assert.doesNotMatch(removeVariant, /setForm\(/);
});
