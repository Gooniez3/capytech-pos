import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  applicationCommandEnvironment,
  assertDatabaseIdentifier,
  assertRoleIdentifier,
  environmentWithoutPostgresVariables,
  migrationCommandEnvironment,
  parseArguments,
  resolveDatabaseActors,
  runVerificationDatabaseCommands,
  runVerificationLifecycle,
  verificationReceipt,
} from './verify-backup.mjs';

test('default verification mode keeps database lifecycle on the application role', () => {
  const args = parseArguments(['--backup', './backup', '--test-migrations']);
  assert.deepEqual(args, {
    backup: path.resolve('./backup'),
    keepDatabase: false,
    testMigrations: true,
    adminAssisted: false,
    adminUser: null,
  });
  assert.deepEqual(
    resolveDatabaseActors(args, {
      DB_NAME: 'capytech_pos_v2',
      DB_USER: 'capytech_v2_user',
      DB_HOST: '127.0.0.1',
      DB_PORT: '5432',
    }),
    {
      applicationUser: 'capytech_v2_user',
      lifecycleUser: 'capytech_v2_user',
      adminAssisted: false,
    }
  );
});

test('administrator-assisted mode changes only the create/drop actor', () => {
  const args = parseArguments([
    '--backup', './backup',
    '--test-migrations',
    '--admin-assisted',
    '--admin-user', 'phyowaiaung',
  ]);
  assert.deepEqual(
    resolveDatabaseActors(args, {
      DB_NAME: 'capytech_pos_v2',
      DB_USER: 'capytech_v2_user',
      DB_HOST: '127.0.0.1',
      DB_PORT: '5432',
    }),
    {
      applicationUser: 'capytech_v2_user',
      lifecycleUser: 'phyowaiaung',
      adminAssisted: true,
    }
  );
});

test('mocked subprocesses keep administrator and application credentials isolated', async () => {
  const databaseName = 'capytech_verify_1234_abcdef';
  const inherited = {
    PATH: '/usr/local/bin:/usr/bin',
    HOME: '/Users/operator',
    LANG: 'en_US.UTF-8',
    PGPASSWORD: 'administrator-secret',
    PGPASSFILE: '/tmp/admin-passfile',
    PGSERVICE: 'administrator-service',
    PGSERVICEFILE: '/tmp/admin-service.conf',
    DB_USER: 'administrator-user',
    DB_PASSWORD: 'administrator-secret',
  };
  const administratorEnvironment = environmentWithoutPostgresVariables(inherited);
  const applicationEnvironment = applicationCommandEnvironment(
    { DB_PASSWORD: 'application-secret' },
    inherited
  );
  const calls = [];
  let verified = false;
  let removed = false;
  await runVerificationDatabaseCommands({
    runCommand: async (command, args, options) => calls.push({ command, args, options }),
    tools: { createdb: '/pg/createdb', pgRestore: '/pg/pg_restore', dropdb: '/pg/dropdb' },
    connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
    actors: {
      lifecycleUser: 'phyowaiaung',
      applicationUser: 'capytech_v2_user',
      adminAssisted: true,
    },
    databaseName,
    productionDatabaseName: 'capytech_pos_v2',
    dumpFile: '/backup/database/capytech_pos_v2.dump',
    administratorEnvironment,
    applicationEnvironment,
    keepDatabase: false,
    verifyDatabase: async () => { verified = true; },
    onRemoved: () => { removed = true; },
  });

  assert.equal(verified, true);
  assert.equal(removed, true);
  assert.deepEqual(calls.map(({ command }) => command), [
    '/pg/createdb', '/pg/pg_restore', '/pg/dropdb',
  ]);
  assert.deepEqual(calls[0].args, [
    '--host', '127.0.0.1', '--port', '5432',
    '--username', 'phyowaiaung', '--maintenance-db', 'postgres',
    '--owner', 'capytech_v2_user', databaseName,
  ]);
  assert.deepEqual(calls[1].args, [
    '--host', '127.0.0.1', '--port', '5432',
    '--username', 'capytech_v2_user', '--dbname', databaseName,
    '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl',
    '/backup/database/capytech_pos_v2.dump',
  ]);
  assert.deepEqual(calls[2].args, [
    '--host', '127.0.0.1', '--port', '5432',
    '--username', 'phyowaiaung', '--maintenance-db', 'postgres',
    '--if-exists', databaseName,
  ]);
  for (const call of [calls[0], calls[2]]) {
    assert.equal(call.options.interactive, true);
    assert.equal(call.options.replaceEnv, true);
    assert.equal(call.options.env.PASSWORD, undefined);
    assert.equal(Object.keys(call.options.env).some((key) => key.startsWith('PG')), false);
    assert.equal(call.options.env.DB_USER, undefined);
    assert.equal(call.options.env.DB_PASSWORD, undefined);
    assert.equal(call.options.env.PATH, inherited.PATH);
    assert.equal(call.options.env.HOME, inherited.HOME);
  }
  assert.equal(calls[1].options.interactive, undefined);
  assert.equal(calls[1].options.replaceEnv, true);
  assert.equal(calls[1].options.env.PGPASSWORD, 'application-secret');
  assert.equal(calls[1].options.env.PGPASSFILE, undefined);
  assert.equal(calls[1].options.env.PGSERVICE, undefined);
  assert.equal(calls[1].options.env.PGSERVICEFILE, undefined);
  assert.equal(calls[1].options.env.PATH, inherited.PATH);
});

