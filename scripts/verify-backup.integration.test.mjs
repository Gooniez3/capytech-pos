import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applicationCommandEnvironment,
  assertDatabaseIdentifier,
  assertRoleIdentifier,
  environmentWithoutPostgresVariables,
  parsePostgresToolVersion,
  restorePg17ArchiveToPg16,
} from './verify-backup.mjs';

const integrationEnabled = process.env.CAPYTECH_VERIFY_INTEGRATION === '1';

function run(command, args, environment, capture = false) {
  const result = spawnSync(command, args, {
    encoding: capture ? 'utf8' : undefined,
    env: environment,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'ignore'],
    timeout: 30_000,
    killSignal: 'SIGKILL',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Disposable PostgreSQL integration command failed: ${path.basename(command)}`);
  }
  return capture ? String(result.stdout) : '';
}

test('PostgreSQL 17.11 archive restores atomically into disposable PostgreSQL 16 databases', {
  skip: !integrationEnabled,
  timeout: 120_000,
}, async () => {
  assert.equal(
    process.env.CAPYTECH_VERIFY_INTEGRATION_ACK,
    'DISPOSABLE_POSTGRESQL_16_ONLY',
    'Explicit disposable-server acknowledgement is required.'
  );
  const host = process.env.CAPYTECH_VERIFY_INTEGRATION_HOST;
  const port = process.env.CAPYTECH_VERIFY_INTEGRATION_PORT;
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host));
  assert.match(String(port || ''), /^\d+$/);
  assert.notEqual(String(port), '5432', 'The guarded integration test refuses the production port.');
  const operatingEnvironment = Object.fromEntries(
    Object.entries(environmentWithoutPostgresVariables()).filter(
      ([key]) => !key.startsWith('CAPYTECH_VERIFY_INTEGRATION_')
    )
  );

  const pg17Bin = fs.realpathSync(process.env.CAPYTECH_VERIFY_PG17_BIN);
  const pg16Bin = fs.realpathSync(process.env.CAPYTECH_VERIFY_PG16_BIN);
  const executable = (name) => path.join(
    name === 'createdb' || name === 'dropdb' ? pg16Bin : pg17Bin,
    process.platform === 'win32' ? `${name}.exe` : name
  );
  const pgRestore = executable('pg_restore');
  const psql = executable('psql');
  const pgDump = executable('pg_dump');
  const createdb = executable('createdb');
  const dropdb = executable('dropdb');
  for (const tool of [pgRestore, psql, pgDump, createdb, dropdb]) {
    assert.equal(fs.existsSync(tool), true, `Missing integration tool: ${path.basename(tool)}`);
  }
  const restoreVersion = parsePostgresToolVersion(
    run(pgRestore, ['--version'], operatingEnvironment, true)
  );
  const psqlVersion = parsePostgresToolVersion(
    run(psql, ['--version'], operatingEnvironment, true)
  );
  assert.equal(restoreVersion?.major, 17);
  assert.ok(restoreVersion.minor >= 11);
  assert.deepEqual(psqlVersion, restoreVersion);

  const adminUser = assertRoleIdentifier(
    process.env.CAPYTECH_VERIFY_INTEGRATION_ADMIN_USER,
    'Integration administrator role'
  );
  const applicationUser = assertRoleIdentifier(
    process.env.CAPYTECH_VERIFY_INTEGRATION_APP_USER,
    'Integration application role'
  );
  assert.notEqual(adminUser, 'phyowaiaung');
  assert.notEqual(applicationUser, 'capytech_v2_user');
  assert.notEqual(adminUser, applicationUser);
  const suffix = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const sourceDatabase = assertDatabaseIdentifier(`capytech_verify_source_${suffix}`);
  const successDatabase = assertDatabaseIdentifier(`capytech_verify_success_${suffix}`);
  const rollbackDatabase = assertDatabaseIdentifier(`capytech_verify_rollback_${suffix}`);
  const databases = [sourceDatabase, successDatabase, rollbackDatabase];
  const connectionArgs = ['--host', host, '--port', port];
  const adminEnvironment = { ...operatingEnvironment };
  if (process.env.CAPYTECH_VERIFY_INTEGRATION_ADMIN_PASSWORD) {
    adminEnvironment.PGPASSWORD = process.env.CAPYTECH_VERIFY_INTEGRATION_ADMIN_PASSWORD;
  }
  const applicationEnvironment = applicationCommandEnvironment(
    { DB_PASSWORD: process.env.CAPYTECH_VERIFY_INTEGRATION_APP_PASSWORD },
    operatingEnvironment
  );
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capytech-pg-integration-'));
  const archive = path.join(tempRoot, 'synthetic.dump');

  const psqlCommand = (database, sql, capture = false) => run(psql, [
    ...connectionArgs,
    '--username', applicationUser,
    '--dbname', database,
    '--no-psqlrc',
    '--set', 'ON_ERROR_STOP=1',
    '--tuples-only',
    '--no-align',
    '--command', sql,
  ], applicationEnvironment, capture);

  try {
    for (const database of databases) {
      run(createdb, [
        ...connectionArgs,
        '--username', adminUser,
        '--maintenance-db', 'postgres',
        '--owner', applicationUser,
        database,
      ], adminEnvironment);
    }
    const serverVersion = psqlCommand(
      sourceDatabase,
      "SELECT current_setting('server_version_num');",
      true
    ).trim();
    assert.equal(Math.floor(Number(serverVersion) / 10000), 16);
    psqlCommand(sourceDatabase, `
      CREATE TABLE restore_fixture_before (id integer PRIMARY KEY);
      CREATE TABLE restore_fixture_after (id integer PRIMARY KEY, value text NOT NULL);
      INSERT INTO restore_fixture_before VALUES (1);
      INSERT INTO restore_fixture_after VALUES (2, 'synthetic');
    `);
    run(pgDump, [
      ...connectionArgs,
      '--username', applicationUser,
      '--format=custom',
      '--file', archive,
      sourceDatabase,
    ], applicationEnvironment);

    const generatedSql = run(pgRestore, ['--file=-', '--no-owner', '--no-acl', archive],
      operatingEnvironment, true);
    const restrict = generatedSql.match(/^\\restrict ([A-Za-z0-9]+)$/m);
    const unrestrict = generatedSql.match(/^\\unrestrict ([A-Za-z0-9]+)$/m);
    assert.ok(restrict);
    assert.ok(unrestrict);
    assert.equal(unrestrict[1], restrict[1]);
    assert.equal((generatedSql.match(/^SET transaction_timeout = 0;$/gm) || []).length, 1);

    await restorePg17ArchiveToPg16({
      pgRestore,
      psql,
      connectionArgs,
      applicationUser,
      databaseName: successDatabase,
      productionDatabaseName: 'capytech_pos_v2',
      dumpFile: archive,
      applicationEnvironment,
    });
    assert.equal(
      psqlCommand(successDatabase, 'SELECT value FROM restore_fixture_after WHERE id = 2;', true).trim(),
      'synthetic'
    );

    psqlCommand(rollbackDatabase, 'CREATE TABLE restore_fixture_before (id integer PRIMARY KEY);');
    await assert.rejects(restorePg17ArchiveToPg16({
      pgRestore,
      psql,
      connectionArgs,
      applicationUser,
      databaseName: rollbackDatabase,
      productionDatabaseName: 'capytech_pos_v2',
      dumpFile: archive,
      applicationEnvironment,
    }));
    assert.equal(
      psqlCommand(rollbackDatabase, `
        SELECT count(*) FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'restore_fixture_after';
      `, true).trim(),
      '0'
    );
  } finally {
    for (const database of [...databases].reverse()) {
      run(dropdb, [
        ...connectionArgs,
        '--username', adminUser,
        '--maintenance-db', 'postgres',
        '--if-exists',
        database,
      ], adminEnvironment);
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
