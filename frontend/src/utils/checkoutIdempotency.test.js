import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  clearCheckoutKey,
  getOrCreateCheckoutKey,
} from './checkoutIdempotency.js';

test('checkout key survives an uncertain failure and is reused', () => {
  const checkoutKeyRef = { current: null };
  let generated = 0;
  const createUuid = () => `key-${++generated}`;

  const firstAttempt = getOrCreateCheckoutKey(checkoutKeyRef, createUuid);
  const retryAfterFailure = getOrCreateCheckoutKey(checkoutKeyRef, createUuid);

  assert.equal(firstAttempt, 'key-1');
  assert.equal(retryAfterFailure, firstAttempt);
  assert.equal(generated, 1);
});

test('checkout key clears only after confirmed success', () => {
  const checkoutKeyRef = { current: null };
  let generated = 0;
  const createUuid = () => `key-${++generated}`;

  const completedAttempt = getOrCreateCheckoutKey(checkoutKeyRef, createUuid);
  clearCheckoutKey(checkoutKeyRef);
  const nextCheckout = getOrCreateCheckoutKey(checkoutKeyRef, createUuid);

  assert.equal(completedAttempt, 'key-1');
  assert.equal(nextCheckout, 'key-2');
});

test('POS includes the key and clears it only in the successful request path', async () => {
  const source = await readFile(join(import.meta.dirname, '..', 'pages', 'POS.jsx'), 'utf8');
  const requestStart = source.indexOf("await api.post('/sales'");
  const keyField = source.indexOf('idempotencyKey: checkoutKey', requestStart);
  const clearKey = source.indexOf('clearCheckoutKey(checkoutKeyRef)', keyField);
  const catchBlock = source.indexOf('} catch (err) {', clearKey);

  assert.ok(requestStart >= 0);
  assert.ok(keyField > requestStart);
  assert.ok(clearKey > keyField);
  assert.ok(catchBlock > clearKey);
});
