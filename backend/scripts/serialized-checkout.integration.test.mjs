import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
import { BASELINE_SQL } from '../migrations/1788652800000_baseline.mjs';
import { UP_SQL as P04 } from '../migrations/1788652800001_p04-database-constraints.mjs';
import { UP_SQL as P06 } from '../migrations/1788652800002_p06-checkout-request-fingerprint.mjs';
import { UP_SQL as P08 } from '../migrations/1788652800003_p08-product-recycle-bin.mjs';
import { UP_SQL as P10 } from '../migrations/1791676800000_p10-invoice-warranty.mjs';
import { UP_SQL as P2B } from '../migrations/1791763200000_p2b-stock-unit-warranty-schema.mjs';
import { UP_SQL as P3A } from '../migrations/1791849600000_p3a-inventory-movements.mjs';
import { UP_SQL as P3D } from '../migrations/1791936000000_p3d-inventory-receipts.mjs';
import { UP_SQL as CT } from '../migrations/1792022400000_fix01-stock-unit-barcode-codes.mjs';
import { UP_SQL as CP } from '../migrations/1792108800000_cp-catalog-codes.mjs';

const require = createRequire(import.meta.url);
const { withTransaction } = require('../src/services/domain-transaction');
const { registerReceivedUnits, retireStockUnits } = require('../src/services/stock-unit-service');
const { warrantyCoverageDates } = require('../src/services/shop-warranty-period');
const { Client, Pool } = pg;
const connectionString = process.env.CAPYTECH_PHASE2E_TEST_DATABASE_URL;

