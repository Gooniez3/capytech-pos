import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertDataManifestEqual,
  assertMigrationDataPreserved,
  assertSafeVerificationDatabase,
  loadEnv,
  verifyChecksumManifest,
} from './lib/backup-safety.mjs';
import {
  assertPhase2BMigrationInitialState,
  assertPhase3AMigrationInitialState,
  assertPhase3DMigrationInitialState,
  assertHistoricalSalesMigrationInitialState,
  captureProductionDataManifest,
} from './lib/production-data.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const USAGE = 'Usage: node scripts/verify-backup.mjs --backup <backup-folder> [--test-migrations] [--keep-database] [--admin-assisted --admin-user <role>]';
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const LIVE_DATABASES = new Set(['capytech_pos_v2', 'pos_store']);

export function assertDatabaseIdentifier(value, label = 'Database name') {
  if (!IDENTIFIER_PATTERN.test(String(value || ''))) {
    throw new Error(`${label} is not a safe PostgreSQL identifier.`);
  }
  return value;
}

export function assertRoleIdentifier(value, label = 'Database role') {
  if (!IDENTIFIER_PATTERN.test(String(value || ''))) {
    throw new Error(`${label} is not a safe PostgreSQL identifier.`);
  }
  return value;
}

export function parseArguments(args) {
  const parsed = {
    backup: null,
    keepDatabase: false,
    testMigrations: false,
    adminAssisted: false,
    adminUser: null,
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (seen.has(option)) throw new Error(`Duplicate restore-verification option: ${option}`);
    seen.add(option);
    if (option === '--backup' || option === '--admin-user') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      if (option === '--backup') parsed.backup = path.resolve(value);
      else parsed.adminUser = assertRoleIdentifier(value, 'Administrator role');
      index += 1;
    } else if (option === '--test-migrations') {
      parsed.testMigrations = true;
    } else if (option === '--keep-database') {
      parsed.keepDatabase = true;
    } else if (option === '--admin-assisted') {
      parsed.adminAssisted = true;
    } else {
      throw new Error(`Unknown restore-verification option: ${option || '(empty)'}`);
    }
  }
  if (!parsed.backup) throw new Error(USAGE);
  if (parsed.adminAssisted !== Boolean(parsed.adminUser)) {
    throw new Error('--admin-assisted and --admin-user <role> must be supplied together.');
  }
  return parsed;
}

export function resolveDatabaseActors(args, env) {
  const applicationUser = assertRoleIdentifier(env.DB_USER, 'Application database role');
  assertDatabaseIdentifier(env.DB_NAME, 'Production database name');
  if (
    args.adminAssisted
    && (
      env.DB_NAME !== 'capytech_pos_v2'
      || applicationUser !== 'capytech_v2_user'
      || !['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)
      || String(env.DB_PORT) !== '5432'
    )
  ) {
    throw new Error(
      'Administrator-assisted verification requires the local CapyTech v2 database and restricted role.'
    );
  }
  if (args.adminAssisted && args.adminUser === applicationUser) {
    throw new Error('Administrator role must be different from the restricted application role.');
  }
  return {
    applicationUser,
    lifecycleUser: args.adminAssisted ? args.adminUser : applicationUser,
    adminAssisted: args.adminAssisted,
  };
}

export async function runVerificationLifecycle({
  createDatabase,
  verifyDatabase,
  dropDatabase,
  keepDatabase = false,
  onRetained = () => {},
}) {
  let created = false;
  let verified = false;
  try {
    await createDatabase();
    created = true;
    await verifyDatabase();
    verified = true;
  } finally {
    if (created && verified && !keepDatabase) {
      try {
        await dropDatabase();
      } catch (error) {
        onRetained();
        throw error;
      }
    } else if (created) {
      onRetained();
    }
  }
  return { created, verified, removed: !keepDatabase };
}

export function environmentWithoutPostgresVariables(environment = process.env) {
  const databaseKeys = new Set([
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
  ]);
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => {
      const normalized = key.toUpperCase();
      return !normalized.startsWith('PG') && !databaseKeys.has(normalized);
    })
  );
}

export function applicationCommandEnvironment(env, environment = process.env) {
  return {
    ...environmentWithoutPostgresVariables(environment),
    PGPASSWORD: env.DB_PASSWORD,
  };
}

export function migrationCommandEnvironment(env, databaseName, environment = process.env) {
  return {
    ...environmentWithoutPostgresVariables(environment),
    DB_HOST: env.DB_HOST,
    DB_PORT: env.DB_PORT,
    DB_NAME: databaseName,
    DB_USER: env.DB_USER,
    DB_PASSWORD: env.DB_PASSWORD,
  };
}

