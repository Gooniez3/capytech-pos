import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('../../backend/node_modules/pg');
const bcrypt = require('../../backend/node_modules/bcrypt');

const database = 'capytech_e2e_2g1_20261013d_1d4560e';

export default async function globalSetup() {
  if (database === 'pos_store' || !database.startsWith('capytech_e2e_2g1_')) {
    throw new Error(`Refusing unsafe E2E database: ${database}`);
  }

  const client = new Client({
    host: '127.0.0.1',
    port: 55439,
    database,
    user: 'capytech_e2e_admin',
    password: 'e2e-only-unused',
  });
  await client.connect();

  try {
    const identity = await client.query(
      'SELECT current_database() AS database, inet_server_addr()::text AS host, inet_server_port() AS port'
    );
    const current = identity.rows[0];
    const serverAddress = String(current.host).split('/')[0];
    if (current.database !== database || serverAddress !== '127.0.0.1' || Number(current.port) !== 55439) {
      throw new Error(`Disposable database identity mismatch: ${JSON.stringify(current)}`);
    }

    const schema = await client.query(`
      SELECT COUNT(*)::integer AS count
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename <> 'pgmigrations'
    `);
    if (schema.rows[0].count === 0) throw new Error('E2E schema is missing');

    const existing = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM sales) AS sales,
        (SELECT COUNT(*) FROM stock_units) AS stock_units
    `);
    if (Object.values(existing.rows[0]).some((count) => Number(count) !== 0)) {
      throw new Error(`Refusing to reuse populated E2E database: ${JSON.stringify(existing.rows[0])}`);
    }

    await client.query('BEGIN');

    const hash = await bcrypt.hash('E2eOnly!2026', 10);
    await client.query(`
      INSERT INTO users (name, username, password_hash, role) VALUES
        ('E2E Admin', 'e2e_admin', $1, 'admin'),
        ('E2E Staff', 'e2e_staff', $1, 'cashier')
    `, [hash]);
    const category = await client.query(
      `INSERT INTO categories (name) VALUES ('E2E Hardware') RETURNING id`
    );
    const categoryId = category.rows[0].id;
    await client.query(`
      INSERT INTO products
        (sku, name, category_id, price, cost, stock_quantity, low_stock_threshold,
         is_active, serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months)
      VALUES
        ('E2E-SERIAL', 'E2E Serialized Device', $1, 150000, 100000, 2, 1, TRUE, FALSE, FALSE, NULL),
        ('E2E-WARRANTY', 'E2E Warranty Device', $1, 80000, 50000, 5, 1, TRUE, FALSE, FALSE, NULL),
        ('E2E-NORMAL', 'E2E Normal Item', $1, 20000, 10000, 5, 1, TRUE, FALSE, FALSE, NULL),
        ('E2E-VARIANT', 'E2E Variant Device', $1, 60000, 40000, 0, 1, TRUE, FALSE, TRUE, 3)
    `, [categoryId]);
    const parent = await client.query(`SELECT id FROM products WHERE sku = 'E2E-VARIANT'`);
    await client.query(`
      INSERT INTO product_variants
        (product_id, name, sku, price, cost, stock_quantity, low_stock_threshold,
         is_active, serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months)
      VALUES
        ($1, 'Red', 'E2E-VAR-RED', 65000, 42000, 1, 1, TRUE, NULL, NULL, NULL),
        ($1, 'Blue', 'E2E-VAR-BLUE', 70000, 45000, 1, 1, TRUE, FALSE, FALSE, NULL)
    `, [parent.rows[0].id]);
    await client.query(`
      INSERT INTO store_settings (store_name, phone, email, address, currency, tax_rate)
      VALUES ('CapyTech E2E Shop', '000000000', 'e2e@example.invalid',
              'Disposable test environment', 'MMK', 0)
    `);
    await client.query('COMMIT');
    console.log(`Verified disposable E2E database ${database} at 127.0.0.1:55439`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
