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

const require = createRequire(import.meta.url);
const { withTransaction } = require('../src/services/domain-transaction');
const {
  applyQuantityMovements,
  receiveQuantityInventory,
} = require('../src/services/quantity-inventory-service');
const { Client, Pool } = pg;
const connectionString = process.env.CAPYTECH_PHASE3A_TEST_DATABASE_URL;

async function one(client, sql, params = []) {
  const result = await client.query(sql, params);
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

test('Phase 3A quantity inventory is atomic, locked, auditable, and rejects serialized targets',
  { skip: !connectionString }, async () => {
    const configuredName = new URL(connectionString).pathname.slice(1);
    assert.match(configuredName, /^capytech_phase3a_test_[a-z0-9_]+$/);
    const bootstrap = new Client({ connectionString, application_name: 'capytech_phase3a_bootstrap' });
    await bootstrap.connect();
    try {
      const identity = await bootstrap.query(`
        SELECT current_database() AS database, inet_server_addr()::text AS host,
               inet_server_port() AS port, current_setting('server_version_num')::integer AS version
      `);
      assert.equal(identity.rows[0].database, configuredName);
      assert.ok(identity.rows[0].version >= 170000 && identity.rows[0].version < 190000);
      const initial = await bootstrap.query(`SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_tables WHERE schemaname='public'`);
      assert.equal(initial.rows[0].count, 0, 'Disposable database must start empty');
      await bootstrap.query('BEGIN');
      for (const sql of [BASELINE_SQL, P04, P06, P08, P10, P2B, P3A]) await bootstrap.query(sql);
      await bootstrap.query('COMMIT');
    } finally { await bootstrap.end(); }

    const pool = new Pool({ connectionString, max: 6, application_name: 'capytech_phase3a_test' });
    try {
      const user = await one(pool, `INSERT INTO users(name,username,password_hash,role) VALUES('P3A','p3a','x','admin') RETURNING id`);
      const category = await one(pool, `INSERT INTO categories(name) VALUES('P3A') RETURNING id`);
      const normal = await one(pool, `INSERT INTO products(sku,name,category_id,price,cost,stock_quantity) VALUES('P3A-N','Normal',$1,10,5,5) RETURNING id`, [category.id]);
      const second = await one(pool, `INSERT INTO products(sku,name,category_id,price,cost,stock_quantity) VALUES('P3A-R','Rollback',$1,10,5,2) RETURNING id`, [category.id]);
      const tracked = await one(pool, `INSERT INTO products(sku,name,category_id,price,cost,stock_quantity,serial_tracking_enabled) VALUES('P3A-S','Serialized',$1,10,5,0,TRUE) RETURNING id`, [category.id]);
      const variantParent = await one(pool, `INSERT INTO products(sku,name,category_id,price,cost,stock_quantity) VALUES('P3A-V','Variant parent',$1,10,5,0) RETURNING id`, [category.id]);
      const variant = await one(pool, `INSERT INTO product_variants(product_id,name,sku,price,stock_quantity) VALUES($1,'Blue','P3A-V-B',12,4) RETURNING id`, [variantParent.id]);

      const received = await withTransaction(pool, (tx) => receiveQuantityInventory(tx, {
        actorUserId: user.id,
        movements: [{ productId: normal.id, quantity: 3, reason: 'delivery', sourceReference: 'PO-1' }],
      }));
      assert.equal(received[0].quantity_before, 5);
      assert.equal(received[0].quantity_after, 8);

      const variantReceived = await withTransaction(pool, (tx) => receiveQuantityInventory(tx, {
        actorUserId: user.id,
        movements: [{ productId: variantParent.id, variantId: variant.id, quantity: 2 }],
      }));
      assert.equal(Number(variantReceived[0].variant_id), variant.id);
      assert.equal(Number((await one(pool, `SELECT stock_quantity FROM product_variants WHERE id=$1`, [variant.id])).stock_quantity), 6);
      assert.equal(Number((await one(pool, `SELECT stock_quantity FROM products WHERE id=$1`, [variantParent.id])).stock_quantity), 0);

      await assert.rejects(withTransaction(pool, (tx) => applyQuantityMovements(tx, {
        actorUserId: user.id,
        movements: [
          { productId: normal.id, movementType: 'adjusted', quantityChange: 2 },
          { productId: second.id, movementType: 'adjusted', quantityChange: -99 },
        ],
      })), /Insufficient inventory/);
      assert.equal(Number((await one(pool, `SELECT stock_quantity FROM products WHERE id=$1`, [normal.id])).stock_quantity), 8);
      assert.equal(Number((await one(pool, `SELECT COUNT(*) AS count FROM inventory_movements WHERE product_id=$1`, [normal.id])).count), 1);

      await assert.rejects(withTransaction(pool, (tx) => receiveQuantityInventory(tx, {
        movements: [{ productId: tracked.id, quantity: 1 }],
      })), /disabled for serialized inventory/);

      await Promise.all([1, 2, 3, 4].map((number) => withTransaction(pool, (tx) =>
        receiveQuantityInventory(tx, {
          actorUserId: user.id,
          movements: [{ productId: normal.id, quantity: 1, sourceReference: `CONCURRENT-${number}` }],
        })
      )));
      assert.equal(Number((await one(pool, `SELECT stock_quantity FROM products WHERE id=$1`, [normal.id])).stock_quantity), 12);
      const chain = await pool.query(`SELECT quantity_before,quantity_after FROM inventory_movements WHERE product_id=$1 ORDER BY id`, [normal.id]);
      assert.deepEqual(chain.rows.map((row) => [Number(row.quantity_before), Number(row.quantity_after)]), [
        [5, 8], [8, 9], [9, 10], [10, 11], [11, 12],
      ]);
      await assert.rejects(pool.query(`UPDATE inventory_movements SET reason='tampered' WHERE product_id=$1`, [normal.id]), /immutable/);
    } finally { await pool.end(); }
  });