test('default mocked subprocess mode remains application-owned and non-interactive', async () => {
  const calls = [];
  const applicationEnvironment = {
    PATH: '/usr/bin',
    PGPASSWORD: 'application-secret',
  };
  await runVerificationDatabaseCommands({
    runCommand: async (command, args, options) => calls.push({ command, args, options }),
    tools: { createdb: 'createdb', pgRestore: 'pg_restore', dropdb: 'dropdb' },
    connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
    actors: {
      lifecycleUser: 'capytech_v2_user',
      applicationUser: 'capytech_v2_user',
      adminAssisted: false,
    },
    databaseName: 'capytech_verify_1234_abcdef',
    productionDatabaseName: 'capytech_pos_v2',
    dumpFile: '/backup/database/capytech_pos_v2.dump',
    administratorEnvironment: applicationEnvironment,
    applicationEnvironment,
    keepDatabase: false,
    verifyDatabase: async () => {},
  });
  assert.deepEqual(calls.map(({ command }) => command), ['createdb', 'pg_restore', 'dropdb']);
  assert.equal(calls[0].args[calls[0].args.indexOf('--username') + 1], 'capytech_v2_user');
  assert.equal(calls[2].args[calls[2].args.indexOf('--username') + 1], 'capytech_v2_user');
  assert.equal(calls[0].options.interactive, false);
  assert.equal(calls[1].options.interactive, undefined);
  assert.equal(calls[2].options.interactive, false);
});

test('migration subprocess environment contains only application database credentials', () => {
  const environment = migrationCommandEnvironment(
    {
      DB_HOST: '127.0.0.1',
      DB_PORT: '5432',
      DB_USER: 'capytech_v2_user',
      DB_PASSWORD: 'application-secret',
    },
    'capytech_verify_1234_abcdef',
    {
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/Users/operator',
      PGPASSWORD: 'administrator-secret',
      PGSERVICEFILE: '/tmp/admin-service.conf',
      DB_USER: 'administrator-user',
      DB_PASSWORD: 'administrator-secret',
    }
  );
  assert.deepEqual(environment, {
    PATH: '/usr/local/bin:/usr/bin',
    HOME: '/Users/operator',
    DB_HOST: '127.0.0.1',
    DB_PORT: '5432',
    DB_NAME: 'capytech_verify_1234_abcdef',
    DB_USER: 'capytech_v2_user',
    DB_PASSWORD: 'application-secret',
  });
});

test('administrator-assisted mode is explicit and rejects unsafe inputs', () => {
  assert.throws(
    () => parseArguments(['--backup', './backup', '--admin-assisted']),
    /must be supplied together/
  );
  assert.throws(
    () => parseArguments(['--backup', './backup', '--admin-user', 'phyowaiaung']),
    /must be supplied together/
  );
  assert.throws(
    () => parseArguments(['--backup', './backup', '--admin-assisted', '--admin-user', 'bad-role;']),
    /safe PostgreSQL identifier/
  );
  assert.throws(
    () => parseArguments(['--backup', './backup', '--backup', './other']),
    /Duplicate/
  );
  assert.throws(
    () => parseArguments(['--backup', './backup', '--unknown']),
    /Unknown/
  );
  assert.throws(() => assertDatabaseIdentifier('capytech-pos-v2'), /safe PostgreSQL identifier/);
  assert.throws(() => assertRoleIdentifier('Role With Spaces'), /safe PostgreSQL identifier/);
  assert.throws(
    () => resolveDatabaseActors(
      { adminAssisted: true, adminUser: 'capytech_v2_user' },
      {
        DB_NAME: 'capytech_pos_v2',
        DB_USER: 'capytech_v2_user',
        DB_HOST: '127.0.0.1',
        DB_PORT: '5432',
      }
    ),
    /must be different/
  );
  for (const unsafeEnvironment of [
    {
      DB_NAME: 'pos_store', DB_USER: 'pos_shop', DB_HOST: '127.0.0.1', DB_PORT: '5432',
    },
    {
      DB_NAME: 'capytech_pos_v2', DB_USER: 'capytech_v2_user', DB_HOST: 'db.example.com', DB_PORT: '5432',
    },
    {
      DB_NAME: 'capytech_pos_v2', DB_USER: 'capytech_v2_user', DB_HOST: '127.0.0.1', DB_PORT: '5433',
    },
  ]) {
    assert.throws(
      () => resolveDatabaseActors(
        { adminAssisted: true, adminUser: 'phyowaiaung' },
        unsafeEnvironment
      ),
      /requires the local CapyTech v2 database/
    );
  }
});

