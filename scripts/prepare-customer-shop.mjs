import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pool = require('../backend/src/db/pool');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imagesRoot = path.join(
  root,
  'backend',
  'storage',
  'product-images'
);

function say(message) {
  console.log(message);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function clearImageFolder(folderName) {
  const dir = path.join(imagesRoot, folderName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }

  for (const entry of fs.readdirSync(dir)) {
    if (entry === '.gitkeep') {
      continue;
    }
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

async function main() {
  say('========================================');
  say('  Prepare CapyTech POS for the customer');
  say('========================================');
  say('');

  if (process.platform === 'win32') {
    say('This wipe is for the customer MacBook Air only.');
    say('This Windows PC has the live shop. Nothing was deleted.');
    process.exitCode = 1;
    return;
  }

  if (process.platform !== 'darwin') {
    say('Run this only on the shop Mac.');
    process.exitCode = 1;
    return;
  }

  if (!hasFlag('--yes-wipe-test-data')) {
    say('This erases leftover test logins and products on an EMPTY Mac shop.');
    say('The owner then creates their own account on the login screen.');
    say('');
    say('Run only on the customer Mac, and only if there are zero sales:');
    say('  node scripts/prepare-customer-shop.mjs --yes-wipe-test-data');
    say('');
    say('Do not run this on Windows. Do not restore the test USB backup.');
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();

  try {
    const sales = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'sales'
    `);

    if (sales.rows[0].count !== 1) {
      say('No shop tables yet. Double-click Install CapyTech POS first.');
      process.exitCode = 1;
      return;
    }

    const sold = await client.query(
      'SELECT COUNT(*)::int AS count FROM sales'
    );
    if (sold.rows[0].count > 0) {
      say(`This database already has ${sold.rows[0].count} sale(s).`);
      say('Refusing to wipe a shop that has sold.');
      say('Do not restore the Windows test backup onto this Mac.');
      process.exitCode = 1;
      return;
    }

    await client.query('BEGIN');

    await client.query(`
      TRUNCATE TABLE
        sale_items,
        sales,
        product_variants,
        products,
        customers,
        notifications,
        notification_preferences,
        audit_log,
        deleted_products,
        users
      RESTART IDENTITY CASCADE
    `);

    await client.query(`
      ALTER SEQUENCE invoice_number_seq RESTART WITH 1
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (process.exitCode) {
    return;
  }

  clearImageFolder('products');
  clearImageFolder('trash');

  say('Test data is gone. There is no login until the owner creates one.');
  say('Shop name, address, and categories were kept.');
  say('');
  say('On the Mac, start CapyTech POS. The first screen is');
  say('"Create your shop account". They pick name, username, and password.');
  say('Then they add their own products. First sale will be INV-000001.');
}

await main()
  .catch((error) => {
    say('');
    say(error instanceof Error ? error.message : 'Could not prepare the shop.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