async function one(queryable, sql, values = []) {
  const result = await queryable.query(sql, values);
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function invoke(router, path, method, req) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route missing`);
  const response = {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await layer.route.stack.at(-1).handle(req, response);
  return response;
}

test('Phase 2E serialized checkout, refund, void, rollback, and read models are atomic',
  { skip: !connectionString }, async () => {
    const databaseName = new URL(connectionString).pathname.slice(1);
    assert.match(databaseName, /^capytech_phase2e_test_[a-z0-9_]+$/);
    const bootstrap = new Client({ connectionString, options: '-c statement_timeout=60000' });
    await bootstrap.connect();
    try {
      const identity = await one(bootstrap, `
        SELECT current_database() AS database,
               current_setting('server_version_num')::integer AS version
      `);
      assert.equal(identity.database, databaseName);
      assert.ok(identity.version >= 170000 && identity.version < 190000);
      assert.equal((await one(bootstrap, `
        SELECT COUNT(*)::integer AS count FROM pg_tables WHERE schemaname = 'public'
      `)).count, 0);
      await bootstrap.query('BEGIN');
      await bootstrap.query(BASELINE_SQL);
      await bootstrap.query(P04);
      await bootstrap.query(P06);
      await bootstrap.query(P08);
      await bootstrap.query(P10);
      await bootstrap.query(P2B);
      await bootstrap.query(P3A);
      await bootstrap.query(P3D);
      await bootstrap.query(CT);
      await bootstrap.query(CP);
      await bootstrap.query('COMMIT');
    } finally { await bootstrap.end(); }

    const pool = new Pool({
      connectionString, max: 12,
      options: '-c statement_timeout=60000 -c lock_timeout=10000',
    });
    const url = new URL(connectionString);
    process.env.DB_HOST = url.hostname;
    process.env.DB_PORT = url.port;
    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASSWORD = decodeURIComponent(url.password);
    process.env.DB_NAME = databaseName;
    const salesRouter = require('../src/routes/sales');
    const routePool = require('../src/db/pool');
    try {
      await pool.query(`
        INSERT INTO store_settings (id, store_name, currency, tax_rate)
        VALUES (1, 'Phase 2E Test Store', 'MMK', 0)
      `);
      const admin = await one(pool, `
        INSERT INTO users (name, username, password_hash, role)
        VALUES ('Admin', 'p2e-admin', 'not-a-real-hash', 'admin') RETURNING id
      `);
      const cashier = await one(pool, `
        INSERT INTO users (name, username, password_hash, role)
        VALUES ('Cashier', 'p2e-cashier', 'not-a-real-hash', 'cashier') RETURNING id
      `);
      const category = await one(pool, `INSERT INTO categories (name) VALUES ('P2E') RETURNING id`);
      const tracked = await one(pool, `
        INSERT INTO products
          (sku, product_code, name, category_id, price, cost, stock_quantity,
           serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months)
        VALUES (
          'P2E-SERIAL',
          format_catalog_code(nextval('catalog_code_seq'::regclass)),
          'Serialized Laptop', $1, 1000, 600, 0, TRUE, TRUE, 3
        )
        RETURNING id
      `, [category.id]);
      const exhaustedTracked = await one(pool, `
        INSERT INTO products
          (sku, product_code, name, category_id, price, cost, stock_quantity,
           serial_tracking_enabled, shop_warranty_enabled)
        VALUES (
          'P2E-EXHAUSTED',
          format_catalog_code(nextval('catalog_code_seq'::regclass)),
          'Single Serialized Unit', $1, 500, 300, 0, TRUE, FALSE
        )
        RETURNING id
      `, [category.id]);
      const untracked = await one(pool, `
        INSERT INTO products
          (sku, product_code, name, category_id, price, cost, stock_quantity)
        VALUES (
          'P2E-CABLE',
          format_catalog_code(nextval('catalog_code_seq'::regclass)),
          'Cable', $1, 100, 40, 10
        ) RETURNING id
      `, [category.id]);
      const legacyProduct = await one(pool, `
        INSERT INTO products
          (sku, product_code, name, category_id, price, cost, stock_quantity)
        VALUES (
          'P2E-LEGACY',
          format_catalog_code(nextval('catalog_code_seq'::regclass)),
          'Legacy Checkout Test', $1, 200, 80, 5
        )
        RETURNING id
      `, [category.id]);
      const variantParent = await one(pool, `
        INSERT INTO products
          (sku, product_code, name, category_id, price, cost, stock_quantity,
           serial_tracking_enabled)
        VALUES (
          'P2E-PHONE',
          format_catalog_code(nextval('catalog_code_seq'::regclass)),
          'Variant Phone', $1, 800, 500, 0, TRUE
        ) RETURNING id
      `, [category.id]);
      const variantA = await one(pool, `
        INSERT INTO product_variants
          (product_id, name, sku, product_code, price, cost, stock_quantity)
        VALUES (
          $1, 'Black', 'P2E-PHONE-BLK',
          format_catalog_code(nextval('catalog_code_seq'::regclass)),
          800, 500, 0
        ) RETURNING id
      `, [variantParent.id]);
      const variantB = await one(pool, `
        INSERT INTO product_variants
          (product_id, name, sku, product_code, price, cost, stock_quantity)
        VALUES (
          $1, 'White', 'P2E-PHONE-WHT',
          format_catalog_code(nextval('catalog_code_seq'::regclass)),
          800, 500, 0
        ) RETURNING id
      `, [variantParent.id]);
      const units = await withTransaction(pool, (transaction) => registerReceivedUnits(transaction, {
        actorUserId: admin.id,
        batches: [{ productId: tracked.id, serialNumbers: ['P2E-001', 'P2E-002', 'P2E-003', 'P2E-004'] }],
      }));
      const exhaustedUnits = await withTransaction(pool, (transaction) => registerReceivedUnits(transaction, {
        actorUserId: admin.id,
        batches: [{ productId: exhaustedTracked.id, serialNumbers: ['P2E-ONLY-001'] }],
      }));
      const variantUnits = await withTransaction(pool, (transaction) => registerReceivedUnits(transaction, {
        actorUserId: admin.id,
        batches: [
          { productId: variantParent.id, variantId: variantA.id, serialNumbers: ['P2E-VAR-A'] },
          { productId: variantParent.id, variantId: variantB.id, serialNumbers: ['P2E-VAR-B'] },
        ],
      }));

      const checkout = (key, unitId, extraItems = []) => invoke(salesRouter, '/', 'post', {
        user: { id: cashier.id, role: 'cashier' },
        body: {
          checkout_contract_version: 2,
          idempotency_key: key,
          payment_method: 'cash',
          items: [
            { product_id: tracked.id, quantity: 1, stock_unit_ids: [unitId] },
            ...extraItems,
          ],
        },
      });
      const legacyCheckout = await invoke(salesRouter, '/', 'post', {
        user: { id: cashier.id, role: 'cashier' },
        body: {
          idempotency_key: '123e4567-e89b-42d3-a456-426614174099',
          payment_method: 'cash',
          warranty_months: 1,
          items: [
            { product_id: legacyProduct.id, quantity: 1 },
          ],
        },
      });
      
      assert.equal(legacyCheckout.statusCode, 201, JSON.stringify(legacyCheckout.body));
      assert.equal(Number(legacyCheckout.body.sale.warranty_months), 1);
      
      const legacySavedItem = await one(pool, `
        SELECT product_sku_snapshot, variant_sku_snapshot
        FROM sale_items
        WHERE sale_id = $1 AND product_id = $2
      `, [legacyCheckout.body.sale.id, legacyProduct.id]);
      
      assert.equal(legacySavedItem.product_sku_snapshot, 'P2E-LEGACY');
      assert.equal(legacySavedItem.variant_sku_snapshot, null);

      const key1 = '123e4567-e89b-42d3-a456-426614174001';
      const first = await checkout(key1, units[0].id, [
        { product_id: untracked.id, quantity: 2, stock_unit_ids: [] },
      ]);
      assert.equal(first.statusCode, 201, JSON.stringify(first.body));
      assert.equal(first.body.sale.checkout_contract_version, 2);
      const saleId = first.body.sale.id;
      const serializedItem = first.body.items.find((item) => Number(item.product_id) === Number(tracked.id));
      assert.equal(serializedItem.stock_units[0].manufacturer_serial_number_snapshot, 'P2E-001');
      assert.equal(serializedItem.shop_warranty_months, 3);
      const untrackedItem = first.body.items.find((item) => Number(item.product_id) === Number(untracked.id));
      assert.equal(untrackedItem.shop_warranty_eligible, false);
      assert.equal(untrackedItem.shop_warranty_months, null);
      assert.equal(untrackedItem.product_sku_snapshot, 'P2E-CABLE');
      const expectedCoverage = warrantyCoverageDates(first.body.sale.purchase_date, 3);
      assert.equal(serializedItem.shop_warranty_start_date, expectedCoverage.startDate);
      assert.equal(serializedItem.shop_warranty_end_date, expectedCoverage.endDate);
      assert.deepEqual(await one(pool, `
        SELECT p.stock_quantity::integer AS serialized_quantity,
               u.stock_quantity::integer AS untracked_quantity,
               su.state
        FROM products p, products u, stock_units su
        WHERE p.id = $1 AND u.id = $2 AND su.id = $3
      `, [tracked.id, untracked.id, units[0].id]), {
        serialized_quantity: 3, untracked_quantity: 8, state: 'sold',
      });

      const eventCount = (await one(pool, `
        SELECT COUNT(*)::integer AS count FROM stock_unit_events WHERE stock_unit_id = $1
      `, [units[0].id])).count;
      const retry = await checkout(key1, units[0].id, [
        { product_id: untracked.id, quantity: 2, stock_unit_ids: [] },
      ]);
      assert.equal(retry.statusCode, 200);
      assert.equal(retry.body.duplicate, true);
      assert.equal((await one(pool, `
        SELECT COUNT(*)::integer AS count FROM stock_unit_events WHERE stock_unit_id = $1
      `, [units[0].id])).count, eventCount);
      assert.equal((await checkout(key1, units[1].id)).statusCode, 409);
      assert.equal((await checkout(
        '133e4567-e89b-42d3-a456-426614174011', units[0].id
      )).statusCode, 409);

      const exhaustedCheckout = (key) => invoke(salesRouter, '/', 'post', {
        user: { id: cashier.id, role: 'cashier' },
        body: {
          checkout_contract_version: 2,
          idempotency_key: key,
          payment_method: 'cash',
          items: [{
            product_id: exhaustedTracked.id,
            quantity: 1,
            stock_unit_ids: [exhaustedUnits[0].id],
          }],
        },
      });
      assert.equal((await exhaustedCheckout(
        '143e4567-e89b-42d3-a456-426614174021'
      )).statusCode, 201);
      const exhaustedConflict = await exhaustedCheckout(
        '143e4567-e89b-42d3-a456-426614174022'
      );
      assert.equal(exhaustedConflict.statusCode, 409);
      assert.match(exhaustedConflict.body.error, /Not enough stock/);

      const wrongVariant = await invoke(salesRouter, '/', 'post', {
        user: { id: cashier.id, role: 'cashier' }, body: {
          checkout_contract_version: 2,
          idempotency_key: '143e4567-e89b-42d3-a456-426614174012',
          payment_method: 'cash',
          items: [{
            product_id: variantParent.id, variant_id: variantB.id, quantity: 1,
            stock_unit_ids: [variantUnits[0].id],
          }],
        },
      });
      assert.equal(wrongVariant.statusCode, 409);

      const identicalKey = '153e4567-e89b-42d3-a456-426614174014';
      const identicalRequest = () => invoke(salesRouter, '/', 'post', {
        user: { id: cashier.id, role: 'cashier' }, body: {
          checkout_contract_version: 2,
          idempotency_key: identicalKey,
          payment_method: 'cash',
          items: [{
            product_id: variantParent.id, variant_id: variantB.id, quantity: 1,
            stock_unit_ids: [variantUnits[1].id],
          }],
        },
      });
      const identicalConcurrent = await Promise.all([
        identicalRequest(), identicalRequest(),
      ]);
      assert.deepEqual(
        identicalConcurrent.map((response) => response.statusCode).sort(),
        [200, 201]
      );
      assert.equal(identicalConcurrent.find((response) => response.statusCode === 200).body.duplicate, true);
      assert.equal(
        String(identicalConcurrent[0].body.sale.id),
        String(identicalConcurrent[1].body.sale.id)
      );
      assert.deepEqual(await one(pool, `
        SELECT
          (SELECT COUNT(*)::integer FROM sales WHERE idempotency_key = $1) AS sales,
          (SELECT COUNT(*)::integer FROM sale_item_stock_units sis
             JOIN sale_items si ON si.id = sis.sale_item_id
             JOIN sales s ON s.id = si.sale_id WHERE s.idempotency_key = $1) AS assignments,
          (SELECT COUNT(*)::integer FROM stock_unit_events
             WHERE stock_unit_id = $2 AND event_type = 'sold') AS sold_events
      `, [identicalKey, variantUnits[1].id]), {
        sales: 1, assignments: 1, sold_events: 1,
      });

      const badQuantity = await invoke(salesRouter, '/', 'post', {
        user: { id: cashier.id }, body: {
          checkout_contract_version: 2,
          idempotency_key: '223e4567-e89b-42d3-a456-426614174002',
          payment_method: 'cash',
          items: [{ product_id: tracked.id, quantity: 2, stock_unit_ids: [units[1].id] }],
        },
      });
      assert.equal(badQuantity.statusCode, 400);

      const concurrent = await Promise.all([
        checkout('323e4567-e89b-42d3-a456-426614174003', units[1].id),
        checkout('423e4567-e89b-42d3-a456-426614174004', units[1].id),
      ]);
      assert.equal(concurrent.filter((response) => response.statusCode === 201).length, 1);
      assert.equal(concurrent.filter((response) => response.statusCode === 409).length, 1);

      await withTransaction(pool, (transaction) => retireStockUnits(transaction, {
        unitIds: [units[3].id], actorUserId: admin.id, reason: 'Phase 2E retired-state test',
      }));
      assert.equal((await checkout(
        '433e4567-e89b-42d3-a456-426614174013', units[3].id
      )).statusCode, 409);

      await pool.query(`
        CREATE FUNCTION p2e_fail_sold_event() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.event_type = 'sold' THEN RAISE EXCEPTION 'injected p2e failure'; END IF;
        RETURN NEW; END $$;
        CREATE TRIGGER p2e_fail_sold_event_trg BEFORE INSERT ON stock_unit_events
        FOR EACH ROW EXECUTE FUNCTION p2e_fail_sold_event();
      `);
      const beforeRollback = await one(pool, `
        SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1
      `, [tracked.id]);
      const sequenceBeforeRollback = await one(pool, `
        SELECT last_value::text AS last_value FROM invoice_number_seq
      `);
      const failed = await checkout('523e4567-e89b-42d3-a456-426614174005', units[2].id);
      assert.equal(failed.statusCode, 500);
      assert.equal((await one(pool, `SELECT state FROM stock_units WHERE id = $1`, [units[2].id])).state, 'available');
      assert.deepEqual(await one(pool, `
        SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1
      `, [tracked.id]), beforeRollback);
      assert.equal((await one(pool, `
        SELECT COUNT(*)::integer AS count FROM sales WHERE idempotency_key = $1
      `, ['523e4567-e89b-42d3-a456-426614174005'])).count, 0);
      const sequenceAfterRollback = await one(pool, `
        SELECT last_value::text AS last_value FROM invoice_number_seq
      `);
      assert.ok(BigInt(sequenceAfterRollback.last_value) > BigInt(sequenceBeforeRollback.last_value));
      assert.equal((await one(pool, `
        SELECT COUNT(*)::integer AS count
        FROM sales
        WHERE invoice_number IN (
          SELECT invoice_number FROM sales GROUP BY invoice_number HAVING COUNT(*) > 1
        )
      `)).count, 0);
      await pool.query('DROP TRIGGER p2e_fail_sold_event_trg ON stock_unit_events; DROP FUNCTION p2e_fail_sold_event()');

      await pool.query(`
        UPDATE products SET shop_warranty_months = 12 WHERE id = $1
      `, [tracked.id]);

      const invoice = await invoke(salesRouter, '/:id/invoice', 'get', {
        user: { id: cashier.id }, params: { id: String(saleId) },
      });
      assert.equal(invoice.statusCode, 200);
      assert.equal(invoice.body.checkoutContractVersion, 2);
      const invoiceSerializedItem = invoice.body.items.find((item) => item.productId === String(tracked.id));
      assert.equal(invoiceSerializedItem.stockUnits[0].serialNumber, 'P2E-001');
      assert.equal(invoiceSerializedItem.shopWarrantyMonths, 3);

      const saleList = await invoke(salesRouter, '/', 'get', {
        user: { id: cashier.id }, query: {},
      });
      assert.equal(saleList.statusCode, 200);
      const listedSale = saleList.body.find((sale) => Number(sale.id) === Number(saleId));
      assert.equal(listedSale.items.find(
        (item) => Number(item.product_id) === Number(tracked.id)
      ).stock_units[0].manufacturer_serial_number_snapshot, 'P2E-001');

      const concurrentRefunds = await Promise.all([
        invoke(salesRouter, '/:id/refund', 'post', {
          user: { id: admin.id, username: 'p2e-admin' },
          params: { id: String(saleId) }, body: { reason: 'customer return' },
        }),
        invoke(salesRouter, '/:id/refund', 'post', {
          user: { id: admin.id, username: 'p2e-admin' },
          params: { id: String(saleId) }, body: { reason: 'concurrent return' },
        }),
      ]);
      assert.deepEqual(
        concurrentRefunds.map((response) => response.statusCode).sort(),
        [200, 409]
      );
      assert.deepEqual(await one(pool, `
        SELECT p.stock_quantity::integer AS serialized_quantity,
               u.stock_quantity::integer AS untracked_quantity, su.state
        FROM products p, products u, stock_units su
        WHERE p.id = $1 AND u.id = $2 AND su.id = $3
      `, [tracked.id, untracked.id, units[0].id]), {
        serialized_quantity: 1, untracked_quantity: 10, state: 'quarantined',
      });
      assert.equal((await invoke(salesRouter, '/:id/refund', 'post', {
        user: { id: admin.id }, params: { id: String(saleId) }, body: { reason: 'again' },
      })).statusCode, 409);
      assert.equal((await checkout('623e4567-e89b-42d3-a456-426614174006', units[0].id)).statusCode, 409);

      const voidSale = await checkout('723e4567-e89b-42d3-a456-426614174007', units[2].id, [
        { product_id: untracked.id, quantity: 1, stock_unit_ids: [] },
      ]);
      assert.equal(voidSale.statusCode, 201);
      const concurrentVoids = await Promise.all([
        invoke(salesRouter, '/:id/void', 'post', {
          user: { id: admin.id }, params: { id: String(voidSale.body.sale.id) }, body: {},
        }),
        invoke(salesRouter, '/:id/void', 'post', {
          user: { id: admin.id }, params: { id: String(voidSale.body.sale.id) }, body: {},
        }),
      ]);
      assert.deepEqual(
        concurrentVoids.map((response) => response.statusCode).sort(),
        [200, 409]
      );
      assert.equal((await one(pool, `SELECT state FROM stock_units WHERE id = $1`, [units[2].id])).state, 'quarantined');
      assert.equal((await invoke(salesRouter, '/:id/void', 'post', {
        user: { id: admin.id }, params: { id: String(voidSale.body.sale.id) }, body: {},
      })).statusCode, 409);
    } finally {
      await routePool.end();
      await pool.end();
    }
  });
