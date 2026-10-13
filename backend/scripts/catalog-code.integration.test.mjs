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
import { UP_SQL as CT } from '../migrations/1792022400000_fix01-stock-unit-barcode-codes.mjs';
import { UP_SQL as CP } from '../migrations/1792108800000_cp-catalog-codes.mjs';

const connectionString = process.env.CAPYTECH_CP_TEST_DATABASE_URL;
const { Client } = pg;

test('CP migration preserves legacy identities and creates permanent global codes',
  { skip: !connectionString }, async () => {
    const url = new URL(connectionString);
    const database = url.pathname.slice(1);
    assert.match(database, /^capytech_cp_test_[a-z0-9_]+$/);
    assert.notEqual(database, 'pos_store');
    assert.notEqual(database, 'capytech_manual_20261013_a1');
    assert.notEqual(Number(url.port || 5432), 5432);
    const client = new Client({ connectionString, application_name: 'capytech_cp_integration' });
    await client.connect();
    try {
      const identity = (await client.query(`SELECT current_database() database,current_setting('server_version_num')::integer version`)).rows[0];
      assert.equal(identity.database, database);
      assert.ok(identity.version >= 180000 && identity.version < 190000);
      const existing = await client.query(`SELECT COUNT(*)::integer count FROM pg_catalog.pg_tables WHERE schemaname='public'`);
      assert.equal(existing.rows[0].count, 0, 'disposable database must be empty');
      await client.query('BEGIN');
      for (const sql of [BASELINE_SQL, P04, P06, P08, P10, P2B, P3A, P3D, CT]) await client.query(sql);
      const product = (await client.query(`INSERT INTO products(sku,name,price,cost,stock_quantity) VALUES('LEGACY-P','Legacy',10,5,2) RETURNING id,sku`)).rows[0];
      const variant = (await client.query(`INSERT INTO product_variants(product_id,name,sku,price,cost,stock_quantity) VALUES($1,'Blue','LEGACY-V',11,6,1) RETURNING id,sku`, [product.id])).rows[0];
      const unit = (await client.query(`INSERT INTO stock_units(product_id,variant_id,manufacturer_serial_number) VALUES($1,$2,'SER-0001') RETURNING internal_sku,unit_code`, [product.id, variant.id])).rows[0];
      await client.query('SAVEPOINT cp_collision');
      await client.query(`INSERT INTO products(sku,name,price,cost) VALUES('CP123456','Collision',1,1)`);
      await assert.rejects(client.query(CP), /CP catalog-code namespace collision/);
      await client.query('ROLLBACK TO SAVEPOINT cp_collision');
      await client.query('RELEASE SAVEPOINT cp_collision');
      await client.query(CP);
      const afterProduct = (await client.query(`SELECT sku,product_code FROM products WHERE id=$1`, [product.id])).rows[0];
      const afterVariant = (await client.query(`SELECT sku,product_code FROM product_variants WHERE id=$1`, [variant.id])).rows[0];
      assert.equal(afterProduct.sku, 'LEGACY-P');
      assert.equal(afterVariant.sku, 'LEGACY-V');
      assert.match(afterProduct.product_code, /^CP\d{6,}$/);
      assert.match(afterVariant.product_code, /^CP\d{6,}$/);
      assert.notEqual(afterProduct.product_code, afterVariant.product_code);
      const preservedUnit = (await client.query(`SELECT internal_sku,unit_code,manufacturer_serial_number FROM stock_units WHERE product_id=$1`, [product.id])).rows[0];
      assert.equal(preservedUnit.internal_sku, unit.internal_sku);
      assert.equal(preservedUnit.unit_code, unit.unit_code);
      assert.equal(preservedUnit.manufacturer_serial_number, 'SER-0001');
      await assert.rejects(client.query(`UPDATE products SET product_code='CP999999' WHERE id=$1`, [product.id]), /immutable/);
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });
