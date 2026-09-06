const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const {
  CheckoutIdempotencyConflictError,
  canonicalizeCheckoutIntent,
  createCheckoutFingerprint,
  findExistingCheckout,
  normalizeRequiredIdempotencyKey,
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

for (const [name, value] of [
  ['missing', undefined],
  ['null', null],
  ['empty', ''],
  ['whitespace', '   '],
]) {
  test(`${name} checkout idempotency key is rejected with HTTP status 400`, () => {
    assert.throws(
      () => normalizeRequiredIdempotencyKey(value),
      error => error.statusCode === 400 && /required/.test(error.message)
    );
  });
}

test('malformed checkout idempotency key is rejected with HTTP status 400', () => {
  assert.throws(
    () => normalizeRequiredIdempotencyKey('not-a-uuid'),
    error => error.statusCode === 400 && /Invalid/.test(error.message)
  );
});

test('valid checkout UUID is accepted and trimmed', () => {
  assert.equal(
    normalizeRequiredIdempotencyKey('  123e4567-e89b-42d3-a456-426614174000  '),
    '123e4567-e89b-42d3-a456-426614174000'
  );
});

test('checkout route retains advisory locking and atomic fingerprint storage', async () => {
  const source = await readFile(join(__dirname, '..', 'routes', 'sales.js'), 'utf8');
  assert.match(source, /SELECT pg_advisory_xact_lock\(/);
  assert.match(source, /hashtextextended\(\$1, 0\)/);
  assert.match(source, /validateCheckoutRequest\(req\.body\)/);
  assert.match(source, /idempotency_key,\s*checkout_request_fingerprint/);
  assert.match(source, /idempotencyKey,\s*checkoutFingerprint/);
  assert.ok(source.indexOf('pg_advisory_xact_lock') < source.indexOf('const duplicateCheckout'));
});

function checkoutHandler() {
  const router = require('../routes/sales');
  return router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post)
    .route.stack.at(-1).handle;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function withMockPool(mock, callback) {
  const pool = require('../db/pool');
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = mock.query;
  pool.connect = mock.connect;
  try {
    return await callback();
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
}

const validCheckoutBody = key => ({
  items: [{ product_id: 12, quantity: 1 }],
  payment_method: 'cash',
  idempotency_key: key,
});

for (const [name, key] of [
  ['missing', undefined],
  ['null', null],
  ['empty', ''],
  ['whitespace', '   '],
  ['malformed', 'not-a-uuid'],
]) {
  test(`${name} key returns HTTP 400 before any database or stock operation`, async () => {
    let databaseCalls = 0;
    const failIfCalled = async () => {
      databaseCalls += 1;
      throw new Error('Database must not be called');
    };

    await withMockPool({ query: failIfCalled, connect: failIfCalled }, async () => {
      const response = responseRecorder();
      await checkoutHandler()(
        { body: validCheckoutBody(key), user: { id: 7 } },
        response
      );
      assert.equal(response.statusCode, 400);
      assert.equal(databaseCalls, 0);
    });
  });
}

test('valid UUID creates a keyed sale and deducts stock once', async () => {
  const key = '123e4567-e89b-42d3-a456-426614174000';
  const queries = [];
  let released = false;
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (sql.includes('FROM sales') && sql.includes('idempotency_key')) return { rows: [] };
      if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
        return { rows: [{
          id: 12,
          name: 'Mouse',
          sku: 'MOUSE',
          price: '100',
          cost: '50',
          stock_quantity: 10,
          low_stock_threshold: 2,
        }] };
      }
      if (sql.includes('COUNT(*)::integer AS count') && sql.includes('product_variants')) {
        return { rows: [{ count: 0 }] };
      }
      if (sql.includes('UPDATE products')) {
        return { rowCount: 1, rows: [{ stock_quantity: 9, low_stock_threshold: 2 }] };
      }
      if (sql.includes("nextval(")) return { rows: [{ invoice_number: '1' }] };
      if (sql.includes('INSERT INTO sales')) {
        assert.equal(values.at(-2), key);
        assert.ok(Buffer.isBuffer(values.at(-1)));
        assert.equal(values.at(-1).length, 32);
        return { rows: [{ id: 51, invoice_number: 'INV-000001', idempotency_key: key }] };
      }
      if (sql.includes('INSERT INTO sale_items')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {
      released = true;
    },
  };

  await withMockPool({
    query: async sql => {
      assert.match(sql, /FROM sales/);
      return { rows: [] };
    },
    connect: async () => client,
  }, async () => {
    const response = responseRecorder();
    await checkoutHandler()(
      { body: validCheckoutBody(key), user: { id: 7 } },
      response
    );
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.sale.idempotency_key, key);
  });

  assert.equal(queries.filter(entry => entry.sql.includes('UPDATE products')).length, 1);
  assert.equal(queries.filter(entry => entry.sql.includes('INSERT INTO sales')).length, 1);
  assert.equal(released, true);
});

test('duplicate checkout targets create one decrement and one sale item', async () => {
  const key = '223e4567-e89b-42d3-a456-426614174000';
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (sql.includes('FROM sales') && sql.includes('idempotency_key')) return { rows: [] };
      if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
        return { rows: [{
          id: 12, name: 'Mouse', sku: 'MOUSE', price: '10.25', cost: '5.00',
          stock_quantity: 10, low_stock_threshold: 2,
        }] };
      }
      if (sql.includes('COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
      if (sql.includes('UPDATE products')) return { rowCount: 1, rows: [{ stock_quantity: 7 }] };
      if (sql.includes('nextval(')) return { rows: [{ invoice_number: '2' }] };
      if (sql.includes('INSERT INTO sales')) return { rows: [{ id: 52, invoice_number: 'INV-000002' }] };
      if (sql.includes('INSERT INTO sale_items')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };

  await withMockPool({
    query: async () => ({ rows: [] }),
    connect: async () => client,
  }, async () => {
    const response = responseRecorder();
    await checkoutHandler()({
      user: { id: 7 },
      body: {
        idempotency_key: key,
        payment_method: 'cash',
        items: [
          { product_id: 12, quantity: 1, price: 1 },
          { product_id: '12', quantity: '2', total: 1 },
        ],
        subtotal: 1,
        total: 1,
      },
    }, response);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.items[0].quantity, 3);
    assert.equal(response.body.items[0].unit_price, '10.25');
    assert.equal(response.body.items[0].line_total, '30.75');
  });

  const stockUpdates = queries.filter(entry => entry.sql.includes('UPDATE products'));
  const itemInserts = queries.filter(entry => entry.sql.includes('INSERT INTO sale_items'));
  assert.equal(stockUpdates.length, 1);
  assert.deepEqual(stockUpdates[0].values, [3, 12]);
  assert.equal(itemInserts.length, 1);
  assert.equal(itemInserts[0].values[6], 3);
});

test('all inventory targets validate before the first stock update', async () => {
  const key = '323e4567-e89b-42d3-a456-426614174000';
  const queries = [];
  let productLookup = 0;
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (sql.includes('FROM sales') && sql.includes('idempotency_key')) return { rows: [] };
      if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
        productLookup += 1;
        return productLookup === 1
          ? { rows: [{ id: 12, name: 'Mouse', sku: 'MOUSE', price: '10.00', cost: '5.00', stock_quantity: 10 }] }
          : { rows: [] };
      }
      if (sql.includes('COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };

  await withMockPool({ query: async () => ({ rows: [] }), connect: async () => client }, async () => {
    const response = responseRecorder();
    await checkoutHandler()({
      user: { id: 7 },
      body: {
        idempotency_key: key,
        payment_method: 'cash',
        items: [{ product_id: 12, quantity: 1 }, { product_id: 13, quantity: 1 }],
      },
    }, response);
    assert.equal(response.statusCode, 400);
  });

  assert.equal(queries.some(sql => sql.includes('UPDATE products')), false);
  assert.equal(queries.some(sql => sql.includes('INSERT INTO sales')), false);
});

test('variant-parent mismatch and insufficient stock fail without mutation', async () => {
  for (const variantRows of [[], [{
    variant_id: 9, product_id: 12, product_name: 'Mouse', variant_name: 'Black',
    variant_sku: 'MOUSE-BLACK', price: '10.00', cost: '5.00', stock_quantity: 1,
  }]]) {
    const queries = [];
    const client = {
      async query(sql) {
        queries.push(sql);
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
        if (sql.includes('FROM sales') && sql.includes('idempotency_key')) return { rows: [] };
        if (sql.includes('FROM product_variants pv')) return { rows: variantRows };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      release() {},
    };
    await withMockPool({ query: async () => ({ rows: [] }), connect: async () => client }, async () => {
      const response = responseRecorder();
      await checkoutHandler()({
        user: { id: 7 },
        body: {
          idempotency_key: '423e4567-e89b-42d3-a456-426614174000',
          payment_method: 'cash',
          items: [{ product_id: 12, variant_id: 9, quantity: 2 }],
        },
      }, response);
      assert.equal(response.statusCode, 400);
    });
    assert.equal(queries.some(sql => sql.includes('UPDATE product_variants')), false);
  }
});

test('invalid payment is rejected before lookup and does not consume a sale', async () => {
  let databaseCalls = 0;
  const failIfCalled = async () => {
    databaseCalls += 1;
    throw new Error('Database must not be called');
  };

  await withMockPool({ query: failIfCalled, connect: failIfCalled }, async () => {
    const response = responseRecorder();
    await checkoutHandler()({
      user: { id: 7 },
      body: {
        idempotency_key: '523e4567-e89b-42d3-a456-426614174000',
        payment_method: 'card',
        items: [{ product_id: 12, quantity: 1 }],
      },
    }, response);
    assert.equal(response.statusCode, 400);
  });
  assert.equal(databaseCalls, 0);
});

test('discount above authoritative subtotal fails before stock mutation', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (sql.includes('FROM sales') && sql.includes('idempotency_key')) return { rows: [] };
      if (sql.includes('FROM products') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 12, name: 'Mouse', sku: 'MOUSE', price: '10.00', cost: '5.00', stock_quantity: 10 }] };
      }
      if (sql.includes('COUNT(*)::integer AS count')) return { rows: [{ count: 0 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };

  await withMockPool({ query: async () => ({ rows: [] }), connect: async () => client }, async () => {
    const response = responseRecorder();
    await checkoutHandler()({
      user: { id: 7 },
      body: {
        idempotency_key: '623e4567-e89b-42d3-a456-426614174000',
        payment_method: 'cash',
        discount: '10.01',
        items: [{ product_id: 12, quantity: 1 }],
      },
    }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /exceed subtotal/);
  });
  assert.equal(queries.some(sql => sql.includes('UPDATE products')), false);
});

test('pool connection failure returns a generic 500 without internal details', async () => {
  await withMockPool({
    query: async () => ({ rows: [] }),
    connect: async () => { throw new Error('secret database hostname'); },
  }, async () => {
    const response = responseRecorder();
    await checkoutHandler()({ body: validCheckoutBody('723e4567-e89b-42d3-a456-426614174000'), user: { id: 7 } }, response);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { error: 'Checkout failed' });
  });
});