export async function runVerificationDatabaseCommands({
  runCommand,
  tools,
  connectionArgs,
  actors,
  databaseName,
  productionDatabaseName,
  dumpFile,
  administratorEnvironment,
  applicationEnvironment,
  keepDatabase,
  verifyDatabase,
  onRemoved = () => {},
  onRetained = () => {},
}) {
  assertSafeVerificationDatabase(databaseName, productionDatabaseName);
  if (LIVE_DATABASES.has(databaseName)) {
    throw new Error('Verification database must never be a live CapyTech database.');
  }
  const administratorOptions = {
    env: administratorEnvironment,
    replaceEnv: true,
    interactive: actors.adminAssisted,
  };
  const applicationOptions = {
    env: applicationEnvironment,
    replaceEnv: true,
  };
  return runVerificationLifecycle({
    keepDatabase,
    createDatabase: () => runCommand(
      tools.createdb,
      [
        ...connectionArgs,
        '--username', actors.lifecycleUser,
        '--maintenance-db', 'postgres',
        '--owner', actors.applicationUser,
        databaseName,
      ],
      administratorOptions
    ),
    verifyDatabase: async () => {
      await runCommand(tools.pgRestore, [
        ...connectionArgs,
        '--username', actors.applicationUser,
        '--dbname', databaseName,
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-acl',
        dumpFile,
      ], applicationOptions);
      await verifyDatabase();
    },
    dropDatabase: async () => {
      await runCommand(
        tools.dropdb,
        [
          ...connectionArgs,
          '--username', actors.lifecycleUser,
          '--maintenance-db', 'postgres',
          '--if-exists', databaseName,
        ],
        administratorOptions
      );
      onRemoved();
    },
    onRetained,
  });
}

export function verificationReceipt(databaseName, testMigrations, lifecycle) {
  return {
    verifiedAt: new Date().toISOString(),
    isolatedDatabase: databaseName,
    protectedDataMatched: true,
    imageReferencesMatched: true,
    migrationsTested: testMigrations,
    isolatedDatabaseCleanup: lifecycle.removed ? 'removed' : 'retained-by-request',
  };
}

function commandOnPath(name) {
  const result = spawnSync(isWindows ? 'where' : 'which', [name], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0
    ? String(result.stdout).split(/\r?\n/).map((value) => value.trim()).find(Boolean)
    : null;
}

function findTool(name) {
  const executable = isWindows ? `${name}.exe` : name;
  const candidates = [commandOnPath(executable)];
  if (isWindows) {
    for (const version of [18, 17, 16, 15, 14]) {
      candidates.push(`C:\\Program Files\\PostgreSQL\\${version}\\bin\\${executable}`);
    }
  } else {
    for (const prefix of ['/opt/homebrew', '/usr/local']) {
      candidates.push(path.join(prefix, 'bin', executable));
      for (const version of [18, 17, 16, 15, 14]) {
        candidates.push(path.join(prefix, 'opt', `postgresql@${version}`, 'bin', executable));
      }
    }
    candidates.push(`/Applications/Postgres.app/Contents/Versions/latest/bin/${executable}`);
  }
  return candidates.filter(Boolean).find((candidate) => fs.existsSync(candidate)) || null;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: options.replaceEnv ? options.env : { ...process.env, ...(options.env || {}) },
      stdio: options.interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    if (!options.interactive) {
      child.stdout.on('data', (value) => { output += value; });
      child.stderr.on('data', (value) => { output += value; });
    }
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output.trim() || `Command failed: ${command}`));
    });
  });
}

function findDump(databaseDir) {
  const dumps = fs.readdirSync(databaseDir).filter((name) => name.endsWith('.dump'));
  if (dumps.length !== 1) throw new Error('Backup must contain exactly one database dump.');
  return path.join(databaseDir, dumps[0]);
}

