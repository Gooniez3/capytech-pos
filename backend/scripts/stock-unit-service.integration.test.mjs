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
import { UP_SQL as FIX01_UP_SQL } from '../migrations/1792022400000_fix01-stock-unit-barcode-codes.mjs';

const require = createRequire(import.meta.url);
const {
  attachTransaction,
  assertTransactionCanCommit,
  withTransaction,
} = require('../src/services/domain-transaction');
const {
  adoptExistingInventory,
  checkInventoryReconciliation,
  quarantineSoldUnits,
  registerReceivedUnits,
  releaseQuarantinedUnits,
  retireStockUnits,
  sellStockUnits,
  setUntrackedInventoryQuantity,
} = require('../src/services/stock-unit-service');
const {
  buildShopWarrantySnapshot,
  lookupStoredWarrantyBySerial,
} = require('../src/services/shop-warranty-period');

const { Client, Pool } = pg;
const connectionString = process.env.CAPYTECH_PHASE2C_TEST_DATABASE_URL;

async function one(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function createSaleItem(pool, {
  invoiceNumber, userId, productId, productName, variantId = null,
  variantName = null, variantSku = null,
}) {
  const sale = await one(pool, `
    INSERT INTO sales
      (invoice_number, user_id, subtotal, tax, discount, total,
       payment_method, status, checkout_contract_version)
    VALUES ($1, $2, 100, 0, 0, 100, 'cash', 'completed', 2)
    RETURNING id
  `, [invoiceNumber, userId]);
  const item = await one(pool, `
    INSERT INTO sale_items
      (sale_id, product_id, product_name, quantity, unit_price, line_total,
       variant_id, variant_name, variant_sku, unit_cost,
       product_sku_snapshot, variant_sku_snapshot)
    SELECT $1, p.id, $2, 1, 100, 100, $3, $4, $5, 60, p.sku, $5
    FROM products p
    WHERE p.id = $6
    RETURNING id
  `, [
    sale.id, productName, variantId, variantName, variantSku, productId,
  ]);
  return { saleId: Number(sale.id), saleItemId: Number(item.id) };
}

test(
  'Phase 2C services preserve inventory and lifecycle invariants in a disposable database',
  { skip: !connectionString },
  async () => {
    const configuredName = new URL(connectionString).pathname.slice(1);
    assert.match(configuredName, /^capytech_phase2c_test_[a-z0-9_]+$/);

    const bootstrap = new Client({
      connectionString,
      application_name: 'capytech_phase2c_bootstrap',
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
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
      `);
      assert.equal(initial.rows[0].count, 0, 'Disposable database must start empty.');

      await bootstrap.query('BEGIN');
      await bootstrap.query(BASELINE_SQL);
      await bootstrap.query(P04_UP_SQL);
      await bootstrap.query(P06_UP_SQL);
      await bootstrap.query(P08_UP_SQL);
      await bootstrap.query(P10_UP_SQL);
      await bootstrap.query(P2B_UP_SQL);
      await bootstrap.query(FIX01_UP_SQL);
      await bootstrap.query('COMMIT');
    } finally {
      await bootstrap.end();
    }

    const pool = new Pool({
      connectionString,
      max: 8,
      application_name: 'capytech_phase2c_integration',
      options: '-c statement_timeout=60000 -c lock_timeout=10000',
    });
    try {
      const user = await one(pool, `
        INSERT INTO users (name, username, password_hash, role)
        VALUES ('Phase 2C Admin', 'phase2c-admin', 'not-a-real-password-hash', 'admin')
        RETURNING id
      `);
      const category = await one(pool, `
        INSERT INTO categories (name) VALUES ('Phase 2C Test') RETURNING id
      `);
      const insertProduct = async (sku, name, quantity, tracked, warranty = false, months = null) =>
        one(pool, `
          INSERT INTO products
            (sku, name, category_id, price, cost, stock_quantity,
             serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months)
          VALUES ($1, $2, $3, 100, 60, $4, $5, $6, $7)
          RETURNING id, sku
        `, [sku, name, category.id, quantity, tracked, warranty, months]);

      const adoptedProduct = await insertProduct('ADOPT-P', 'Adopted Product', 2, true, true, 3);
      const receivedProduct = await insertProduct('RECEIVE-P', 'Received Product', 0, true, true, 12);
      const wrongAdoptionProduct = await insertProduct('WRONG-ADOPT', 'Wrong Adoption', 2, true);
      const untrackedProduct = await insertProduct('UNTRACKED-P', 'Untracked Product', 5, false);
      const batchRollbackProduct = await insertProduct('ROLLBACK-P', 'Rollback Product', 0, true);
      const attachedRollbackProduct = await insertProduct(
        'ATTACHED-ROLLBACK-P', 'Attached Rollback Product', 0, true
      );
      const variantProduct = await insertProduct('VARIANT-P', 'Variant Product', 0, true, true, 6);
      const inheritedVariant = await one(pool, `
        INSERT INTO product_variants
          (product_id, name, sku, price, cost, stock_quantity,
           serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months)
        VALUES ($1, 'Inherited', 'VARIANT-INHERIT', 110, 65, 1, NULL, NULL, NULL)
        RETURNING id, sku
      `, [variantProduct.id]);
      const disabledVariant = await one(pool, `
        INSERT INTO product_variants
          (product_id, name, sku, price, cost, stock_quantity,
           serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months)
        VALUES ($1, 'Disabled', 'VARIANT-DISABLED', 120, 70, 0, FALSE, FALSE, NULL)
        RETURNING id, sku
      `, [variantProduct.id]);

      const adopted = await withTransaction(pool, (transaction) =>
        adoptExistingInventory(transaction, {
          actorUserId: user.id,
          batches: [{
            productId: adoptedProduct.id,
            serialNumbers: [' 00-ADOPT A ', '00-ADOPT-B'],
          }],
        })
      );
      assert.equal(adopted.length, 2);
      assert.equal(adopted[0].manufacturer_serial_number, ' 00-ADOPT A ');
      assert.equal((await one(pool,
        `SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1`,
        [adoptedProduct.id]
      )).quantity, 2, 'Adoption must not increase aggregate quantity.');
      const adoptedCounts = await one(pool, `
        SELECT COUNT(*)::integer AS units,
               COUNT(*) FILTER (WHERE state = 'available')::integer AS available
        FROM stock_units WHERE product_id = $1
      `, [adoptedProduct.id]);
      assert.deepEqual(adoptedCounts, { units: 2, available: 2 });
      const adoptionEvents = await pool.query(`
        SELECT event_type, metadata->>'source' AS source
        FROM stock_unit_events
        WHERE stock_unit_id = ANY($1::bigint[])
        ORDER BY id
      `, [adopted.map((unit) => unit.id)]);
      assert.deepEqual(adoptionEvents.rows, [
        { event_type: 'received', source: 'adopted' },
        { event_type: 'received', source: 'adopted' },
      ]);

      await assert.rejects(
        withTransaction(pool, (transaction) => adoptExistingInventory(transaction, {
          actorUserId: user.id,
          batches: [{ productId: wrongAdoptionProduct.id, serialNumbers: ['ONLY-ONE'] }],
        })),
        (error) => error.code === 'ADOPTION_QUANTITY_MISMATCH'
      );
      assert.equal((await one(pool,
        `SELECT COUNT(*)::integer AS count FROM stock_units WHERE product_id = $1`,
        [wrongAdoptionProduct.id]
      )).count, 0);

      const inheritedUnits = await withTransaction(pool, (transaction) =>
        adoptExistingInventory(transaction, {
          actorUserId: user.id,
          batches: [{
            productId: variantProduct.id,
            variantId: inheritedVariant.id,
            serialNumbers: ['VAR-INHERIT-001'],
          }],
        })
      );
      assert.equal(inheritedUnits.length, 1);
      await assert.rejects(
        withTransaction(pool, (transaction) => registerReceivedUnits(transaction, {
          actorUserId: user.id,
          batches: [{
            productId: variantProduct.id,
            variantId: disabledVariant.id,
            serialNumbers: ['VAR-DISABLED-001'],
          }],
        })),
        (error) => error.code === 'SERIAL_TRACKING_DISABLED'
      );
      await assert.rejects(
        withTransaction(pool, (transaction) => registerReceivedUnits(transaction, {
          actorUserId: user.id,
          batches: [{ productId: variantProduct.id, serialNumbers: ['PARENT-NOT-ALLOWED'] }],
        })),
        (error) => error.code === 'VARIANT_TARGET_REQUIRED'
      );

      await assert.rejects(
        withTransaction(pool, async (transaction) => {
          await registerReceivedUnits(transaction, {
            actorUserId: user.id,
            batches: [{ productId: batchRollbackProduct.id, serialNumbers: ['ROLL-BACK-001'] }],
          });
          throw new Error('force complete transaction rollback');
        }),
        /force complete transaction rollback/
      );
      assert.deepEqual(await one(pool, `
        SELECT p.stock_quantity::integer AS quantity,
               COUNT(su.id)::integer AS units,
               COUNT(e.id)::integer AS events
        FROM products p
        LEFT JOIN stock_units su ON su.product_id = p.id
        LEFT JOIN stock_unit_events e ON e.stock_unit_id = su.id
        WHERE p.id = $1
        GROUP BY p.id
      `, [batchRollbackProduct.id]), { quantity: 0, units: 0, events: 0 });

      const attachedClient = await pool.connect();
      try {
        await attachedClient.query('BEGIN');
        const attachedTransaction = attachTransaction(attachedClient);
        await assert.rejects(
          registerReceivedUnits(attachedTransaction, {
            actorUserId: 2147483647,
            batches: [{
              productId: attachedRollbackProduct.id,
              serialNumbers: ['ATTACHED-ROLLBACK-001'],
            }],
          }),
          (error) => error.code === '23503'
        );
        assert.throws(
          () => assertTransactionCanCommit(attachedTransaction),
          /must be rolled back/
        );
        assert.deepEqual(await one(attachedClient, `
          SELECT p.stock_quantity::integer AS quantity,
                 COUNT(su.id)::integer AS units,
                 COUNT(e.id)::integer AS events
          FROM products p
          LEFT JOIN stock_units su ON su.product_id = p.id
          LEFT JOIN stock_unit_events e ON e.stock_unit_id = su.id
          WHERE p.id = $1
          GROUP BY p.id
        `, [attachedRollbackProduct.id]), { quantity: 0, units: 0, events: 0 });
      } finally {
        await attachedClient.query('ROLLBACK');
        attachedClient.release();
      }

      const received = await withTransaction(pool, (transaction) =>
        registerReceivedUnits(transaction, {
          actorUserId: user.id,
          batches: [{
            productId: receivedProduct.id,
            serialNumbers: [' RX-000 1 ', 'RX-000-2', 'RX-000-3'],
          }],
        })
      );
      assert.equal(received.length, 3);
      assert.equal((await one(pool,
        `SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1`,
        [receivedProduct.id]
      )).quantity, 3);
      const serialRow = await one(pool, `
        SELECT manufacturer_serial_number, normalized_serial_number, internal_sku
        FROM stock_units WHERE id = $1
      `, [received[0].id]);
      assert.equal(serialRow.manufacturer_serial_number, ' RX-000 1 ');
      assert.equal(serialRow.normalized_serial_number, 'RX0001');
      assert.match(serialRow.internal_sku, /^SU-[0-9]+$/);

      await assert.rejects(
        withTransaction(pool, (transaction) => registerReceivedUnits(transaction, {
          actorUserId: user.id,
          batches: [{ productId: receivedProduct.id, serialNumbers: ['r x_000-1'] }],
        })),
        (error) => error.code === 'DUPLICATE_SERIAL_NUMBER'
      );
      assert.equal((await one(pool,
        `SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1`,
        [receivedProduct.id]
      )).quantity, 3);

      await assert.rejects(
        withTransaction(pool, (transaction) =>
          setUntrackedInventoryQuantity(transaction, { productId: receivedProduct.id }, 99)
        ),
        (error) => error.code === 'DIRECT_QUANTITY_EDIT_FORBIDDEN'
      );
      assert.equal(await withTransaction(pool, (transaction) =>
        setUntrackedInventoryQuantity(transaction, { productId: untrackedProduct.id }, 7)
      ), 7);

      const saleA = await createSaleItem(pool, {
        invoiceNumber: 'P2C-CONCURRENT-A', userId: user.id,
        productId: receivedProduct.id, productName: 'Received Product',
      });
      const saleB = await createSaleItem(pool, {
        invoiceNumber: 'P2C-CONCURRENT-B', userId: user.id,
        productId: receivedProduct.id, productName: 'Received Product',
      });
      const concurrentResults = await Promise.allSettled([
        withTransaction(pool, (transaction) => sellStockUnits(transaction, {
          unitIds: [received[0].id], ...saleA, actorUserId: user.id,
        })),
        withTransaction(pool, (transaction) => sellStockUnits(transaction, {
          unitIds: [received[0].id], ...saleB, actorUserId: user.id,
        })),
      ]);
      assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(concurrentResults.filter((result) => result.status === 'rejected').length, 1);
      const activeAssignment = await one(pool, `
        SELECT sis.sale_item_id, si.sale_id
        FROM sale_item_stock_units sis
        JOIN sale_items si ON si.id = sis.sale_item_id
        WHERE sis.stock_unit_id = $1 AND sis.released_at IS NULL
      `, [received[0].id]);
      assert.equal((await one(pool,
        `SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1`,
        [receivedProduct.id]
      )).quantity, 2);

      await assert.rejects(
        withTransaction(pool, (transaction) => sellStockUnits(transaction, {
          unitIds: [received[1].id],
          saleId: activeAssignment.sale_id,
          saleItemId: activeAssignment.sale_item_id,
          actorUserId: user.id,
        })),
        (error) => error.code === 'SALE_ITEM_UNIT_MISMATCH'
      );
      assert.equal((await one(pool,
        `SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1`,
        [receivedProduct.id]
      )).quantity, 2);

      await pool.query(
        `UPDATE products
         SET is_active = FALSE, serial_tracking_enabled = FALSE
         WHERE id = $1`,
        [receivedProduct.id]
      );
      await withTransaction(pool, (transaction) => quarantineSoldUnits(transaction, {
        unitIds: [received[0].id], action: 'refunded',
        saleId: activeAssignment.sale_id, actorUserId: user.id,
        reason: 'integration refund',
      }));
      assert.deepEqual(await one(pool, `
        SELECT su.state, p.stock_quantity::integer AS quantity
        FROM stock_units su JOIN products p ON p.id = su.product_id
        WHERE su.id = $1
      `, [received[0].id]), { state: 'quarantined', quantity: 2 });

      await withTransaction(pool, (transaction) => releaseQuarantinedUnits(transaction, {
        unitIds: [received[0].id], actorUserId: user.id, reason: 'inspection passed',
      }));
      assert.equal((await one(pool,
        `SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1`,
        [receivedProduct.id]
      )).quantity, 3);
      await withTransaction(pool, (transaction) => retireStockUnits(transaction, {
        unitIds: [received[0].id], actorUserId: user.id, reason: 'retired after return',
      }));
      assert.deepEqual(await one(pool, `
        SELECT su.state, p.stock_quantity::integer AS quantity
        FROM stock_units su JOIN products p ON p.id = su.product_id
        WHERE su.id = $1
      `, [received[0].id]), { state: 'retired', quantity: 2 });
      await assert.rejects(
        withTransaction(pool, (transaction) => releaseQuarantinedUnits(transaction, {
          unitIds: [received[0].id], actorUserId: user.id,
        })),
        (error) => error.code === 'INVALID_UNIT_TRANSITION'
      );

      await pool.query(
        `UPDATE products SET is_active = TRUE WHERE id = $1`,
        [receivedProduct.id]
      );
      await assert.rejects(
        withTransaction(pool, (transaction) =>
          setUntrackedInventoryQuantity(transaction, { productId: receivedProduct.id }, 99)
        ),
        (error) => error.code === 'DIRECT_QUANTITY_EDIT_FORBIDDEN'
      );
      await pool.query(
        `UPDATE products SET serial_tracking_enabled = TRUE WHERE id = $1`,
        [receivedProduct.id]
      );

      const saleC = await createSaleItem(pool, {
        invoiceNumber: 'P2C-VOID', userId: user.id,
        productId: receivedProduct.id, productName: 'Received Product',
      });
      await withTransaction(pool, (transaction) => sellStockUnits(transaction, {
        unitIds: [received[1].id], ...saleC, actorUserId: user.id,
      }));
      await withTransaction(pool, (transaction) => quarantineSoldUnits(transaction, {
        unitIds: [received[1].id], action: 'voided', saleId: saleC.saleId,
        actorUserId: user.id,
      }));
      const beforeQuarantinedRetire = (await one(pool,
        `SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1`,
        [receivedProduct.id]
      )).quantity;
      await withTransaction(pool, (transaction) => retireStockUnits(transaction, {
        unitIds: [received[1].id], actorUserId: user.id,
      }));
      assert.equal((await one(pool,
        `SELECT stock_quantity::integer AS quantity FROM products WHERE id = $1`,
        [receivedProduct.id]
      )).quantity, beforeQuarantinedRetire);

      const reconciliation = await withTransaction(pool, (transaction) =>
        checkInventoryReconciliation(transaction, { productId: receivedProduct.id })
      );
      assert.equal(reconciliation.consistent, true);
      assert.equal(reconciliation.aggregateQuantity, 1);
      assert.equal(reconciliation.availableUnitCount, 1);

      await assert.rejects(
        withTransaction(pool, async (transaction) => {
          await transaction.client.query(
            `UPDATE products SET stock_quantity = stock_quantity + 1 WHERE id = $1`,
            [receivedProduct.id]
          );
          const mismatch = await checkInventoryReconciliation(
            transaction,
            { productId: receivedProduct.id }
          );
          assert.equal(mismatch.consistent, false);
          throw new Error('rollback reconciliation tamper');
        }),
        /rollback reconciliation tamper/
      );
      assert.equal((await withTransaction(pool, (transaction) =>
        checkInventoryReconciliation(transaction, { productId: receivedProduct.id })
      )).consistent, true);

      const history = await pool.query(`
        SELECT event_type, from_state, to_state
        FROM stock_unit_events
        WHERE stock_unit_id = $1
        ORDER BY id
      `, [received[0].id]);
      assert.deepEqual(history.rows, [
        { event_type: 'received', from_state: null, to_state: 'available' },
        { event_type: 'sold', from_state: 'available', to_state: 'sold' },
        { event_type: 'refunded', from_state: 'sold', to_state: 'quarantined' },
        { event_type: 'released', from_state: 'quarantined', to_state: 'available' },
        { event_type: 'retired', from_state: 'available', to_state: 'retired' },
      ]);

      const warrantySnapshot = buildShopWarrantySnapshot({
        shopWarrantyEligible: true,
        shopWarrantyMonths: 12,
      }, '2024-02-29');
      await pool.query(`
        UPDATE sale_items
        SET shop_warranty_eligible = $1,
            shop_warranty_months = $2,
            shop_warranty_start_date = $3,
            shop_warranty_end_date = $4
        WHERE id = $5
      `, [
        warrantySnapshot.shopWarrantyEligible,
        warrantySnapshot.shopWarrantyMonths,
        warrantySnapshot.shopWarrantyStartDate,
        warrantySnapshot.shopWarrantyEndDate,
        activeAssignment.sale_item_id,
      ]);
      const lookup = await lookupStoredWarrantyBySerial(pool, 'r x_000-1', {
        asOfDate: '2025-02-28',
      });
      assert.equal(lookup[0].warranty.status, 'active');
      assert.equal(lookup[0].warranty.endDate, '2025-02-28');
      assert.equal(lookup[0].shop_warranty_months, 12);
    } finally {
      await pool.end();
    }
  }
);
