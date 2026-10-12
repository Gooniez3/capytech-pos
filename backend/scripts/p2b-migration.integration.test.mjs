import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { BASELINE_SQL } from '../migrations/1788652800000_baseline.mjs';
import { UP_SQL as P04_UP_SQL } from '../migrations/1788652800001_p04-database-constraints.mjs';
import { UP_SQL as P06_UP_SQL } from '../migrations/1788652800002_p06-checkout-request-fingerprint.mjs';
import { UP_SQL as P08_UP_SQL } from '../migrations/1788652800003_p08-product-recycle-bin.mjs';
import { UP_SQL as P10_UP_SQL } from '../migrations/1791676800000_p10-invoice-warranty.mjs';
import { UP_SQL as P2B_UP_SQL } from '../migrations/1791763200000_p2b-stock-unit-warranty-schema.mjs';
import {
  ADDITIVE_PROTECTED_SEQUENCES,
  ADDITIVE_PROTECTED_TABLE_COLUMNS,
  assertPhase2BMigrationInitialState,
  captureProductionDataManifest,
} from '../../scripts/lib/production-data.mjs';

const { Client } = pg;
const connectionString = process.env.CAPYTECH_PHASE2B_TEST_DATABASE_URL;

async function expectDatabaseError(client, sql, params, expectedConstraint) {
  await client.query('SAVEPOINT expected_failure');
  try {
    await client.query(sql, params);
    assert.fail(`Expected database constraint ${expectedConstraint} to reject the statement.`);
  } catch (error) {
    if (expectedConstraint) {
      assert.equal(error.constraint, expectedConstraint);
    } else {
      assert.ok(error instanceof Error);
      assert.ok(error.message.length > 0);
    }
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    await client.query('RELEASE SAVEPOINT expected_failure');
  }
}

test(
  'Phase 2B applies atomically and enforces stock-unit integrity in a disposable database',
  { skip: !connectionString },
  async () => {
    const configuredName = new URL(connectionString).pathname.slice(1);
    assert.match(configuredName, /^capytech_phase2b_test_[a-z0-9_]+$/);

    const client = new Client({
      connectionString,
      application_name: 'capytech_phase2b_integration_test',
      options: '-c statement_timeout=60000',
    });
    await client.connect();
    try {
      const identity = await client.query(`
        SELECT current_database() AS database,
               current_setting('server_version_num')::integer AS server_version
      `);
      assert.equal(identity.rows[0].database, configuredName);
      assert.ok(identity.rows[0].server_version >= 170000);
      assert.ok(identity.rows[0].server_version < 190000);

      const initialTables = await client.query(`
        SELECT COUNT(*)::integer AS count
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
      `);
      assert.equal(initialTables.rows[0].count, 0, 'Disposable database must start empty.');

      await client.query('BEGIN');
      await client.query(BASELINE_SQL);
      await client.query(P04_UP_SQL);
      await client.query(P06_UP_SQL);
      await client.query(P08_UP_SQL);
      await client.query(P10_UP_SQL);
      await client.query('COMMIT');

      const user = await client.query(`
        INSERT INTO public.users (name, username, password_hash, role)
        VALUES ('Phase 2B Admin', 'phase2b-admin', 'not-a-real-password-hash', 'admin')
        RETURNING id
      `);
      const category = await client.query(`
        INSERT INTO public.categories (name) VALUES ('Phase 2B Test') RETURNING id
      `);
      const product = await client.query(`
        INSERT INTO public.products
          (sku, name, category_id, price, cost, stock_quantity, low_stock_threshold)
        VALUES ('LEGACY-PRODUCT', 'Legacy Product', $1, 125000, 90000, 2, 1)
        RETURNING id
      `, [category.rows[0].id]);
      const variant = await client.query(`
        INSERT INTO public.product_variants
          (product_id, name, sku, price, cost, stock_quantity, low_stock_threshold)
        VALUES ($1, 'Blue', 'LEGACY-VARIANT', 130000, 92000, 2, 1)
        RETURNING id
      `, [product.rows[0].id]);
      const saleWithWarranty = await client.query(`
        INSERT INTO public.sales
          (invoice_number, user_id, subtotal, tax, discount, total, payment_method, status, warranty_months)
        VALUES ('INV-P2B-1', $1, 130000, 0, 0, 130000, 'cash', 'completed', 12)
        RETURNING id
      `, [user.rows[0].id]);
      const legacySale = await client.query(`
        INSERT INTO public.sales
          (invoice_number, user_id, subtotal, tax, discount, total, payment_method, status, warranty_months)
        VALUES ('INV-P2B-2', $1, 130000, 0, 0, 130000, 'cash', 'completed', NULL)
        RETURNING id
      `, [user.rows[0].id]);
      const firstItem = await client.query(`
        INSERT INTO public.sale_items
          (sale_id, product_id, product_name, quantity, unit_price, line_total,
           variant_id, variant_name, variant_sku, unit_cost)
        VALUES ($1, $2, 'Legacy Product', 1, 130000, 130000,
                $3, 'Blue', 'LEGACY-VARIANT', 92000)
        RETURNING id
      `, [saleWithWarranty.rows[0].id, product.rows[0].id, variant.rows[0].id]);
      const secondItem = await client.query(`
        INSERT INTO public.sale_items
          (sale_id, product_id, product_name, quantity, unit_price, line_total,
           variant_id, variant_name, variant_sku, unit_cost)
        VALUES ($1, $2, 'Legacy Product', 1, 130000, 130000,
                $3, 'Blue', 'LEGACY-VARIANT', 92000)
        RETURNING id
      `, [legacySale.rows[0].id, product.rows[0].id, variant.rows[0].id]);

      await client.query(`
        INSERT INTO public.products
          (sku, name, category_id, price, cost, stock_quantity)
        VALUES ('su-existing-collision', 'Reserved Collision', $1, 1, 1, 0)
      `, [category.rows[0].id]);
      await client.query('BEGIN');
      await assert.rejects(client.query(P2B_UP_SQL), (error) =>
        error.constraint === 'products_sku_reserved_namespace_chk'
      );
      await client.query('ROLLBACK');
      const rolledBackColumn = await client.query(`
        SELECT COUNT(*)::integer AS count
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'products'
          AND column_name = 'serial_tracking_enabled'
      `);
      assert.equal(rolledBackColumn.rows[0].count, 0);
      assert.equal((await client.query(`SELECT to_regclass('public.stock_units') AS relation`)).rows[0].relation, null);
      assert.equal((await client.query(`SELECT COUNT(*)::integer AS count FROM public.products WHERE sku = 'su-existing-collision'`)).rows[0].count, 1);
      await client.query(`DELETE FROM public.products WHERE sku = 'su-existing-collision'`);

      const protectedBefore = await client.query(`
        SELECT jsonb_build_object(
          'product', (SELECT jsonb_build_array(sku, price, stock_quantity) FROM public.products WHERE id = $1),
          'variant', (SELECT jsonb_build_array(sku, price, stock_quantity) FROM public.product_variants WHERE id = $2),
          'sales', (SELECT jsonb_agg(jsonb_build_array(invoice_number, total, warranty_months) ORDER BY id) FROM public.sales),
          'items', (SELECT jsonb_agg(jsonb_build_array(product_name, quantity, unit_price, variant_sku) ORDER BY id) FROM public.sale_items)
        ) AS snapshot
      `, [product.rows[0].id, variant.rows[0].id]);
      const sequencesBefore = await client.query(`
        SELECT 'invoice_number_seq' AS name, last_value::text, is_called FROM public.invoice_number_seq
        UNION ALL SELECT 'products_id_seq', last_value::text, is_called FROM public.products_id_seq
        UNION ALL SELECT 'product_variants_id_seq', last_value::text, is_called FROM public.product_variants_id_seq
        UNION ALL SELECT 'sales_id_seq', last_value::text, is_called FROM public.sales_id_seq
        UNION ALL SELECT 'sale_items_id_seq', last_value::text, is_called FROM public.sale_items_id_seq
        ORDER BY name
      `);

      await client.query('BEGIN');
      await client.query(P2B_UP_SQL);
      await client.query('COMMIT');

      await assertPhase2BMigrationInitialState(client);
      const protectedManifest = await captureProductionDataManifest(client);
      for (const table of Object.keys(ADDITIVE_PROTECTED_TABLE_COLUMNS)) {
        assert.deepEqual(protectedManifest.tables[table], {
          count: '0',
          digest: 'd41d8cd98f00b204e9800998ecf8427e',
        });
      }
      for (const sequence of Object.values(ADDITIVE_PROTECTED_SEQUENCES).flat()) {
        assert.deepEqual(protectedManifest.sequences[sequence], {
          last_value: '1',
          is_called: false,
        });
      }
      assert.ok(protectedManifest.protectedShape.tables.sales.includes('warranty_months'));
      assert.ok(protectedManifest.protectedShape.tables.sales.includes('checkout_contract_version'));

      const protectedAfter = await client.query(`
        SELECT jsonb_build_object(
          'product', (SELECT jsonb_build_array(sku, price, stock_quantity) FROM public.products WHERE id = $1),
          'variant', (SELECT jsonb_build_array(sku, price, stock_quantity) FROM public.product_variants WHERE id = $2),
          'sales', (SELECT jsonb_agg(jsonb_build_array(invoice_number, total, warranty_months) ORDER BY id) FROM public.sales),
          'items', (SELECT jsonb_agg(jsonb_build_array(product_name, quantity, unit_price, variant_sku) ORDER BY id) FROM public.sale_items)
        ) AS snapshot
      `, [product.rows[0].id, variant.rows[0].id]);
      const sequencesAfter = await client.query(`
        SELECT 'invoice_number_seq' AS name, last_value::text, is_called FROM public.invoice_number_seq
        UNION ALL SELECT 'products_id_seq', last_value::text, is_called FROM public.products_id_seq
        UNION ALL SELECT 'product_variants_id_seq', last_value::text, is_called FROM public.product_variants_id_seq
        UNION ALL SELECT 'sales_id_seq', last_value::text, is_called FROM public.sales_id_seq
        UNION ALL SELECT 'sale_items_id_seq', last_value::text, is_called FROM public.sale_items_id_seq
        ORDER BY name
      `);
      assert.deepEqual(protectedAfter.rows[0].snapshot, protectedBefore.rows[0].snapshot);
      assert.deepEqual(sequencesAfter.rows, sequencesBefore.rows);

      const legacyDefaults = await client.query(`
        SELECT p.serial_tracking_enabled AS product_serial,
               p.shop_warranty_enabled AS product_warranty,
               p.shop_warranty_months AS product_months,
               v.serial_tracking_enabled AS variant_serial,
               v.shop_warranty_enabled AS variant_warranty,
               v.shop_warranty_months AS variant_months,
               si.shop_warranty_eligible AS item_eligible,
               si.shop_warranty_months AS item_months,
               s.checkout_contract_version
        FROM public.products p
        JOIN public.product_variants v ON v.product_id = p.id
        JOIN public.sale_items si ON si.variant_id = v.id
        JOIN public.sales s ON s.id = si.sale_id
        WHERE p.id = $1
        ORDER BY si.id
        LIMIT 1
      `, [product.rows[0].id]);
      assert.deepEqual(legacyDefaults.rows[0], {
        product_serial: false,
        product_warranty: false,
        product_months: null,
        variant_serial: null,
        variant_warranty: null,
        variant_months: null,
        item_eligible: null,
        item_months: null,
        checkout_contract_version: null,
      });

      await client.query('BEGIN');
      await expectDatabaseError(
        client,
        `UPDATE public.products SET shop_warranty_enabled = TRUE, shop_warranty_months = 2 WHERE id = $1`,
        [product.rows[0].id],
        'products_shop_warranty_policy_chk'
      );
      await expectDatabaseError(
        client,
        `INSERT INTO public.products (sku, name, price, stock_quantity) VALUES ('SU-999', 'Reserved', 1, 0)`,
        [],
        'products_sku_reserved_namespace_chk'
      );

      const stockUnit = await client.query(`
        INSERT INTO public.stock_units
          (manufacturer_serial_number, product_id, variant_id)
        VALUES (' ab-12 ', $1, $2)
        RETURNING id, internal_sku, normalized_serial_number, state
      `, [product.rows[0].id, variant.rows[0].id]);
      assert.match(stockUnit.rows[0].internal_sku, /^SU-[0-9]+$/);
      assert.equal(stockUnit.rows[0].normalized_serial_number, 'AB12');
      assert.equal(stockUnit.rows[0].state, 'available');

      await expectDatabaseError(
        client,
        `INSERT INTO public.stock_units
           (manufacturer_serial_number, product_id, variant_id)
         VALUES ('A B_12', $1, $2)`,
        [product.rows[0].id, variant.rows[0].id],
        'stock_units_normalized_serial_number_key'
      );
      const otherProduct = await client.query(`
        INSERT INTO public.products (sku, name, price, stock_quantity)
        VALUES ('OTHER-PRODUCT', 'Other', 1, 0)
        RETURNING id
      `);
      await expectDatabaseError(
        client,
        `INSERT INTO public.stock_units
           (manufacturer_serial_number, product_id, variant_id)
         VALUES ('MISMATCH-1', $1, $2)`,
        [otherProduct.rows[0].id, variant.rows[0].id],
        'stock_units_product_variant_fkey'
      );
      await expectDatabaseError(
        client,
        `INSERT INTO public.stock_units
           (manufacturer_serial_number, product_id, state)
         VALUES ('INVALID-STATE', $1, 'returned')`,
        [product.rows[0].id],
        'stock_units_state_valid_chk'
      );

      await client.query(`
        INSERT INTO public.stock_unit_events
          (stock_unit_id, event_type, from_state, to_state, actor_user_id)
        VALUES ($1, 'received', NULL, 'available', $2)
      `, [stockUnit.rows[0].id, user.rows[0].id]);
      await expectDatabaseError(
        client,
        `UPDATE public.stock_unit_events SET reason = 'tampered' WHERE stock_unit_id = $1`,
        [stockUnit.rows[0].id],
        null
      );
      await expectDatabaseError(
        client,
        `DELETE FROM public.stock_unit_events WHERE stock_unit_id = $1`,
        [stockUnit.rows[0].id],
        null
      );
      await expectDatabaseError(client, `TRUNCATE public.stock_unit_events`, [], null);
      await expectDatabaseError(
        client,
        `UPDATE public.stock_units SET manufacturer_serial_number = 'changed' WHERE id = $1`,
        [stockUnit.rows[0].id],
        null
      );
      await expectDatabaseError(
        client,
        `DELETE FROM public.stock_units WHERE id = $1`,
        [stockUnit.rows[0].id],
        null
      );

      await client.query(`
        INSERT INTO public.sale_item_stock_units
          (sale_item_id, stock_unit_id, internal_sku_snapshot, manufacturer_serial_number_snapshot)
        VALUES ($1, $2, $3, ' ab-12 ')
      `, [firstItem.rows[0].id, stockUnit.rows[0].id, stockUnit.rows[0].internal_sku]);
      await expectDatabaseError(
        client,
        `INSERT INTO public.sale_item_stock_units
           (sale_item_id, stock_unit_id, internal_sku_snapshot, manufacturer_serial_number_snapshot)
         VALUES ($1, $2, $3, ' ab-12 ')`,
        [secondItem.rows[0].id, stockUnit.rows[0].id, stockUnit.rows[0].internal_sku],
        'sale_item_stock_units_one_active_unit_idx'
      );
      await expectDatabaseError(
        client,
        `UPDATE public.sale_item_stock_units
         SET internal_sku_snapshot = 'SU-TAMPERED'
         WHERE stock_unit_id = $1`,
        [stockUnit.rows[0].id],
        null
      );
      await expectDatabaseError(
        client,
        `DELETE FROM public.sale_item_stock_units WHERE stock_unit_id = $1`,
        [stockUnit.rows[0].id],
        null
      );
      await client.query(`
        UPDATE public.sale_item_stock_units
        SET released_at = now(), release_reason = 'refunded'
        WHERE stock_unit_id = $1
      `, [stockUnit.rows[0].id]);
      await client.query(`
        INSERT INTO public.sale_item_stock_units
          (sale_item_id, stock_unit_id, internal_sku_snapshot, manufacturer_serial_number_snapshot)
        VALUES ($1, $2, $3, ' ab-12 ')
      `, [secondItem.rows[0].id, stockUnit.rows[0].id, stockUnit.rows[0].internal_sku]);
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  }
);