function assertImagesPresent(backupRoot, references) {
  const imagesRoot = path.resolve(backupRoot, 'product-images');
  for (const reference of references) {
    const relative = String(reference.image_path || '').replace(/\\/g, '/');
    const filePath = path.resolve(imagesRoot, ...relative.split('/'));
    const boundary = path.relative(imagesRoot, filePath);
    if (!relative || boundary.startsWith('..') || path.isAbsolute(boundary) || !fs.existsSync(filePath)) {
      throw new Error(`Referenced product image is missing from backup: ${relative || '(empty path)'}`);
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const completeFile = path.join(args.backup, 'BACKUP-COMPLETE.json');
  if (!fs.existsSync(completeFile)) throw new Error('Backup is incomplete; completion marker is missing.');
  verifyChecksumManifest(args.backup);

  const envFile = path.join(args.backup, 'configuration', 'backend.env');
  const manifestFile = path.join(args.backup, 'database', 'protected-data-manifest.json');
  if (!fs.existsSync(envFile) || !fs.existsSync(manifestFile)) {
    throw new Error('Backup configuration or protected-data manifest is missing.');
  }
  const env = loadEnv(envFile);
  const actors = resolveDatabaseActors(args, env);
  const expected = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assertImagesPresent(args.backup, expected.imageReferences);

  const pgRestore = findTool('pg_restore');
  const createdb = findTool('createdb');
  const dropdb = findTool('dropdb');
  if (!pgRestore || !createdb || !dropdb) throw new Error('PostgreSQL restore tools are required.');

  const databaseName = assertSafeVerificationDatabase(
    `capytech_verify_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    env.DB_NAME
  );
  const connectionArgs = ['--host', env.DB_HOST, '--port', env.DB_PORT];
  const applicationEnvironment = applicationCommandEnvironment(env);
  const administratorEnvironment = actors.adminAssisted
    ? environmentWithoutPostgresVariables()
    : applicationEnvironment;

  const lifecycle = await runVerificationDatabaseCommands({
    runCommand: run,
    tools: { createdb, pgRestore, dropdb },
    connectionArgs,
    actors,
    databaseName,
    productionDatabaseName: env.DB_NAME,
    dumpFile: findDump(path.join(args.backup, 'database')),
    administratorEnvironment,
    applicationEnvironment,
    keepDatabase: args.keepDatabase,
    verifyDatabase: async () => {
    const requireFromBackend = createRequire(path.join(projectRoot, 'backend', 'package.json'));
    const { Client } = requireFromBackend('pg');
    const client = new Client({
      host: env.DB_HOST,
      port: Number(env.DB_PORT),
      database: databaseName,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      options: '-c default_transaction_read_only=on -c statement_timeout=60000',
    });
    await client.connect();
    let actual;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      actual = await captureProductionDataManifest(client, {
        comparisonManifest: expected,
      });
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
    assertDataManifestEqual(expected, actual);

    if (args.testMigrations) {
      const npm = isWindows ? 'npm.cmd' : 'npm';
      await run(
        npm,
        ['run', 'migrate:up', '--', '--database', databaseName],
        {
          env: migrationCommandEnvironment(env, databaseName),
          replaceEnv: true,
          cwd: path.join(projectRoot, 'backend'),
        }
      );

      const migratedClient = new Client({
        host: env.DB_HOST,
        port: Number(env.DB_PORT),
        database: databaseName,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        options: '-c default_transaction_read_only=on -c statement_timeout=60000',
      });
      await migratedClient.connect();
      try {
        const column = await migratedClient.query(`
          SELECT is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'sales'
            AND column_name = 'warranty_months'
        `);
        if (
          column.rows.length !== 1 ||
          column.rows[0].is_nullable !== 'YES' ||
          column.rows[0].column_default !== null
        ) {
          throw new Error('Warranty migration did not create the expected nullable, default-free column.');
        }
        const afterMigration = await captureProductionDataManifest(migratedClient, {
          comparisonManifest: expected,
        });
        assertMigrationDataPreserved(expected, afterMigration);
        if (!expected.protectedShape?.tables?.stock_units) {
          await assertPhase2BMigrationInitialState(migratedClient);
        }
        if (!expected.protectedShape?.tables?.inventory_movements) {
          await assertPhase3AMigrationInitialState(migratedClient);
        }
        if (!expected.protectedShape?.tables?.inventory_receipts) {
          await assertPhase3DMigrationInitialState(migratedClient);
        }
        if (!expected.protectedShape?.tables?.historical_sales_archives) {
          await assertHistoricalSalesMigrationInitialState(migratedClient);
        }
        await captureProductionDataManifest(migratedClient);
      } finally {
        await migratedClient.end();
      }
    }
    },
    onRemoved: () => {
      console.log('Removed the verified isolated database. Production was never modified.');
    },
    onRetained: () => {
      console.log(`Verification database retained for inspection: ${databaseName}`);
    },
  });
  fs.writeFileSync(
    path.join(args.backup, 'RESTORE-VERIFIED.json'),
    `${JSON.stringify(verificationReceipt(databaseName, args.testMigrations, lifecycle), null, 2)}\n`,
    'utf8'
  );
  console.log(`Restore verification passed in isolated database ${databaseName}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Backup restore verification failed.');
    process.exitCode = 1;
  });
}
