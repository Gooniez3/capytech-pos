import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  applicationCommandEnvironment,
  assertDatabaseIdentifier,
  assertRoleIdentifier,
  beginVerificationAttempt,
  environmentWithoutPostgresVariables,
  isSecurePg17Version,
  migrationCommandEnvironment,
  parseArguments,
  parsePostgresToolVersion,
  restorePg17ArchiveToPg16,
  resolveDatabaseActors,
  runExclusiveVerificationAttempt,
  runVerificationDatabaseCommands,
  runVerificationLifecycle,
  verificationReceipt,
  writeVerificationReceiptExclusive,
} from './verify-backup.mjs';

test('default verification mode keeps database lifecycle on the application role', () => {
  const args = parseArguments(['--backup', './backup', '--test-migrations']);
  assert.deepEqual(args, {
    backup: path.resolve('./backup'),
    keepDatabase: false,
    testMigrations: true,
    adminAssisted: false,
    adminUser: null,
    pg17ToPg16Compat: false,
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

function createMockRestoreProcesses({
  sql,
  restoreCode = 0,
  psqlCode = 0,
  probeOutput,
  probeCode = 0,
}) {
  const calls = [];
  let psqlInput = '';
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    child.killed = false;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    calls.push({ command, args, options, child });

    let closed = false;
    const close = (code) => {
      if (closed) return;
      closed = true;
      child.emit('close', code, null);
    };
    child.kill = () => {
      child.killed = true;
      child.stdout.destroy();
      child.stderr.destroy();
      close(1);
    };

    if (args.some((argument) => argument.startsWith('--command='))) {
      const database = args[args.indexOf('--dbname') + 1];
      const user = args[args.indexOf('--username') + 1];
      process.nextTick(() => {
        child.stdout.end(probeOutput ?? `${database}|${user}|160015\n`, () => close(probeCode));
        child.stderr.end();
      });
    } else if (command === '/pg17/psql') {
      child.stdin.on('data', (chunk) => { psqlInput += chunk.toString(); });
      child.stdin.on('finish', () => close(psqlCode));
    } else {
      child.stdin.end();
      process.nextTick(() => {
        const chunks = Array.isArray(sql) ? sql : [sql];
        for (const chunk of chunks) child.stdout.write(chunk);
        child.stdout.end(() => close(restoreCode));
        child.stderr.end();
      });
    }
    return child;
  };
  return { calls, getPsqlInput: () => psqlInput, spawnProcess };
}

function createActualFixtureSpawn({ producer, consumer }) {
  return (command, args, options) => {
    let script;
    let extraEnvironment = {};
    if (args.some((argument) => argument.startsWith('--command='))) {
      const database = args[args.indexOf('--dbname') + 1];
      const user = args[args.indexOf('--username') + 1];
      script = 'process.stdout.write(process.env.CAPYTECH_TEST_IDENTITY);';
      extraEnvironment.CAPYTECH_TEST_IDENTITY = `${database}|${user}|160015\n`;
    } else if (command === 'fixture-psql') {
      script = consumer;
    } else {
      script = producer;
    }
    return spawn(process.execPath, ['-e', script], {
      ...options,
      env: { ...options.env, ...extraEnvironment },
    });
  };
}

function actualFixtureRestore(overrides = {}) {
  const producer = overrides.producer || String.raw`
    const header = '\\restrict Abc123\nSET transaction_timeout = 0;\nCREATE TABLE synthetic(id integer);\n';
    process.stdout.write(header);
    let remaining = 512 * 1024;
    const chunk = Buffer.alloc(16384, 45);
    const write = () => {
      while (remaining > 0) {
        const value = remaining < chunk.length ? chunk.subarray(0, remaining) : chunk;
        remaining -= value.length;
        if (!process.stdout.write(value)) return process.stdout.once('drain', write);
      }
      process.stdout.end('\n\\unrestrict Abc123\n');
    };
    write();
  `;
  const consumer = overrides.consumer || `
    process.stdin.on('data', () => {
      process.stdin.pause();
      setTimeout(() => process.stdin.resume(), 1);
    });
    process.stdin.on('end', () => process.exit(0));
  `;
  return restorePg17ArchiveToPg16({
    spawnProcess: overrides.spawnProcess || createActualFixtureSpawn({ producer, consumer }),
    pgRestore: 'fixture-pg-restore',
    psql: 'fixture-psql',
    connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
    applicationUser: 'capytech_v2_user',
    databaseName: 'capytech_verify_actual_process_fixture',
    productionDatabaseName: 'capytech_pos_v2',
    dumpFile: '/synthetic/archive.dump',
    applicationEnvironment: { PATH: process.env.PATH, PGPASSWORD: 'synthetic-secret' },
    restoreTimeoutMs: overrides.restoreTimeoutMs || 5000,
    probeTimeoutMs: 2000,
    terminationGraceMs: overrides.terminationGraceMs || 100,
  });
}

test('PostgreSQL 17-to-16 mode streams exact filtered SQL in one transaction', async () => {
  const target = 'capytech_verify_1234_abcdef';
  const sql = [
    '\\restrict Abc123',
    '-- PostgreSQL database dump',
    'SET statement_timeout = 0;',
    'SET transaction_timeout = 0;',
    'SET client_encoding = \'UTF8\';',
    'CREATE FUNCTION public.fixture() RETURNS integer',
    'LANGUAGE plpgsql AS $function$',
    'BEGIN',
    'SET transaction_timeout = 0;',
    'RETURN 1;',
    'END;',
    '$function$;',
    'CREATE TABLE public.notes (value text);',
    'COPY public.notes (value) FROM stdin;',
    'SET transaction_timeout = 0;',
    '\\.',
    '\\unrestrict Abc123',
    '',
  ].join('\n');
  const mock = createMockRestoreProcesses({
    sql: [sql.slice(0, 61), sql.slice(61, 74), sql.slice(74)],
  });

  await restorePg17ArchiveToPg16({
    spawnProcess: mock.spawnProcess,
    pgRestore: '/pg17/pg_restore',
    psql: '/pg17/psql',
    connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
    applicationUser: 'capytech_v2_user',
    databaseName: target,
    productionDatabaseName: 'capytech_pos_v2',
    dumpFile: '/backup/database/capytech_pos_v2.dump',
    applicationEnvironment: {
      PATH: '/usr/local/bin:/usr/bin',
      PGPASSWORD: 'application-secret',
      PGSERVICE: 'inherited-service',
      DB_PASSWORD: 'inherited-secret',
    },
  });

  assert.deepEqual(mock.calls.map(({ command }) => command), [
    '/pg17/psql', '/pg17/psql', '/pg17/pg_restore',
  ]);
  assert.deepEqual(mock.calls[0].args, [
    '--host', '127.0.0.1', '--port', '5432',
    '--username', 'capytech_v2_user', '--dbname', target,
    '--no-psqlrc', '--no-align', '--tuples-only', '--field-separator=|',
    '--command=SELECT current_database(), current_user, current_setting(\'server_version_num\');',
  ]);
  assert.deepEqual(mock.calls[1].args, [
    '--host', '127.0.0.1', '--port', '5432',
    '--username', 'capytech_v2_user', '--dbname', target,
    '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--file=-',
  ]);
  assert.deepEqual(mock.calls[2].args, [
    '--file=-', '--exit-on-error', '--no-owner', '--no-acl',
    '/backup/database/capytech_pos_v2.dump',
  ]);
  assert.equal(mock.calls[0].options.env.PGPASSWORD, 'application-secret');
  assert.equal(mock.calls[0].options.env.PGSERVICE, undefined);
  assert.equal(mock.calls[0].options.env.DB_PASSWORD, undefined);
  assert.equal(mock.calls[1].options.env.PGPASSWORD, 'application-secret');
  assert.equal(mock.calls[2].options.env.PGPASSWORD, undefined);
  assert.equal(mock.calls[2].options.env.PGSERVICE, undefined);
  assert.equal(mock.calls[0].options.stdio[0], 'ignore');
  assert.equal(mock.calls[1].options.stdio[0], 'pipe');
  assert.equal(mock.calls[2].options.stdio[0], 'ignore');
  assert.equal(mock.getPsqlInput(), [
    'BEGIN;',
    '\\restrict Abc123',
    '-- PostgreSQL database dump',
    'SET statement_timeout = 0;',
    'SET client_encoding = \'UTF8\';',
    'CREATE FUNCTION public.fixture() RETURNS integer',
    'LANGUAGE plpgsql AS $function$',
    'BEGIN',
    'SET transaction_timeout = 0;',
    'RETURN 1;',
    'END;',
    '$function$;',
    'CREATE TABLE public.notes (value text);',
    'COPY public.notes (value) FROM stdin;',
    'SET transaction_timeout = 0;',
    '\\.',
    '\\unrestrict Abc123',
    'COMMIT;',
    '',
  ].join('\n'));
});

test('compatibility restore rejects the wrong isolated identity or server major', async () => {
  for (const probeOutput of [
    'capytech_pos_v2|capytech_v2_user|160015\n',
    'capytech_verify_1234_abcdef|administrator|160015\n',
    'capytech_verify_1234_abcdef|capytech_v2_user|170011\n',
  ]) {
    const mock = createMockRestoreProcesses({
      sql: 'SET transaction_timeout = 0;\n',
      probeOutput,
    });
    await assert.rejects(
      restorePg17ArchiveToPg16({
        spawnProcess: mock.spawnProcess,
        pgRestore: '/pg17/pg_restore',
        psql: '/pg17/psql',
        connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
        applicationUser: 'capytech_v2_user',
        databaseName: 'capytech_verify_1234_abcdef',
        productionDatabaseName: 'capytech_pos_v2',
        dumpFile: '/backup/database/capytech_pos_v2.dump',
        applicationEnvironment: { PATH: '/usr/bin', PGPASSWORD: 'application-secret' },
      }),
      /expected isolated database.*PostgreSQL 16 server/
    );
    assert.equal(mock.calls.length, 1);
  }
});

test('PostgreSQL tool versions retain major and minor security release numbers', () => {
  assert.deepEqual(parsePostgresToolVersion('pg_restore (PostgreSQL) 17.11'), {
    major: 17, minor: 11, patch: null,
  });
  assert.deepEqual(parsePostgresToolVersion('psql (PostgreSQL) 17.12.1'), {
    major: 17, minor: 12, patch: 1,
  });
  assert.equal(parsePostgresToolVersion('not a PostgreSQL version'), null);
  assert.equal(isSecurePg17Version({ major: 17, minor: 10, patch: null }), false);
  assert.equal(isSecurePg17Version({ major: 17, minor: 11, patch: null }), true);
  assert.equal(isSecurePg17Version({ major: 17, minor: 12, patch: null }), true);
  assert.equal(isSecurePg17Version({ major: 18, minor: 1, patch: null }), false);
});

test('actual child processes stream with backpressure and exit cleanly', async () => {
  await actualFixtureRestore();
});

test('actual child processes report early psql exit and broken pipe', async () => {
  await assert.rejects(
    actualFixtureRestore({
      consumer: 'process.stdin.once(\'data\', () => process.exit(3));',
    }),
    /failed before commit|compatibility restore failed|must be retained/
  );
});

test('actual child process spawn failure is detected', async () => {
  const regularSpawn = createActualFixtureSpawn({
    producer: 'process.exit(0);',
    consumer: 'process.stdin.resume(); process.stdin.on(\'end\', () => process.exit(0));',
  });
  await assert.rejects(
    actualFixtureRestore({
      spawnProcess: (command, args, options) => command === 'fixture-pg-restore'
        ? spawn('capytech-command-that-does-not-exist', [], options)
        : regularSpawn(command, args, options),
    }),
    /failed before commit|compatibility restore failed/
  );
});

test('actual child process signal termination is detected', async () => {
  await assert.rejects(
    actualFixtureRestore({
      producer: 'process.kill(process.pid, \'SIGTERM\');',
    }),
    /failed before commit|compatibility restore failed/
  );
});

test('actual child processes are terminated after a bounded timeout', async () => {
  const started = Date.now();
  await assert.rejects(
    actualFixtureRestore({
      producer: 'setInterval(() => {}, 1000);',
      restoreTimeoutMs: 100,
      terminationGraceMs: 100,
    }),
    /failed before commit|compatibility restore failed/
  );
  assert.ok(Date.now() - started < 3000);
});

test('compatibility restore rolls back and reports a pg_restore subprocess failure', async () => {
  const mock = createMockRestoreProcesses({
    sql: 'SET transaction_timeout = 0;\nCREATE TABLE public.partial (id integer);\n',
    restoreCode: 1,
  });
  await assert.rejects(
    restorePg17ArchiveToPg16({
      spawnProcess: mock.spawnProcess,
      pgRestore: '/pg17/pg_restore',
      psql: '/pg17/psql',
      connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
      applicationUser: 'capytech_v2_user',
      databaseName: 'capytech_verify_1234_abcdef',
      productionDatabaseName: 'capytech_pos_v2',
      dumpFile: '/backup/database/capytech_pos_v2.dump',
      applicationEnvironment: { PATH: '/usr/bin', PGPASSWORD: 'application-secret' },
    }),
    /failed before commit/
  );
  assert.match(mock.getPsqlInput(), /^BEGIN;\n/);
  assert.match(mock.getPsqlInput(), /ROLLBACK;\n$/);
  assert.doesNotMatch(mock.getPsqlInput(), /COMMIT;/);
});

test('compatibility restore fails closed if the exact prologue setting is absent', async () => {
  const mock = createMockRestoreProcesses({
    sql: 'SET statement_timeout = 0;\nCREATE TABLE public.safe (id integer);\n',
  });
  await assert.rejects(
    restorePg17ArchiveToPg16({
      spawnProcess: mock.spawnProcess,
      pgRestore: '/pg17/pg_restore',
      psql: '/pg17/psql',
      connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
      applicationUser: 'capytech_v2_user',
      databaseName: 'capytech_verify_1234_abcdef',
      productionDatabaseName: 'capytech_pos_v2',
      dumpFile: '/backup/database/capytech_pos_v2.dump',
      applicationEnvironment: { PATH: '/usr/bin', PGPASSWORD: 'application-secret' },
    }),
    /expected exactly one.*found 0/
  );
  assert.match(mock.getPsqlInput(), /ROLLBACK;\n$/);
  assert.doesNotMatch(mock.getPsqlInput(), /COMMIT;/);
});

test('compatibility restore fails closed for repeated prologue settings', async () => {
  const mock = createMockRestoreProcesses({
    sql: [
      'SET transaction_timeout = 0;',
      'SET transaction_timeout = 0;',
      'CREATE TABLE public.safe (id integer);',
      '',
    ].join('\n'),
  });
  await assert.rejects(
    restorePg17ArchiveToPg16({
      spawnProcess: mock.spawnProcess,
      pgRestore: '/pg17/pg_restore',
      psql: '/pg17/psql',
      connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
      applicationUser: 'capytech_v2_user',
      databaseName: 'capytech_verify_1234_abcdef',
      productionDatabaseName: 'capytech_pos_v2',
      dumpFile: '/backup/database/capytech_pos_v2.dump',
      applicationEnvironment: { PATH: '/usr/bin', PGPASSWORD: 'application-secret' },
    }),
    /expected exactly one.*found 2/
  );
  assert.match(mock.getPsqlInput(), /ROLLBACK;\n$/);
});

test('compatibility restore treats a nonzero psql exit as a failed restore', async () => {
  const mock = createMockRestoreProcesses({
    sql: 'SET transaction_timeout = 0;\nCREATE TABLE public.safe (id integer);\n',
    psqlCode: 3,
  });
  await assert.rejects(
    restorePg17ArchiveToPg16({
      spawnProcess: mock.spawnProcess,
      pgRestore: '/pg17/pg_restore',
      psql: '/pg17/psql',
      connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
      applicationUser: 'capytech_v2_user',
      databaseName: 'capytech_verify_1234_abcdef',
      productionDatabaseName: 'capytech_pos_v2',
      dumpFile: '/backup/database/capytech_pos_v2.dump',
      applicationEnvironment: { PATH: '/usr/bin', PGPASSWORD: 'application-secret' },
    }),
    /must be retained/
  );
});

test('compatibility restore refuses live targets before spawning subprocesses', async () => {
  for (const target of ['capytech_pos_v2', 'pos_store']) {
    let spawned = false;
    await assert.rejects(
      restorePg17ArchiveToPg16({
        spawnProcess: () => { spawned = true; },
        pgRestore: '/pg17/pg_restore',
        psql: '/pg17/psql',
        connectionArgs: ['--host', '127.0.0.1', '--port', '5432'],
        applicationUser: 'capytech_v2_user',
        databaseName: target,
        productionDatabaseName: 'capytech_pos_v2',
        dumpFile: '/backup/database/capytech_pos_v2.dump',
        applicationEnvironment: { PATH: '/usr/bin', PGPASSWORD: 'application-secret' },
      }),
      /safety-scoped|must not be the production database/
    );
    assert.equal(spawned, false);
  }
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

test('PostgreSQL 17-to-16 compatibility mode is explicit and administrator-assisted only', () => {
  const args = parseArguments([
    '--backup', './backup',
    '--admin-assisted',
    '--admin-user', 'phyowaiaung',
    '--pg17-to-pg16-compat',
  ]);
  assert.equal(args.pg17ToPg16Compat, true);
  assert.throws(
    () => parseArguments(['--backup', './backup', '--pg17-to-pg16-compat']),
    /requires administrator-assisted verification/
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

test('existing receipts are preserved and block a later rehearsal', () => {
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capytech-receipt-test-'));
  const receiptFile = path.join(backupRoot, 'RESTORE-VERIFIED.json');
  const original = '{"protectedDataMatched":true}\n';
  try {
    fs.writeFileSync(receiptFile, original, 'utf8');
    assert.throws(
      () => beginVerificationAttempt(backupRoot),
      /already has RESTORE-VERIFIED\.json/
    );
    assert.equal(fs.readFileSync(receiptFile, 'utf8'), original);
  } finally {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
});

test('verification attempts and receipt creation are exclusive', () => {
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capytech-lock-test-'));
  let firstAttempt;
  try {
    firstAttempt = beginVerificationAttempt(backupRoot);
    assert.throws(
      () => beginVerificationAttempt(backupRoot),
      /already active/
    );
    writeVerificationReceiptExclusive(firstAttempt.receiptFile, { verified: true });
    assert.throws(
      () => writeVerificationReceiptExclusive(firstAttempt.receiptFile, { verified: false }),
      { code: 'EEXIST' }
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(firstAttempt.receiptFile, 'utf8')), {
      verified: true,
    });
  } finally {
    firstAttempt?.release();
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
});

test('failure before completion never writes a success receipt', async () => {
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capytech-failure-receipt-test-'));
  try {
    await assert.rejects(
      runExclusiveVerificationAttempt(backupRoot, async () => {
        throw new Error('restore failed before COMMIT');
      }),
      /failed before COMMIT/
    );
    assert.equal(fs.existsSync(path.join(backupRoot, 'RESTORE-VERIFIED.json')), false);
    const retry = beginVerificationAttempt(backupRoot);
    retry.release();
  } finally {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
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
