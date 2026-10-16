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
import { UP_SQL as FIX01 } from '../migrations/1792022400000_fix01-stock-unit-barcode-codes.mjs';
import { UP_SQL as CP } from '../migrations/1792108800000_cp-catalog-codes.mjs';

const require = createRequire(import.meta.url);
const { withTransaction } = require('../src/services/domain-transaction');
const { createProductWorkflow, editProductWorkflow } = require('../src/services/product-workflow-service');
const { Client, Pool } = pg;
const connectionString = process.env.CAPYTECH_PRODUCT_WORKFLOW_TEST_DATABASE_URL;

async function one(client, sql, values = []) {
  const result = await client.query(sql, values);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

test('unified product creation and editing are atomic and preserve inventory history',
  { skip: !connectionString }, async () => {
    const database = new URL(connectionString).pathname.slice(1);
    assert.match(database, /^capytech_product_workflow_test_[a-z0-9_]+$/);
    const bootstrap = new Client({ connectionString, application_name: 'capytech_product_workflow_bootstrap' });
    await bootstrap.connect();
    try {
      const identity = await one(bootstrap, `SELECT current_database() AS database,current_setting('server_version_num')::integer AS version`);
      assert.equal(identity.database, database);
      assert.ok(identity.version >= 170000 && identity.version < 190000);
      const empty = await one(bootstrap, `SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_tables WHERE schemaname='public'`);
      assert.equal(empty.count, 0);
      await bootstrap.query('BEGIN');
      for (const sql of [BASELINE_SQL, P04, P06, P08, P10, P2B, P3A, P3D, FIX01, CP]) await bootstrap.query(sql);
      await bootstrap.query('COMMIT');
    } finally { await bootstrap.end(); }

    const pool = new Pool({ connectionString, max: 4, application_name: 'capytech_product_workflow_test' });
    try {
      const admin = await one(pool, `INSERT INTO users(name,username,password_hash,role) VALUES('Admin','workflow-admin','x','admin') RETURNING id`);
      const category = await one(pool, `INSERT INTO categories(name) VALUES('Workflow') RETURNING id`);
      const normal = await withTransaction(pool, (transaction) => createProductWorkflow(transaction, {
        actorUserId: admin.id,
        workflow: { name: 'Cable', sku: 'WF-CABLE', category_id: category.id, price: 20, cost: 10,
          opening_quantity: 5, serial_tracking_enabled: false, serial_numbers: [], variants: [] },
      }));
      assert.equal(Number(normal.product.stock_quantity), 0);
      assert.equal(Number((await one(pool, `SELECT stock_quantity FROM products WHERE id=$1`, [normal.product.id])).stock_quantity), 5);
      const movement = await one(pool, `SELECT movement_type,quantity_before,quantity_after FROM inventory_movements WHERE product_id=$1`, [normal.product.id]);
      assert.deepEqual([movement.movement_type, movement.quantity_before, movement.quantity_after], ['opening', 0, 5]);

      const serialized = await withTransaction(pool, (transaction) => createProductWorkflow(transaction, {
        actorUserId: admin.id,
        workflow: { name: 'Phone', sku: 'WF-PHONE', category_id: category.id, price: 500, cost: 400,
          opening_quantity: 0, serial_tracking_enabled: true, serial_numbers: [], variants: [{
            name: 'Blue', sku: 'WF-PHONE-B', price: 525, cost: 410, opening_quantity: 2,
            serial_tracking_enabled: 'inherit', serial_numbers: [' 00-A-1 ', '00-A-2'],
          }] },
      }));
      const originalVariantId = Number(serialized.variants[0].id);
      const savedVariant = await one(pool, `SELECT price,cost,stock_quantity FROM product_variants WHERE id=$1`, [originalVariantId]);
      assert.deepEqual([Number(savedVariant.price), Number(savedVariant.cost), Number(savedVariant.stock_quantity)], [525, 410, 2]);
      assert.equal(Number((await one(pool, `SELECT COUNT(*) AS count FROM stock_units WHERE variant_id=$1 AND state='available'`, [originalVariantId])).count), 2);

      await assert.rejects(withTransaction(pool, (transaction) => createProductWorkflow(transaction, {
        actorUserId: admin.id,
        workflow: { name: 'Bad', sku: 'WF-BAD', category_id: category.id, price: 1, cost: 0,
          serial_tracking_enabled: true, opening_quantity: 2, serial_numbers: ['DUP-1', 'DUP1'], variants: [] },
      })), /Duplicate normalized/);
      assert.equal(Number((await one(pool, `SELECT COUNT(*) AS count FROM products WHERE sku='WF-BAD'`)).count), 0);

      const edited = await withTransaction(pool, (transaction) => editProductWorkflow(transaction, {
        actorUserId: admin.id, productId: serialized.product.id,
        workflow: { name: 'Phone edited', sku: 'WF-PHONE', category_id: category.id, price: 505, cost: 400,
          serial_tracking_enabled: true, removed_variant_ids: [], variants: [{
            id: originalVariantId, name: 'Ocean Blue', sku: 'WF-PHONE-B', price: 530, cost: 412,
            serial_tracking_enabled: 'inherit',
          }, { name: 'White', sku: 'WF-PHONE-W', price: 540, cost: 415, serial_tracking_enabled: 'inherit' }] },
      }));
      assert.equal(Number(edited.variants[0].id), originalVariantId);
      assert.equal(Number((await one(pool, `SELECT stock_quantity FROM product_variants WHERE id=$1`, [originalVariantId])).stock_quantity), 2);
      assert.equal(Number(edited.variants[1].stock_quantity), 0);

      const sale = await one(pool, `INSERT INTO sales(invoice_number,user_id,subtotal,total) VALUES('WF-INV-1',$1,530,530) RETURNING id`, [admin.id]);
      await pool.query(`INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,line_total,variant_id,variant_name,variant_sku,unit_cost) VALUES($1,$2,'Phone',1,530,530,$3,'Ocean Blue','WF-PHONE-B',412)`, [sale.id, serialized.product.id, originalVariantId]);
      await assert.rejects(withTransaction(pool, (transaction) => editProductWorkflow(transaction, {
        actorUserId: admin.id, productId: serialized.product.id,
        workflow: { name: 'Must roll back', sku: 'WF-PHONE', category_id: category.id, price: 505, cost: 400,
          serial_tracking_enabled: true, removed_variant_ids: [originalVariantId], variants: edited.variants.slice(1).map((variant) => ({
            id: Number(variant.id), name: variant.name, sku: variant.sku, price: Number(variant.price), cost: Number(variant.cost),
            serial_tracking_enabled: variant.serial_tracking_enabled,
          })) },
      })), /cannot be removed/);
      assert.equal((await one(pool, `SELECT name FROM products WHERE id=$1`, [serialized.product.id])).name, 'Phone edited');
      const historical = await one(pool, `SELECT unit_price,variant_id,variant_sku FROM sale_items WHERE sale_id=$1`, [sale.id]);
      assert.deepEqual([Number(historical.unit_price), Number(historical.variant_id), historical.variant_sku], [530, originalVariantId, 'WF-PHONE-B']);
    } finally { await pool.end(); }
  });
