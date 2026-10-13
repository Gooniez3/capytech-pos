import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  captureProductionDataManifest,
} from './lib/production-data.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function parseArguments(args) {
  const backupIndex = args.indexOf('--backup');
  if (backupIndex < 0 || !args[backupIndex + 1]) {
    throw new Error('Usage: node scripts/verify-backup.mjs --backup <backup-folder> [--test-migrations] [--keep-database]');
  }
  const allowed = new Set(['--backup', args[backupIndex + 1], '--test-migrations', '--keep-database']);
  if (args.some((value) => !allowed.has(value))) throw new Error('Unknown restore-verification option.');
  return {
    backup: path.resolve(args[backupIndex + 1]),
    keepDatabase: args.includes('--keep-database'),
    testMigrations: args.includes('--test-migrations'),
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
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (value) => { output += value; });
    child.stderr.on('data', (value) => { output += value; });
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

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const completeFile = path.join(args.backup, 'BACKUP-COMPLETE.json');
  if (!fs.existsSync(completeFile)) throw new Error('Backup is incomplete; completion marker is missing.');
  verifyChecksumManifest(args.backup);

  const envFile = path.join(args.backup, 'configuration', 'backend.env');
  const manifestFile = path.join(args.backup, 'database', 'protected-data-manifest.json');
  if (!fs.existsSync(envFile) || !fs.existsSync(manifestFile)) {
    throw new Error('Backup configuration or protected-data manifest is missing.');
  }
  const env = loadEnv(envFile);
  const expected = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assertImagesPresent(args.backup, expected.imageReferences);

  const pgRestore = findTool('pg_restore');
  const createdb = findTool('createdb');
  const dropdb = findTool('dropdb');
  if (!pgRestore || !createdb || !dropdb) throw new Error('PostgreSQL restore tools are required.');

  const databaseName = assertSafeVerificationDatabase(
    `capytech_verify_${Date.now()}`,
    env.DB_NAME
  );
  const connectionArgs = ['--host', env.DB_HOST, '--port', env.DB_PORT];
  const passwordEnv = { PGPASSWORD: env.DB_PASSWORD };
  let created = false;
  let verified = false;

  try {
    await run(
      createdb,
      [...connectionArgs, '--username', env.DB_USER, '--owner', env.DB_USER, databaseName],
      { env: passwordEnv }
    );
    created = true;
    await run(pgRestore, [
      ...connectionArgs,
      '--username', env.DB_USER,
      '--dbname', databaseName,
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-acl',
      findDump(path.join(args.backup, 'database')),
    ], { env: passwordEnv });

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
          env: {
            DB_HOST: env.DB_HOST,
            DB_PORT: env.DB_PORT,
            DB_NAME: databaseName,
            DB_USER: env.DB_USER,
            DB_PASSWORD: env.DB_PASSWORD,
          },
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
        await captureProductionDataManifest(migratedClient);
      } finally {
        await migratedClient.end();
      }
    }
    verified = true;

    fs.writeFileSync(
      path.join(args.backup, 'RESTORE-VERIFIED.json'),
      `${JSON.stringify({
        verifiedAt: new Date().toISOString(),
        isolatedDatabase: databaseName,
        protectedDataMatched: true,
        imageReferencesMatched: true,
        migrationsTested: args.testMigrations,
      }, null, 2)}\n`,
      'utf8'
    );
    console.log(`Restore verification passed in isolated database ${databaseName}.`);
  } finally {
    if (created && verified && !args.keepDatabase) {
      await run(
        dropdb,
        [...connectionArgs, '--username', env.DB_USER, '--if-exists', databaseName],
        { env: passwordEnv }
      );
      console.log('Removed the verified isolated database. Production was never modified.');
    } else if (created) {
      console.log(`Verification database retained for inspection: ${databaseName}`);
    }
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Backup restore verification failed.');
  process.exitCode = 1;
});
