import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDataManifestEqual,
  assertMigrationDataPreserved,
  assertSafeVerificationDatabase,
  loadEnv,
  resolveProductImagesDir,
  verifyChecksumManifest,
  writeChecksumManifest,
} from './lib/backup-safety.mjs';
import {
  MANIFEST_FORMAT_VERSION,
  OPTIONAL_PROTECTED_COLUMNS,
  PROTECTED_TABLE_COLUMNS,
  captureProductionDataManifest,
} from './lib/production-data.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('configured image directory resolves using backend working-directory semantics', () => {
  assert.equal(
    resolveProductImagesDir({ PRODUCT_IMAGES_DIR: '../shared/images' }, '/shop/backend'),
    path.resolve('/shop/backend', '../shared/images')
  );
  assert.equal(
    resolveProductImagesDir({}, '/shop/backend'),
    path.join('/shop/backend', 'storage', 'product-images')
  );
});

test('environment parsing preserves quoted paths and secrets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capytech-env-test-'));
  try {
    const envFile = path.join(root, '.env');
    fs.writeFileSync(
      envFile,
      'PRODUCT_IMAGES_DIR="../Shop Images"\nDB_PASSWORD="secret#value"\nPORT=4000 # comment\n'
    );
    const env = loadEnv(envFile);
    assert.equal(env.PRODUCT_IMAGES_DIR, '../Shop Images');
    assert.equal(env.DB_PASSWORD, 'secret#value');
    assert.equal(env.PORT, '4000');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verification database names are isolated and never production', () => {
  assert.equal(
    assertSafeVerificationDatabase('capytech_verify_20261011', 'pos_store'),
    'capytech_verify_20261011'
  );
  assert.throws(() => assertSafeVerificationDatabase('pos_store', 'pos_store'));
  assert.throws(() => assertSafeVerificationDatabase('other_database', 'pos_store'));
});

test('checksums detect corruption', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capytech-backup-test-'));
  try {
    fs.mkdirSync(path.join(root, 'configuration'));
    const file = path.join(root, 'configuration', 'backend.env');
    fs.writeFileSync(file, 'SAFE=true\n');
    assert.equal(writeChecksumManifest(root), 1);
    assert.deepEqual(verifyChecksumManifest(root), ['configuration/backend.env']);
    fs.appendFileSync(file, 'CHANGED=true\n');
    assert.throws(() => verifyChecksumManifest(root), /checksum failed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('protected-data comparison catches row, stock, invoice, image, or sequence drift', () => {
  const expected = {
    formatVersion: 2,
    protectedShape: {
      tables: { sales: ['id', 'warranty_months'] },
      sequences: ['invoice_number_seq'],
    },
    tables: { sales: { count: '1', digest: 'a' } },
    sequences: { invoice_number_seq: { last_value: '2', is_called: true } },
    inventory: { count: '1', digest: 'b' },
    invoices: { count: '1', digest: 'c' },
    imageReferences: [{ product_id: '1', image_path: 'products/a.jpg' }],
  };
  assert.doesNotThrow(() => assertDataManifestEqual(expected, structuredClone(expected)));
  const changed = structuredClone(expected);
  changed.inventory.digest = 'different';
  assert.throws(() => assertDataManifestEqual(expected, changed), /does not match/);
});

test('version 2 explicitly protects nullable, zero, and positive sale warranties', () => {
  assert.equal(MANIFEST_FORMAT_VERSION, 2);
  assert.ok(OPTIONAL_PROTECTED_COLUMNS.sales.includes('warranty_months'));

  const manifest = (salesDigest) => ({
    formatVersion: 2,
    protectedShape: {
      tables: { sales: ['id', 'invoice_number', 'warranty_months'] },
      sequences: ['invoice_number_seq'],
    },
    tables: { sales: { count: '3', digest: salesDigest } },
    sequences: { invoice_number_seq: { last_value: '3', is_called: true } },
    inventory: { count: '0', digest: 'inventory' },
    invoices: { count: '3', digest: 'invoices' },
    imageReferences: [],
  });

  const nullZeroAndPositive = manifest('null-zero-12-months');
  assert.doesNotThrow(() =>
    assertDataManifestEqual(nullZeroAndPositive, structuredClone(nullZeroAndPositive))
  );

  const tamperedWarranty = manifest('null-zero-6-months');
  assert.throws(
    () => assertMigrationDataPreserved(nullZeroAndPositive, tamperedWarranty),
    /changed protected historical data/
  );
});

test('explicit manifest contract covers every immutable baseline column', () => {
  const baseline = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, 'backend', 'migrations', 'baseline-schema.json'),
      'utf8'
    )
  );
  const baselineTables = Object.fromEntries(
    baseline.tables.map(({ name }) => [
      name,
      baseline.columns
        .filter(({ table_name }) => table_name === name)
        .map(({ name: column }) => column),
    ])
  );
  assert.deepEqual(PROTECTED_TABLE_COLUMNS, baselineTables);
  assert.deepEqual(OPTIONAL_PROTECTED_COLUMNS, {
    products: ['deleted_at', 'deleted_by'],
    sales: ['checkout_request_fingerprint', 'warranty_months'],
  });
});

