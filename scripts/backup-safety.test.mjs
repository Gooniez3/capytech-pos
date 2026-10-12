import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDataManifestEqual,
  assertSafeVerificationDatabase,
  loadEnv,
  resolveProductImagesDir,
  verifyChecksumManifest,
  writeChecksumManifest,
} from './lib/backup-safety.mjs';

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

test('dedicated updater cannot call destructive installation or preparation scripts', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'scripts', 'update-shop.mjs'), 'utf8');
  assert.doesNotMatch(source, /install-shop|prepare-customer/i);
  assert.doesNotMatch(source, /reset\s+--hard|checkout\s+--|rmSync|unlinkSync|rmdirSync/i);
  assert.match(source, /verify-backup\.mjs/);
  assert.match(source, /--test-migrations/);
  assert.match(source, /assertDataManifestEqual/);
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
