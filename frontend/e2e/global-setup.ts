import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('../../backend/node_modules/pg');
const bcrypt = require('../../backend/node_modules/bcrypt');

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must explicitly identify the disposable E2E environment`);
  return value;
}

const database = requiredEnvironment('CAPYTECH_E2E_DB_NAME');
const host = requiredEnvironment('CAPYTECH_E2E_DB_HOST');
const port = Number(requiredEnvironment('CAPYTECH_E2E_DB_PORT'));
const user = requiredEnvironment('CAPYTECH_E2E_DB_USER');
const password = requiredEnvironment('CAPYTECH_E2E_DB_PASSWORD');

export default async function globalSetup() {
  if (!/^capytech_e2e_[a-z0-9_]+$/.test(database) || database === 'pos_store') {
    throw new Error(`Refusing unsafe E2E database: ${database}`);
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`E2E database host must be loopback, received: ${host}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CAPYTECH_E2E_DB_PORT: ${process.env.CAPYTECH_E2E_DB_PORT}`);
  }

  const client = new Client({
    host,
    port,
    database,
    user,
    password,
  });
  await client.connect();

  try {
    const identity = await client.query(
      'SELECT current_database() AS database, inet_server_addr()::text AS host, inet_server_port() AS port'
    );
    const current = identity.rows[0];
    const serverAddress = String(current.host).split('/')[0];
    if (
      current.database !== database
      || !['127.0.0.1', '::1'].includes(serverAddress)
      || Number(current.port) !== port
    ) {
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
        (sku, product_code, name, category_id, price, cost, stock_quantity, low_stock_threshold,
         is_active, serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months)
      VALUES
        ('E2E-SERIAL', format_catalog_code(nextval('catalog_code_seq'::regclass)), 'E2E Serialized Device', $1, 150000, 100000, 2, 1, TRUE, FALSE, FALSE, NULL),
        ('E2E-WARRANTY', format_catalog_code(nextval('catalog_code_seq'::regclass)), 'E2E Warranty Device', $1, 80000, 50000, 5, 1, TRUE, FALSE, FALSE, NULL),
        ('E2E-NORMAL', format_catalog_code(nextval('catalog_code_seq'::regclass)), 'E2E Normal Item', $1, 20000, 10000, 5, 1, TRUE, FALSE, FALSE, NULL),
        ('E2E-VARIANT', format_catalog_code(nextval('catalog_code_seq'::regclass)), 'E2E Variant Device', $1, 60000, 40000, 0, 1, TRUE, FALSE, TRUE, 3)
    `, [categoryId]);
    const parent = await client.query(`SELECT id FROM products WHERE sku = 'E2E-VARIANT'`);
    await client.query(`
      INSERT INTO product_variants
        (product_id, name, sku, product_code, price, cost, stock_quantity, low_stock_threshold,
         is_active, serial_tracking_enabled, shop_warranty_enabled, shop_warranty_months)
      VALUES
        ($1, 'Red', 'E2E-VAR-RED', format_catalog_code(nextval('catalog_code_seq'::regclass)), 65000, 42000, 1, 1, TRUE, NULL, NULL, NULL),
        ($1, 'Blue', 'E2E-VAR-BLUE', format_catalog_code(nextval('catalog_code_seq'::regclass)), 70000, 45000, 1, 1, TRUE, FALSE, FALSE, NULL)
    `, [parent.rows[0].id]);
    await client.query(`
      INSERT INTO store_settings (store_name, phone, email, address, currency, tax_rate)
      VALUES ('CapyTech E2E Shop', '000000000', 'e2e@example.invalid',
              'Disposable test environment', 'MMK', 0)
    `);
    await client.query('COMMIT');
    console.log(`Verified disposable E2E database ${database} at ${serverAddress}:${port}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