test('successful verification cleans up unless retention is requested', async () => {
  const calls = [];
  const result = await runVerificationLifecycle({
    createDatabase: async () => calls.push('create'),
    verifyDatabase: async () => calls.push('verify'),
    dropDatabase: async () => calls.push('drop'),
    onRetained: () => calls.push('retain'),
  });
  assert.deepEqual(calls, ['create', 'verify', 'drop']);
  assert.deepEqual(result, { created: true, verified: true, removed: true });

  calls.length = 0;
  const kept = await runVerificationLifecycle({
    keepDatabase: true,
    createDatabase: async () => calls.push('create'),
    verifyDatabase: async () => calls.push('verify'),
    dropDatabase: async () => calls.push('drop'),
    onRetained: () => calls.push('retain'),
  });
  assert.deepEqual(calls, ['create', 'verify', 'retain']);
  assert.deepEqual(kept, { created: true, verified: true, removed: false });
});

test('verification errors retain the isolated database for investigation', async () => {
  const calls = [];
  await assert.rejects(
    runVerificationLifecycle({
      createDatabase: async () => calls.push('create'),
      verifyDatabase: async () => {
        calls.push('verify');
        throw new Error('comparison failed');
      },
      dropDatabase: async () => calls.push('drop'),
      onRetained: () => calls.push('retain'),
    }),
    /comparison failed/
  );
  assert.deepEqual(calls, ['create', 'verify', 'retain']);
});

test('mocked subprocess failure retains the generated database and never invokes dropdb', async () => {
  const calls = [];
  let retained = false;
  await assert.rejects(
    runVerificationDatabaseCommands({
      runCommand: async (command, args, options) => calls.push({ command, args, options }),
      tools: { createdb: 'createdb', pgRestore: 'pg_restore', dropdb: 'dropdb' },
      connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
      actors: {
        lifecycleUser: 'phyowaiaung',
        applicationUser: 'capytech_v2_user',
      },
      databaseName: 'capytech_verify_1234_abcdef',
      productionDatabaseName: 'capytech_pos_v2',
      dumpFile: '/backup/database/capytech_pos_v2.dump',
      administratorEnvironment: { PATH: '/usr/bin' },
      applicationEnvironment: { PATH: '/usr/bin', PGPASSWORD: 'application-secret' },
      keepDatabase: false,
      verifyDatabase: async () => { throw new Error('comparison failed'); },
      onRetained: () => { retained = true; },
    }),
    /comparison failed/
  );
  assert.deepEqual(calls.map(({ command }) => command), ['createdb', 'pg_restore']);
  assert.equal(retained, true);
});

test('verification command lifecycle refuses production database targets before spawning', async () => {
  for (const databaseName of ['capytech_pos_v2', 'pos_store', 'other_database']) {
    let spawned = false;
    await assert.rejects(
      runVerificationDatabaseCommands({
        runCommand: async () => { spawned = true; },
        tools: { createdb: 'createdb', pgRestore: 'pg_restore', dropdb: 'dropdb' },
        connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
        actors: {
          lifecycleUser: 'phyowaiaung',
          applicationUser: 'capytech_v2_user',
        },
        databaseName,
        productionDatabaseName: 'capytech_pos_v2',
        dumpFile: '/backup/database/capytech_pos_v2.dump',
        administratorEnvironment: { PATH: '/usr/bin' },
        applicationEnvironment: { PATH: '/usr/bin', PGPASSWORD: 'application-secret' },
        verifyDatabase: async () => {},
      }),
      /safety-scoped|must not be the production database/
    );
    assert.equal(spawned, false);
  }
});

test('verification receipt distinguishes cleanup success from requested retention', () => {
  assert.equal(
    verificationReceipt('capytech_verify_1234_abcdef', true, { removed: true })
      .isolatedDatabaseCleanup,
    'removed'
  );
  assert.equal(
    verificationReceipt('capytech_verify_1234_abcdef', true, { removed: false })
      .isolatedDatabaseCleanup,
    'retained-by-request'
  );
});

test('create errors do not attempt cleanup and cleanup errors report retention', async () => {
  const createCalls = [];
  await assert.rejects(
    runVerificationLifecycle({
      createDatabase: async () => {
        createCalls.push('create');
        throw new Error('create failed');
      },
      verifyDatabase: async () => createCalls.push('verify'),
      dropDatabase: async () => createCalls.push('drop'),
      onRetained: () => createCalls.push('retain'),
    }),
    /create failed/
  );
  assert.deepEqual(createCalls, ['create']);

  const cleanupCalls = [];
  await assert.rejects(
    runVerificationLifecycle({
      createDatabase: async () => cleanupCalls.push('create'),
      verifyDatabase: async () => cleanupCalls.push('verify'),
      dropDatabase: async () => {
        cleanupCalls.push('drop');
        throw new Error('cleanup failed');
      },
      onRetained: () => cleanupCalls.push('retain'),
    }),
    /cleanup failed/
  );
  assert.deepEqual(cleanupCalls, ['create', 'verify', 'drop', 'retain']);
});
