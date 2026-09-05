const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const {
  CheckoutIdempotencyConflictError,
  canonicalizeCheckoutIntent,
  createCheckoutFingerprint,
  findExistingCheckout,
} = require('./checkout-fingerprint');

const baseRequest = () => ({
  user_id: 7,
  items: [
    { product_id: 12, variant_id: null, quantity: 2 },
    { product_id: 20, variant_id: 31, quantity: 1 },
  ],
  payment_method: 'cash',
  discount: 100,
  customer_id: 4,
  customer_name: ' Ada ',
  customer_phone: ' 091234 ',
  customer_email: ' ada@example.com ',
  customer_address: ' Main Street ',
});

const digest = input => createCheckoutFingerprint(input).toString('hex');

test('the same semantic checkout produces the same SHA-256 digest', () => {
  assert.equal(digest(baseRequest()), digest(baseRequest()));
  assert.equal(createCheckoutFingerprint(baseRequest()).length, 32);
});

for (const [name, mutate] of [
  ['product', request => { request.items[0].product_id = 13; }],
  ['variant', request => { request.items[1].variant_id = 32; }],
  ['quantity', request => { request.items[0].quantity = 3; }],
  ['payment method', request => { request.payment_method = 'banking'; }],
  ['discount', request => { request.discount = 101; }],
  ['customer', request => { request.customer_name = 'Grace'; }],
  ['authenticated user', request => { request.user_id = 8; }],
]) {
  test(`a different ${name} produces a different digest`, () => {
    const changed = baseRequest();
    mutate(changed);
    assert.notEqual(digest(baseRequest()), digest(changed));
  });
}

test('cart display order does not affect the digest', () => {
  const reordered = baseRequest();
  reordered.items.reverse();
  assert.equal(digest(baseRequest()), digest(reordered));
});

test('duplicate inventory targets aggregate deterministically', () => {
  const split = baseRequest();
  split.items = [
    { product_id: 12, quantity: 1 },
    { product_id: 12, variant_id: null, quantity: 2 },
  ];
  const combined = baseRequest();
  combined.items = [{ product_id: 12, variant_id: null, quantity: 3 }];

  assert.equal(digest(split), digest(combined));
  assert.deepEqual(canonicalizeCheckoutIntent(split).items, [
    { product_id: 12, variant_id: null, quantity: 3 },
  ]);
});

test('numeric strings and numbers normalize consistently', () => {
  const strings = baseRequest();
  strings.user_id = '7';
  strings.items[0] = { product_id: '12', variant_id: '', quantity: '2' };
  strings.items[1] = { product_id: '20', variant_id: '31', quantity: '1' };
  strings.customer_id = '4';
  strings.discount = '100.00';
  assert.equal(digest(baseRequest()), digest(strings));
});

test('equivalent optional values normalize consistently', () => {
  const missing = baseRequest();
  delete missing.customer_id;
  delete missing.customer_name;
  delete missing.customer_phone;
  delete missing.customer_email;
  delete missing.customer_address;
  missing.discount = undefined;

  const empty = baseRequest();
  empty.customer_id = ' ';
  empty.customer_name = ' ';
  empty.customer_phone = '';
  empty.customer_email = null;
  empty.customer_address = undefined;
  empty.discount = 0;

  assert.equal(digest(missing), digest(empty));
});

test('frontend prices, totals, unknown fields and UI state do not affect the digest', () => {
  const noisy = baseRequest();
  noisy.items[0].price = 999999;
  noisy.items[0].cost = 1;
  noisy.subtotal = 999999;
  noisy.tax = 99;
  noisy.total = 1;
  noisy.status = 'refunded';
  noisy.ui_state = { selected: true };
  assert.equal(digest(baseRequest()), digest(noisy));
});

function queryClient(results) {
  const queries = [];
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql, values });
      const result = results.shift();
      if (!result) throw new Error('Unexpected query');
      return result;
    },
  };
}

test('same key and fingerprint returns the original sale and items', async () => {
  const fingerprint = createCheckoutFingerprint(baseRequest());
  const sale = { id: 41, checkout_request_fingerprint: fingerprint };
  const items = [{ sale_id: 41, product_id: 12, quantity: 2 }];
  const client = queryClient([{ rows: [sale] }, { rows: items }]);

  assert.deepEqual(
    await findExistingCheckout(client, 'same-key', fingerprint),
    { sale, items }
  );
  assert.equal(client.queries.length, 2);
});

test('same key and different fingerprint returns a controlled conflict without loading items', async () => {
  const fingerprint = createCheckoutFingerprint(baseRequest());
  const client = queryClient([{ rows: [{
    id: 41,
    checkout_request_fingerprint: Buffer.alloc(32, 1),
  }] }]);

  await assert.rejects(
    findExistingCheckout(client, 'conflicting-key', fingerprint),
    error => error instanceof CheckoutIdempotencyConflictError && error.statusCode === 409
  );
  assert.equal(client.queries.length, 1);
});

test('legacy keyed sale with NULL fingerprint returns a controlled conflict', async () => {
  const client = queryClient([{ rows: [{
    id: 41,
    checkout_request_fingerprint: null,
  }] }]);

  await assert.rejects(
    findExistingCheckout(client, 'legacy-key', createCheckoutFingerprint(baseRequest())),
    error => error instanceof CheckoutIdempotencyConflictError &&
      error.statusCode === 409 && /legacy sale/.test(error.message)
  );
});

test('checkout route retains advisory locking, optional keys, and atomic fingerprint storage', async () => {
  const source = await readFile(join(__dirname, '..', 'routes', 'sales.js'), 'utf8');
  assert.match(source, /SELECT pg_advisory_xact_lock\(/);
  assert.match(source, /hashtextextended\(\$1, 0\)/);
  assert.match(source, /let checkoutFingerprint = null/);
  assert.match(source, /idempotency_key,\s*checkout_request_fingerprint/);
  assert.match(source, /idempotencyKey \|\| null,\s*checkoutFingerprint/);
  assert.ok(source.indexOf('pg_advisory_xact_lock') < source.indexOf('const duplicateCheckout'));
});