test('migration comparison fails closed for unexpected historical table changes', () => {
  const before = {
    formatVersion: 2,
    protectedShape: {
      tables: {
        customers: ['id', 'name'],
        products: ['id', 'sku', 'stock_quantity'],
        sale_items: ['id', 'sale_id', 'quantity'],
      },
      sequences: ['invoice_number_seq'],
    },
    tables: {
      customers: { count: '1', digest: 'customers' },
      products: { count: '1', digest: 'products' },
      sale_items: { count: '1', digest: 'items' },
    },
    sequences: { invoice_number_seq: { last_value: '8', is_called: true } },
    inventory: { count: '1', digest: 'stock' },
    invoices: { count: '1', digest: 'invoice' },
    imageReferences: [],
  };
  for (const table of Object.keys(before.tables)) {
    const after = structuredClone(before);
    after.tables[table].digest = 'tampered';
    assert.throws(
      () => assertMigrationDataPreserved(before, after),
      /changed protected historical data/
    );
  }
});

test('legacy format 1 manifests remain exactly comparable', () => {
  const legacy = {
    formatVersion: 1,
    tables: { sales: { count: '1', digest: 'legacy' } },
    sequences: { invoice_number_seq: { last_value: '1', is_called: true } },
    inventory: { count: '1', digest: 'inventory' },
    invoices: { count: '1', digest: 'invoices' },
    imageReferences: [],
  };
  assert.doesNotThrow(() => assertDataManifestEqual(legacy, structuredClone(legacy)));
  const changed = structuredClone(legacy);
  changed.tables.sales.digest = 'changed';
  assert.throws(() => assertDataManifestEqual(legacy, changed), /does not match/);
});

test('comparison capture reuses the old explicit shape across additive schema changes', async () => {
  const expected = {
    formatVersion: 2,
    protectedShape: {
      tables: { sales: ['id', 'invoice_number', 'warranty_months'] },
      sequences: ['invoice_number_seq'],
    },
  };
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('current_database()')) {
        return { rows: [{ database: 'isolated_test', server_version: 'test' }] };
      }
      if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'id' },
            { column_name: 'invoice_number' },
            { column_name: 'warranty_months' },
            { column_name: 'future_nullable_column' },
          ],
        };
      }
      if (sql.includes('last_value::text')) {
        return { rows: [{ last_value: '9', is_called: true }] };
      }
      if (sql.includes('WHERE image_path IS NOT NULL')) return { rows: [] };
      if (sql.includes('COUNT(*)::text')) {
        return { rows: [{ count: '0', digest: 'empty' }] };
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };

  const actual = await captureProductionDataManifest(client, {
    comparisonManifest: expected,
  });
  assert.deepEqual(actual.protectedShape, expected.protectedShape);
  const salesDigestQuery = queries.find(({ sql }) =>
    sql.includes('FROM public."sales"') && sql.includes('to_jsonb(protected_row)')
  )?.sql;
  assert.match(salesDigestQuery, /"warranty_months"/);
  assert.doesNotMatch(salesDigestQuery, /future_nullable_column/);
  assert.equal(queries.some(({ params }) => params[0] === 'future_empty_table'), false);
});

test('dedicated updater cannot call destructive installation or preparation scripts', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'scripts', 'update-shop.mjs'), 'utf8');
  const verifier = fs.readFileSync(path.join(projectRoot, 'scripts', 'verify-backup.mjs'), 'utf8');
  assert.doesNotMatch(source, /install-shop|prepare-customer/i);
  assert.doesNotMatch(source, /reset\s+--hard|checkout\s+--|rmSync|unlinkSync|rmdirSync/i);
  assert.match(source, /verify-backup\.mjs/);
  assert.match(source, /--test-migrations/);
  assert.match(source, /assertMigrationDataPreserved/);
  assert.doesNotMatch(source, /warranty_months IS NOT NULL/);
  assert.doesNotMatch(source, /Historical invoices were unexpectedly assigned warranty values/);
  assert.doesNotMatch(verifier, /warranty_months IS NOT NULL/);
  assert.match(verifier, /comparisonManifest: expected/);
  assert.match(source, /Reviewed release tracks protected persisted paths/);
  assert.match(source, /HTTPS certificates changed during update/);
  assert.match(source, /Pre-existing backup changed during update/);
});

