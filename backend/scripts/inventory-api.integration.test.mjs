import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
import { BASELINE_SQL } from '../migrations/1788652800000_baseline.mjs';
import { UP_SQL as P04_UP_SQL } from '../migrations/1788652800001_p04-database-constraints.mjs';
import { UP_SQL as P06_UP_SQL } from '../migrations/1788652800002_p06-checkout-request-fingerprint.mjs';
import { UP_SQL as P08_UP_SQL } from '../migrations/1788652800003_p08-product-recycle-bin.mjs';
import { UP_SQL as P10_UP_SQL } from '../migrations/1791676800000_p10-invoice-warranty.mjs';
import { UP_SQL as P2B_UP_SQL } from '../migrations/1791763200000_p2b-stock-unit-warranty-schema.mjs';

const require = createRequire(import.meta.url);
const { withTransaction } = require('../src/services/domain-transaction');
const { updateInventoryPolicy } = require('../src/services/inventory-policy-service');
const {
  quarantineSoldUnits,
  registerReceivedUnits,
  releaseQuarantinedUnits,
  retireStockUnits,
  sellStockUnits,
} = require('../src/services/stock-unit-service');
const {
  correctAvailableSerial,
  listStockUnits,
  lookupStockUnit,
  stockUnitDetails,
} = require('../src/services/stock-unit-api-service');
const { buildShopWarrantySnapshot } = require('../src/services/shop-warranty-period');
const { lookupWarranty } = require('../src/services/warranty-lookup-service');
const { restoreExactInventory } = require('../src/services/sale-reversal');

const { Client, Pool } = pg;
const connectionString = process.env.CAPYTECH_PHASE2D_TEST_DATABASE_URL;

async function one(queryable, sql, params = []) {
  const result = await queryable.query(sql, params);
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function invokeRoute(router, path, method, req) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer, `Route ${method.toUpperCase()} ${path} must exist`);
  const handler = layer.route.stack.at(-1).handle;
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(req, response);
  return response;
}

