import test from 'node:test';
import assert from 'node:assert/strict';
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

const { Client } = pg;
const connectionString = process.env.CAPYTECH_UNIT_BARCODE_TEST_DATABASE_URL;

async function one(client, sql, values = []) {
  const result = await client.query(sql, values);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

test('FIX-01 backfills and permanently reserves unique CT unit codes',
  { skip: !connectionString }, async () => {
    const database = new URL(connectionString).pathname.slice(1);
    assert.match(database, /^capytech_unit_barcode_test_[a-z0-9_]+$/);
    const client = new Client({ connectionString, application_name: 'capytech_fix01_integration' });
    await client.connect();
    try {
      const identity = await one(client, `SELECT current_database() AS database,current_setting('server_version_num')::integer AS version`);
      assert.equal(identity.database, database);
      assert.ok(identity.version >= 170000 && identity.version < 190000);
      assert.equal((await one(client, `SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_tables WHERE schemaname='public'`)).count, 0);
      await client.query('BEGIN');
      for (const sql of [BASELINE_SQL, P04, P06, P08, P10, P2B, P3A, P3D]) await client.query(sql);
      const category = await one(client, `INSERT INTO categories(name) VALUES('FIX-01') RETURNING id`);
      const product = await one(client, `INSERT INTO products(sku,name,category_id,price,cost,stock_quantity,serial_tracking_enabled) VALUES('FIX-P','Phone',$1,100,80,1,TRUE) RETURNING id`, [category.id]);
      const existing = await one(client, `INSERT INTO stock_units(manufacturer_serial_number,product_id,state) VALUES('SER-001',$1,'sold') RETURNING id,internal_sku,manufacturer_serial_number,state`, [product.id]);
      await client.query('COMMIT');

      const collision = await one(client, `INSERT INTO products(sku,name,category_id,price,cost) VALUES('CT123456','Collision',$1,1,1) RETURNING id`, [category.id]);
      await client.query('BEGIN');
      await assert.rejects(client.query(FIX01), /CT stock-unit barcode namespace collision/);
      await client.query('ROLLBACK');
      assert.equal((await one(client, `SELECT to_regclass('public.stock_unit_code_seq') AS relation`)).relation, null);
      assert.equal((await one(client, `SELECT COUNT(*)::integer AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_units' AND column_name='unit_code'`)).count, 0);
      await client.query(`DELETE FROM products WHERE id=$1`, [collision.id]);

      await client.query('BEGIN');
      await client.query(FIX01);
      await client.query('COMMIT');

      const backfilled = await one(client, `SELECT id,internal_sku,unit_code,manufacturer_serial_number,state FROM stock_units WHERE id=$1`, [existing.id]);
      assert.equal(backfilled.internal_sku, existing.internal_sku);
      assert.equal(backfilled.manufacturer_serial_number, existing.manufacturer_serial_number);
      assert.equal(backfilled.state, 'sold');
      assert.match(backfilled.unit_code, /^CT\d{6,}$/);
      const created = await one(client, `INSERT INTO stock_units(manufacturer_serial_number,product_id) VALUES('SER-002',$1) RETURNING unit_code`, [product.id]);
      assert.match(created.unit_code, /^CT\d{6,}$/);
      assert.notEqual(created.unit_code, backfilled.unit_code);
      await assert.rejects(client.query(`UPDATE stock_units SET unit_code='CT999999' WHERE id=$1`, [existing.id]), /immutable/);
      await assert.rejects(client.query(`INSERT INTO products(sku,name,category_id,price,cost) VALUES('CT123456','Collision',$1,1,1)`, [category.id]), /products_sku_ct_namespace_chk/);
    } finally {
      await client.end();
    }
  });