test('backup workflow never deletes, renames, or overwrites persisted source files', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'scripts', 'backup-shop.mjs'), 'utf8');
  assert.doesNotMatch(source, /rmSync|unlinkSync|renameSync|truncateSync/i);
  assert.match(source, /COPYFILE_EXCL/);
  assert.match(source, /BACKUP-COMPLETE\.json/);
  assert.match(source, /assertReferencedImagesPresent/);
});

test('restore verification scopes database removal to the generated isolated name', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'scripts', 'verify-backup.mjs'), 'utf8');
  assert.match(source, /assertSafeVerificationDatabase/);
  assert.match(source, /capytech_verify_\$\{Date\.now\(\)\}/);
  assert.match(
    source,
    /dropdb,[\s\S]*'--if-exists', databaseName/
  );
});

test('macOS update launcher is LF-only, darwin-scoped, and invokes only the safe updater', () => {
  const launcherPath = path.join(projectRoot, 'Update CapyTech POS.command');
  const launcher = fs.readFileSync(launcherPath, 'utf8');
  const updater = fs.readFileSync(path.join(projectRoot, 'scripts', 'update-shop.mjs'), 'utf8');
  const backup = fs.readFileSync(path.join(projectRoot, 'scripts', 'backup-shop.mjs'), 'utf8');
  const verifier = fs.readFileSync(path.join(projectRoot, 'scripts', 'verify-backup.mjs'), 'utf8');
  const macSources = `${launcher}\n${backup}\n${verifier}`;
  assert.ok(launcher.startsWith('#!/bin/bash\n'));
  assert.equal(launcher.includes('\r'), false);
  assert.match(launcher, /scripts\/update-shop\.mjs/);
  assert.match(launcher, /current_root="\$\{current_root\/\/\\\\ \/ \}"/);
  assert.doesNotMatch(launcher, /install-shop|prepare-customer/i);
  assert.match(updater, /process\.platform !== 'darwin'/);
  assert.match(macSources, /\/opt\/homebrew/);
  assert.match(macSources, /\/usr\/local/);
  assert.match(macSources, /Postgres\.app/);
});

test('frontend expiry handling preserves drafts and notification calls use the API client', () => {
  const authSession = fs.readFileSync(
    path.join(projectRoot, 'frontend', 'src', 'lib', 'authSession.ts'),
    'utf8'
  );
  const api = fs.readFileSync(
    path.join(projectRoot, 'frontend', 'src', 'lib', 'api.ts'),
    'utf8'
  );
  const header = fs.readFileSync(
    path.join(projectRoot, 'frontend', 'src', 'components', 'layout', 'Header.tsx'),
    'utf8'
  );
  assert.match(authSession, /removeItem\(TOKEN_STORAGE_KEY\)/);
  assert.match(authSession, /removeItem\(USER_STORAGE_KEY\)/);
  assert.doesNotMatch(authSession, /localStorage\.clear/);
  assert.doesNotMatch(authSession, /capytech-pos-draft/);
  assert.match(api, /response\.status === 401/);
  assert.match(header, /api\.patch\(endpoint\)/);
  assert.doesNotMatch(header, /fetch\(endpoint/);
});

test('invoice print view renders warranty and keeps the admin editor off paper', () => {
  const invoice = fs.readFileSync(
    path.join(projectRoot, 'frontend', 'src', 'pages', 'InvoicePage.tsx'),
    'utf8'
  );
  assert.match(invoice, /Warranty/);
  assert.match(invoice, /invoiceWarrantyDisplay/);
  assert.match(invoice, /invoice-warranty-panel/);
  assert.match(invoice, /WARRANTY &amp; PURCHASE INFORMATION/);
  assert.match(invoice, /break-inside-avoid/);
  assert.doesNotMatch(invoice, /ShieldCheck/);
  assert.match(invoice, /print:hidden/);
  assert.match(invoice, /\/warranty/);
});