test(
  'Phase 2D APIs preserve policy, inventory, warranty, audit, and transaction invariants',
  { skip: !connectionString },
  async () => {
    const configuredName = new URL(connectionString).pathname.slice(1);
    assert.match(configuredName, /^capytech_phase2d_test_[a-z0-9_]+$/);

    const bootstrap = new Client({
      connectionString,
      application_name: 'capytech_phase2d_bootstrap',
      options: '-c statement_timeout=60000',
    });
    await bootstrap.connect();
    try {
      const identity = await bootstrap.query(`
        SELECT current_database() AS database,
               current_setting('server_version_num')::integer AS server_version
      `);
      assert.equal(identity.rows[0].database, configuredName);
      assert.ok(identity.rows[0].server_version >= 170000);
      assert.ok(identity.rows[0].server_version < 190000);
      const initial = await bootstrap.query(`
        SELECT COUNT(*)::integer AS count
        FROM pg_catalog.pg_tables WHERE schemaname = 'public'
      `);
      assert.equal(initial.rows[0].count, 0, 'Disposable database must start empty.');
      await bootstrap.query('BEGIN');
      await bootstrap.query(BASELINE_SQL);
      await bootstrap.query(P04_UP_SQL);
      await bootstrap.query(P06_UP_SQL);
      await bootstrap.query(P08_UP_SQL);
      await bootstrap.query(P10_UP_SQL);
      await bootstrap.query(P2B_UP_SQL);
      await bootstrap.query('COMMIT');
    } finally {
      await bootstrap.end();
    }

    const pool = new Pool({
      connectionString,
      max: 8,
      application_name: 'capytech_phase2d_integration',
      options: '-c statement_timeout=60000 -c lock_timeout=10000',
    });
    const routeDatabase = new URL(connectionString);
    process.env.DB_HOST = routeDatabase.hostname;
    process.env.DB_PORT = routeDatabase.port;
    process.env.DB_USER = decodeURIComponent(routeDatabase.username);
    process.env.DB_PASSWORD = decodeURIComponent(routeDatabase.password);
    process.env.DB_NAME = configuredName;
    const productsRouter = require('../src/routes/products');
    const routePool = require('../src/db/pool');
    try {
      const admin = await one(pool, `
        INSERT INTO users (name, username, password_hash, role)
        VALUES ('Admin', 'phase2d-admin', 'not-a-real-hash', 'admin') RETURNING id
      `);
      const cashier = await one(pool, `
        INSERT INTO users (name, username, password_hash, role)
        VALUES ('Cashier', 'phase2d-cashier', 'not-a-real-hash', 'cashier') RETURNING id
      `);
      const category = await one(pool, `
        INSERT INTO categories (name) VALUES ('Phase 2D') RETURNING id
      `);
      const insertProduct = (sku, name, stock = 0) => one(pool, `
        INSERT INTO products (sku, name, category_id, price, cost, stock_quantity)
        VALUES ($1, $2, $3, 100, 60, $4) RETURNING id
      `, [sku, name, category.id, stock]);

      const adoptedProduct = await insertProduct('P2D-ADOPT', 'Adopted API Product', 2);
      await assert.rejects(
        withTransaction(pool, (transaction) => updateInventoryPolicy(transaction, {
          actorUserId: admin.id,
          productId: adoptedProduct.id,
          body: {
            serial_tracking_enabled: true,
            shop_warranty_enabled: true,
            shop_warranty_months: 3,
            serial_numbers: ['ONLY-ONE'],
          },
        })),
        (error) => error.code === 'ADOPTION_QUANTITY_MISMATCH'
      );
      assert.deepEqual(await one(pool, `
        SELECT serial_tracking_enabled, shop_warranty_enabled,
               stock_quantity::integer AS stock_quantity,
               (SELECT COUNT(*)::integer FROM stock_units WHERE product_id = products.id) AS units
        FROM products WHERE id = $1
      `, [adoptedProduct.id]), {
        serial_tracking_enabled: false,
        shop_warranty_enabled: false,
        stock_quantity: 2,
        units: 0,
      });

      const adoptedPolicy = await withTransaction(pool, (transaction) =>
        updateInventoryPolicy(transaction, {
          actorUserId: admin.id,
          productId: adoptedProduct.id,
          body: {
            serial_tracking_enabled: true,
            shop_warranty_enabled: true,
            shop_warranty_months: 3,
            serial_numbers: [' 00-API-A ', '00-API-B'],
          },
        })
      );
      assert.equal(adoptedPolicy.effective_serial_tracking_enabled, true);
      assert.equal(adoptedPolicy.effective_shop_warranty_months, 3);
      assert.deepEqual(await one(pool, `
        SELECT p.stock_quantity::integer AS quantity,
               COUNT(su.id)::integer AS units
        FROM products p LEFT JOIN stock_units su ON su.product_id = p.id
        WHERE p.id = $1 GROUP BY p.id
      `, [adoptedProduct.id]), { quantity: 2, units: 2 });

      await assert.rejects(
        withTransaction(pool, (transaction) => updateInventoryPolicy(transaction, {
          actorUserId: cashier.id,
          productId: adoptedProduct.id,
          body: { shop_warranty_enabled: false, shop_warranty_months: null },
        })),
        (error) => error.statusCode === 403
      );

      const variantProduct = await insertProduct('P2D-VP', 'Variant Parent', 0);
      const variantA = await one(pool, `
        INSERT INTO product_variants (product_id, name, sku, stock_quantity)
        VALUES ($1, 'A', 'P2D-VA', 1) RETURNING id
      `, [variantProduct.id]);
      const variantB = await one(pool, `
        INSERT INTO product_variants (product_id, name, sku, stock_quantity)
        VALUES ($1, 'B', 'P2D-VB', 1) RETURNING id
      `, [variantProduct.id]);
      const variantC = await one(pool, `
        INSERT INTO product_variants (product_id, name, sku, stock_quantity)
        VALUES ($1, 'C', 'P2D-VC', 0) RETURNING id
      `, [variantProduct.id]);
      await withTransaction(pool, (transaction) => updateInventoryPolicy(transaction, {
        actorUserId: admin.id,
        productId: variantProduct.id,
        body: {
          serial_tracking_enabled: true,
          shop_warranty_enabled: true,
          shop_warranty_months: 6,
          adoption_batches: [
            { variant_id: variantA.id, serial_numbers: ['VAR-A-001'] },
            { variant_id: variantB.id, serial_numbers: ['VAR-B-001'] },
          ],
        },
      }));
      assert.equal((await one(pool, `
        SELECT COUNT(*)::integer AS count FROM stock_units WHERE product_id = $1
      `, [variantProduct.id])).count, 2);
      const variantOverride = await withTransaction(pool, (transaction) =>
        updateInventoryPolicy(transaction, {
          actorUserId: admin.id,
          productId: variantProduct.id,
          variantId: variantC.id,
          body: {
            serial_tracking_enabled: false,
            shop_warranty_enabled: true,
            shop_warranty_months: 12,
          },
        })
      );
      assert.equal(variantOverride.effective_serial_tracking_enabled, false);
      assert.equal(variantOverride.effective_shop_warranty_months, 12);
      const inheritedAgain = await withTransaction(pool, (transaction) =>
        updateInventoryPolicy(transaction, {
          actorUserId: admin.id,
          productId: variantProduct.id,
          variantId: variantC.id,
          body: {
            serial_tracking_enabled: null,
            shop_warranty_enabled: null,
            shop_warranty_months: null,
          },
        })
      );
      assert.equal(inheritedAgain.serial_tracking_source, 'product');
      assert.equal(inheritedAgain.effective_shop_warranty_months, 6);

      const legacyProduct = await insertProduct('P2D-LEGACY', 'Legacy Quantity Product', 1);
      await restoreExactInventory(pool, [{
        product_id: legacyProduct.id, variant_id: null, quantity: 1,
      }]);
      assert.equal((await one(pool, `
        SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1
      `, [legacyProduct.id])).quantity, 2);
      await assert.rejects(
        restoreExactInventory(pool, [{
          product_id: adoptedProduct.id, variant_id: null, quantity: 1,
        }]),
        (error) => error.statusCode === 409 && /serialized return workflow/.test(error.message)
      );
      await assert.rejects(
        restoreExactInventory(pool, [{
          product_id: variantProduct.id, variant_id: variantA.id, quantity: 1,
        }]),
        (error) => error.statusCode === 409 && /serialized return workflow/.test(error.message)
      );

      const variantsResponse = await invokeRoute(
        productsRouter,
        '/:id/variants',
        'get',
        { params: { id: String(variantProduct.id) } }
      );
      assert.equal(variantsResponse.statusCode, 200);
      assert.equal(
        variantsResponse.body.find((entry) => Number(entry.id) === Number(variantA.id))
          .effective_serial_tracking_enabled,
        true
      );
      const unchangedQuantity = await invokeRoute(
        productsRouter,
        '/:id/variants/:variantId',
        'put',
        {
          params: { id: String(variantProduct.id), variantId: String(variantA.id) },
          body: { stock_quantity: 1 },
        }
      );
      assert.equal(unchangedQuantity.statusCode, 200);
      const forbiddenQuantity = await invokeRoute(
        productsRouter,
        '/:id/variants/:variantId',
        'put',
        {
          params: { id: String(variantProduct.id), variantId: String(variantA.id) },
          body: { stock_quantity: 2 },
        }
      );
      assert.equal(forbiddenQuantity.statusCode, 409);
      assert.equal(forbiddenQuantity.body.code, 'DIRECT_QUANTITY_EDIT_FORBIDDEN');

      const received = await withTransaction(pool, (transaction) =>
        registerReceivedUnits(transaction, {
          actorUserId: admin.id,
          batches: [{ productId: adoptedProduct.id, serialNumbers: ['SCAN-MANUAL-001'] }],
        })
      );
      const byScanner = await lookupStockUnit(pool, 'SCAN-MANUAL-001');
      const byManual = await lookupStockUnit(pool, ' scan manual 001 ');
      const byInternalSku = await lookupStockUnit(pool, received[0].internal_sku.toLowerCase());
      assert.equal(byScanner.id, byManual.id);
      assert.equal(byScanner.id, byInternalSku.id);

      const listed = await listStockUnits(pool, {
        page: '1', limit: '2', state: 'available', product_id: String(adoptedProduct.id),
      });
      assert.equal(listed.items.length, 2);
      assert.ok(listed.pagination.total >= 3);
      assert.equal((await stockUnitDetails(pool, received[0].id)).history[0].event_type, 'received');

      const duplicateProduct = await insertProduct('P2D-DUP', 'Concurrent Product', 0);
      await withTransaction(pool, (transaction) => updateInventoryPolicy(transaction, {
        actorUserId: admin.id,
        productId: duplicateProduct.id,
        body: { serial_tracking_enabled: true },
      }));
      const duplicates = await Promise.allSettled([
        withTransaction(pool, (transaction) => registerReceivedUnits(transaction, {
          actorUserId: admin.id,
          batches: [{ productId: duplicateProduct.id, serialNumbers: ['DUP-API-001'] }],
        })),
        withTransaction(pool, (transaction) => registerReceivedUnits(transaction, {
          actorUserId: admin.id,
          batches: [{ productId: duplicateProduct.id, serialNumbers: ['dup api 001'] }],
        })),
      ]);
      assert.equal(duplicates.filter((entry) => entry.status === 'fulfilled').length, 1);
      assert.equal((await one(pool, `
        SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1
      `, [duplicateProduct.id])).quantity, 1);

      const quantityBeforeCorrection = (await one(pool, `
        SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1
      `, [adoptedProduct.id])).quantity;
      await assert.rejects(
        withTransaction(pool, (transaction) => correctAvailableSerial(transaction, {
          unitId: received[0].id,
          serialNumber: 'dup api 001',
          actorUserId: admin.id,
          reason: 'must remain atomic on duplicate',
        })),
        (error) => error.code === 'DUPLICATE_SERIAL_NUMBER'
      );
      assert.deepEqual(await one(pool, `
        SELECT state, manufacturer_serial_number FROM stock_units WHERE id = $1
      `, [received[0].id]), {
        state: 'available', manufacturer_serial_number: 'SCAN-MANUAL-001',
      });
      assert.equal((await one(pool, `
        SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1
      `, [adoptedProduct.id])).quantity, quantityBeforeCorrection);

      const corrected = await withTransaction(pool, (transaction) =>
        correctAvailableSerial(transaction, {
          unitId: received[0].id,
          serialNumber: 'CORRECTED-001',
          actorUserId: admin.id,
          reason: 'verified physical label',
        })
      );
      assert.equal(corrected.retired_unit.id, received[0].id);
      assert.equal(corrected.replacement_unit.manufacturer_serial_number, 'CORRECTED-001');
      assert.equal((await one(pool, `
        SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1
      `, [adoptedProduct.id])).quantity, quantityBeforeCorrection);
      assert.deepEqual(await one(pool, `
        SELECT COUNT(*) FILTER (WHERE state = 'available')::integer AS available,
               COUNT(*) FILTER (WHERE state = 'retired')::integer AS retired
        FROM stock_units WHERE product_id = $1
      `, [adoptedProduct.id]), { available: 3, retired: 1 });
      assert.deepEqual((await pool.query(`
        SELECT event_type FROM stock_unit_events
        WHERE stock_unit_id = $1 ORDER BY id
      `, [received[0].id])).rows.map((row) => row.event_type), ['received', 'retired']);
      await assert.rejects(
        withTransaction(pool, (transaction) => registerReceivedUnits(transaction, {
          actorUserId: admin.id,
          batches: [{
            productId: adoptedProduct.id,
            serialNumbers: ['scan manual 001'],
          }],
        })),
        (error) => error.code === 'DUPLICATE_SERIAL_NUMBER'
      );
      await assert.rejects(
        withTransaction(pool, (transaction) => correctAvailableSerial(transaction, {
          unitId: received[0].id,
          serialNumber: 'REPEATED-CORRECTION',
          actorUserId: admin.id,
        })),
        (error) => error.code === 'SERIAL_CORRECTION_STATE_CONFLICT'
      );
      assert.equal((await one(pool, `
        SELECT COUNT(*)::integer AS count FROM stock_units WHERE product_id = $1
      `, [adoptedProduct.id])).count, 4);

      const sale = await one(pool, `
        INSERT INTO sales
          (invoice_number, user_id, subtotal, tax, discount, total,
           payment_method, status, checkout_contract_version, created_at)
        VALUES ('P2D-INV-001', $1, 100, 0, 0, 100,
                'cash', 'completed', 2, '2024-02-29 10:00:00')
        RETURNING id
      `, [cashier.id]);
      const snapshot = buildShopWarrantySnapshot({
        shopWarrantyEligible: true, shopWarrantyMonths: 3,
      }, '2024-02-29');
      const saleItem = await one(pool, `
        INSERT INTO sale_items
          (sale_id, product_id, product_name, quantity, unit_price, line_total,
           unit_cost, shop_warranty_eligible, shop_warranty_months,
           shop_warranty_start_date, shop_warranty_end_date, product_sku_snapshot)
        VALUES ($1, $2, 'Adopted API Product', 1, 100, 100, 60,
                $3, $4, $5, $6, 'P2D-ADOPT')
        RETURNING id
      `, [
        sale.id, adoptedProduct.id, snapshot.shopWarrantyEligible,
        snapshot.shopWarrantyMonths, snapshot.shopWarrantyStartDate,
        snapshot.shopWarrantyEndDate,
      ]);
      const soldUnit = await one(pool, `
        SELECT id, internal_sku, manufacturer_serial_number
        FROM stock_units
        WHERE product_id = $1 AND state = 'available'
        ORDER BY id LIMIT 1
      `, [adoptedProduct.id]);
      await withTransaction(pool, (transaction) => sellStockUnits(transaction, {
        unitIds: [soldUnit.id], saleId: sale.id, saleItemId: saleItem.id,
        actorUserId: admin.id,
      }));

      await assert.rejects(
        withTransaction(pool, (transaction) => correctAvailableSerial(transaction, {
          unitId: soldUnit.id,
          serialNumber: 'ILLEGAL-SOLD-CORRECTION',
          actorUserId: admin.id,
        })),
        (error) => error.code === 'SERIAL_CORRECTION_STATE_CONFLICT'
      );
      assert.deepEqual(await one(pool, `
        SELECT su.state, sis.stock_unit_id,
               sis.internal_sku_snapshot, sis.manufacturer_serial_number_snapshot
        FROM stock_units su
        JOIN sale_item_stock_units sis ON sis.stock_unit_id = su.id
        WHERE su.id = $1
      `, [soldUnit.id]), {
        state: 'sold',
        stock_unit_id: soldUnit.id,
        internal_sku_snapshot: soldUnit.internal_sku,
        manufacturer_serial_number_snapshot: soldUnit.manufacturer_serial_number,
      });

      const byInvoice = await lookupWarranty(pool, { invoice_number: 'p2d-inv-001' });
      const bySerial = await lookupWarranty(pool, {
        serial_number: soldUnit.manufacturer_serial_number.toLowerCase(),
      });
      const bySku = await lookupWarranty(pool, { internal_sku: soldUnit.internal_sku.toLowerCase() });
      assert.equal(byInvoice.records[0].shop_warranty_months, 3);
      assert.equal(byInvoice.records[0].shop_warranty_start_date, '2024-02-29');
      assert.equal(byInvoice.records[0].shop_warranty_end_date, '2024-05-28');
      assert.equal(bySerial.records[0].sale_id, bySku.records[0].sale_id);

      await withTransaction(pool, (transaction) => quarantineSoldUnits(transaction, {
        unitIds: [soldUnit.id], action: 'refunded', saleId: sale.id,
        actorUserId: admin.id, reason: 'Phase 2D test refund',
      }));
      await pool.query(`UPDATE sales SET status = 'refunded', refunded_at = NOW() WHERE id = $1`, [sale.id]);
      const refundedLookup = await lookupWarranty(pool, { serial_number: soldUnit.manufacturer_serial_number });
      assert.equal(refundedLookup.records[0].sale_status, 'refunded');
      assert.equal(refundedLookup.records[0].release_reason, 'refunded');

      await withTransaction(pool, (transaction) => releaseQuarantinedUnits(transaction, {
        unitIds: [soldUnit.id], actorUserId: admin.id, reason: 'inspection passed',
      }));
      const quantityBeforeReturnedCorrection = (await one(pool, `
        SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1
      `, [adoptedProduct.id])).quantity;
      const returnedCorrection = await withTransaction(pool, (transaction) =>
        correctAvailableSerial(transaction, {
          unitId: soldUnit.id,
          serialNumber: 'RETURNED-CORRECTED-001',
          actorUserId: admin.id,
          reason: 'correct returned physical label',
        })
      );
      assert.equal((await one(pool, `
        SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1
      `, [adoptedProduct.id])).quantity, quantityBeforeReturnedCorrection);
      assert.equal((await one(pool, `SELECT state FROM stock_units WHERE id = $1`, [soldUnit.id])).state, 'retired');
      assert.equal(returnedCorrection.replacement_unit.state, 'available');
      const historicalAfterCorrection = await lookupWarranty(pool, {
        serial_number: soldUnit.manufacturer_serial_number,
      });
      assert.equal(historicalAfterCorrection.records[0].sale_id, sale.id);
      assert.equal(historicalAfterCorrection.records[0].stock_unit_id, soldUnit.id);
      await assert.rejects(
        lookupWarranty(pool, { serial_number: 'RETURNED-CORRECTED-001' }),
        (error) => error.code === 'WARRANTY_NOT_FOUND'
      );
      await withTransaction(pool, (transaction) => retireStockUnits(transaction, {
        unitIds: [returnedCorrection.replacement_unit.id],
        actorUserId: admin.id,
        reason: 'administratively retired',
      }));

      const audits = await pool.query(`
        SELECT action, details FROM audit_log
        WHERE action IN (
          'UPDATE_PRODUCT_INVENTORY_POLICY',
          'UPDATE_VARIANT_INVENTORY_POLICY',
          'CORRECT_STOCK_UNIT_SERIAL'
        )
        ORDER BY id
      `);
      assert.ok(audits.rows.some((row) => row.action === 'UPDATE_PRODUCT_INVENTORY_POLICY'));
      assert.ok(audits.rows.some((row) => row.action === 'UPDATE_VARIANT_INVENTORY_POLICY'));
      assert.equal(
        audits.rows.filter((row) => row.action === 'CORRECT_STOCK_UNIT_SERIAL').length,
        2,
        'Only the two successful serial corrections may be audited'
      );
    } finally {
      await routePool.end();
      await pool.end();
    }
  }
);
