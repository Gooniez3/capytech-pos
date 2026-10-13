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

const require = createRequire(import.meta.url);
const { withTransaction } = require('../src/services/domain-transaction');
const { restockProduct } = require('../src/services/product-restock-service');
const { Client, Pool } = pg;
const connectionString = process.env.CAPYTECH_PRODUCT_RESTOCK_TEST_DATABASE_URL;
const key = (digit) => `${digit}23e4567-e89b-42d3-a456-42661417400${digit}`;

async function one(client, sql, values = []) {
  const result = await client.query(sql, values);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}
function receive(pool, actorUserId, productId, body) {
  return withTransaction(pool, (transaction) => restockProduct(transaction, { actorUserId, productId, body }));
}

test('product restocking is atomic, serialized-aware, concurrent, and idempotent',
  { skip: !connectionString }, async () => {
    const database = new URL(connectionString).pathname.slice(1);
    assert.match(database, /^capytech_product_restock_test_[a-z0-9_]+$/);
    const bootstrap = new Client({ connectionString, application_name: 'capytech_restock_bootstrap' });
    await bootstrap.connect();
    try {
      const identity = await one(bootstrap, `SELECT current_database() AS database,current_setting('server_version_num')::integer AS version`);
      assert.equal(identity.database, database);
      assert.ok(identity.version >= 170000 && identity.version < 190000);
      assert.equal((await one(bootstrap, `SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_tables WHERE schemaname='public'`)).count, 0);
      await bootstrap.query('BEGIN');
      for (const sql of [BASELINE_SQL, P04, P06, P08, P10, P2B, P3A, P3D]) await bootstrap.query(sql);
      await bootstrap.query('COMMIT');
    } finally { await bootstrap.end(); }

    const pool = new Pool({ connectionString, max: 8, application_name: 'capytech_product_restock_test' });
    try {
      const admin = await one(pool, `INSERT INTO users(name,username,password_hash,role) VALUES('Admin','restock-admin','x','admin') RETURNING id`);
      const category = await one(pool, `INSERT INTO categories(name) VALUES('Restock') RETURNING id`);
      const normal = await one(pool, `INSERT INTO products(sku,name,category_id,price,cost,stock_quantity) VALUES('RS-N','Normal',$1,10,5,4) RETURNING id`, [category.id]);
      const parent = await one(pool, `INSERT INTO products(sku,name,category_id,price,cost,stock_quantity) VALUES('RS-V','Variants',$1,10,5,0) RETURNING id`, [category.id]);
      const variant = await one(pool, `INSERT INTO product_variants(product_id,name,sku,price,cost,stock_quantity) VALUES($1,'Blue','RS-V-B',12,6,2) RETURNING id`, [parent.id]);
      const other = await one(pool, `INSERT INTO products(sku,name,category_id,price,cost,stock_quantity) VALUES('RS-O','Other',$1,10,5,0) RETURNING id`, [category.id]);
      const wrongVariant = await one(pool, `INSERT INTO product_variants(product_id,name,sku,price,cost,stock_quantity) VALUES($1,'Wrong','RS-O-W',12,6,0) RETURNING id`, [other.id]);
      const serialized = await one(pool, `INSERT INTO products(sku,name,category_id,price,cost,stock_quantity,serial_tracking_enabled,shop_warranty_enabled,shop_warranty_months) VALUES('RS-S','Serialized',$1,100,70,0,TRUE,TRUE,12) RETURNING id`, [category.id]);

      const first = await receive(pool, admin.id, normal.id, { idempotency_key: key(1), quantity: 3, reason: 'PO-1' });
      assert.equal(first.replayed, false);
      assert.deepEqual([first.receipt.quantity_before, first.receipt.quantity_after], [4, 7]);
      assert.equal((await one(pool, `SELECT movement_type,source_reference FROM inventory_movements WHERE product_id=$1`, [normal.id])).movement_type, 'received');

      const variantResult = await receive(pool, admin.id, parent.id, { idempotency_key: key(2), variant_id: variant.id, quantity: 2 });
      assert.deepEqual([variantResult.receipt.quantity_before, variantResult.receipt.quantity_after], [2, 4]);
      await assert.rejects(receive(pool, admin.id, parent.id, { idempotency_key: key(3), variant_id: wrongVariant.id, quantity: 1 }), /does not belong/);

      const serialResult = await receive(pool, admin.id, serialized.id, { idempotency_key: key(4), serial_numbers: [' 00-S-1 ', '00-S-2'] });
      assert.equal(serialResult.receipt.tracking_mode, 'serialized');
      assert.equal(serialResult.receipt.quantity_received, 2);
      assert.equal(Number((await one(pool, `SELECT COUNT(*) AS count FROM stock_units WHERE product_id=$1 AND state='available'`, [serialized.id])).count), 2);
      assert.deepEqual(await one(pool, `SELECT shop_warranty_enabled,shop_warranty_months FROM products WHERE id=$1`, [serialized.id]), { shop_warranty_enabled: true, shop_warranty_months: 12 });

      const replay = await receive(pool, admin.id, normal.id, { idempotency_key: key(1), quantity: 3, reason: 'PO-1' });
      assert.equal(replay.replayed, true);
      assert.equal(Number((await one(pool, `SELECT stock_quantity FROM products WHERE id=$1`, [normal.id])).stock_quantity), 7);
      await assert.rejects(receive(pool, admin.id, normal.id, { idempotency_key: key(1), quantity: 4, reason: 'PO-1' }), /different restock/);

      const sameKey = key(5);
      const simultaneous = await Promise.all([
        receive(pool, admin.id, normal.id, { idempotency_key: sameKey, quantity: 1 }),
        receive(pool, admin.id, normal.id, { idempotency_key: sameKey, quantity: 1 }),
      ]);
      assert.equal(simultaneous.filter((entry) => entry.replayed).length, 1);

      await Promise.all([6, 7, 8].map((digit) =>
        receive(pool, admin.id, normal.id, { idempotency_key: key(digit), quantity: 1 })));
      assert.equal(Number((await one(pool, `SELECT stock_quantity FROM products WHERE id=$1`, [normal.id])).stock_quantity), 11);

      const beforeFailed = Number((await one(pool, `SELECT stock_quantity FROM products WHERE id=$1`, [serialized.id])).stock_quantity);
      await assert.rejects(receive(pool, admin.id, serialized.id, {
        idempotency_key: '923e4567-e89b-42d3-a456-426614174009', serial_numbers: ['NEW-S-3', '00-S-1'],
      }), /already exists/);
      assert.equal(Number((await one(pool, `SELECT stock_quantity FROM products WHERE id=$1`, [serialized.id])).stock_quantity), beforeFailed);
      assert.equal(Number((await one(pool, `SELECT COUNT(*) AS count FROM stock_units WHERE normalized_serial_number='NEWS3'`)).count), 0);
      assert.equal(Number((await one(pool, `SELECT COUNT(*) AS count FROM inventory_receipts`)).count), 7);
    } finally { await pool.end(); }
  });
