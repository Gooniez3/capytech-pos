import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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

const USAGE = 'Usage: node scripts/verify-backup.mjs --backup <backup-folder> [--test-migrations] [--keep-database] [--admin-assisted --admin-user <role> [--pg17-to-pg16-compat]]';
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const LIVE_DATABASES = new Set(['capytech_pos_v2', 'pos_store']);
const UNSUPPORTED_PG17_SETTING = Buffer.from('SET transaction_timeout = 0;');
const MAX_RESTORE_PROLOGUE_LINE_BYTES = 1024 * 1024;
const DEFAULT_RESTORE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_TERMINATION_GRACE_MS = 5 * 1000;

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
    pg17ToPg16Compat: false,
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
    } else if (option === '--pg17-to-pg16-compat') {
      parsed.pg17ToPg16Compat = true;
    } else {
      throw new Error(`Unknown restore-verification option: ${option || '(empty)'}`);
    }
  }
  if (!parsed.backup) throw new Error(USAGE);
  if (parsed.adminAssisted !== Boolean(parsed.adminUser)) {
    throw new Error('--admin-assisted and --admin-user <role> must be supplied together.');
  }
  if (parsed.pg17ToPg16Compat && !parsed.adminAssisted) {
    throw new Error('--pg17-to-pg16-compat requires administrator-assisted verification.');
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

export function beginVerificationAttempt(backupRoot) {
  const canonicalRoot = fs.realpathSync(backupRoot);
  const receiptFile = path.join(canonicalRoot, 'RESTORE-VERIFIED.json');
  if (fs.existsSync(receiptFile)) {
    throw new Error('Backup already has RESTORE-VERIFIED.json; refusing to start another rehearsal.');
  }
  const lockKey = crypto.createHash('sha256')
    .update(isWindows ? canonicalRoot.toLowerCase() : canonicalRoot)
    .digest('hex');
  const lockFile = path.join(os.tmpdir(), `capytech-restore-verify-${lockKey}.lock`);
  let descriptor;
  try {
    descriptor = fs.openSync(lockFile, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error?.code === 'EEXIST') {
      throw new Error('Another restore verification attempt is already active for this backup.');
    }
    throw error;
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    fs.closeSync(descriptor);
    fs.unlinkSync(lockFile);
  };
  if (fs.existsSync(receiptFile)) {
    release();
    throw new Error('Backup already has RESTORE-VERIFIED.json; refusing to start another rehearsal.');
  }
  return { receiptFile, release };
}

export function writeVerificationReceiptExclusive(receiptFile, receipt) {
  const temporaryFile = path.join(
    path.dirname(receiptFile),
    `.RESTORE-VERIFIED.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporaryFile, receiptFile);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
}

export async function runExclusiveVerificationAttempt(backupRoot, verify) {
  const attempt = beginVerificationAttempt(backupRoot);
  try {
    const result = await verify();
    writeVerificationReceiptExclusive(attempt.receiptFile, result.receipt);
    return result;
  } finally {
    attempt.release();
  }
}

export function createPg17ToPg16RestoreFilter() {
  let pending = Buffer.alloc(0);
  let inPrologue = true;
  let removed = 0;

  const filterLine = (stream, line) => {
    const hasLineFeed = line.at(-1) === 0x0a;
    let contentEnd = hasLineFeed ? line.length - 1 : line.length;
    if (contentEnd > 0 && line[contentEnd - 1] === 0x0d) contentEnd -= 1;
    const content = line.subarray(0, contentEnd);

    if (inPrologue && content.equals(UNSUPPORTED_PG17_SETTING)) {
      removed += 1;
      return;
    }

    if (inPrologue) {
      const text = content.toString('utf8');
      const isPrologueLine = text === ''
        || text.startsWith('--')
        || text.startsWith('\\')
        || text.startsWith('SET ')
        || text.startsWith('SELECT pg_catalog.set_config(');
      if (!isPrologueLine) inPrologue = false;
    }
    stream.push(line);
  };

  return new Transform({
    transform(chunk, _encoding, callback) {
      if (!inPrologue) {
        this.push(chunk);
        callback();
        return;
      }
      pending = Buffer.concat([pending, Buffer.from(chunk)]);
      let newline;
      while ((newline = pending.indexOf(0x0a)) !== -1) {
        const line = pending.subarray(0, newline + 1);
        pending = pending.subarray(newline + 1);
        filterLine(this, line);
        if (!inPrologue) {
          if (pending.length > 0) this.push(pending);
          pending = Buffer.alloc(0);
          break;
        }
      }
      if (inPrologue && pending.length > MAX_RESTORE_PROLOGUE_LINE_BYTES) {
        callback(new Error('Compatibility restore prologue exceeded the safe line-length limit.'));
        return;
      }
      callback();
    },
    flush(callback) {
      if (pending.length > 0) filterLine(this, pending);
      if (removed !== 1) {
        callback(new Error(
          `Compatibility restore expected exactly one PostgreSQL 17 transaction_timeout setting; found ${removed}.`
        ));
        return;
      }
      callback();
    },
  });
}

function monitorChild(child, {
  timeoutMs,
  terminationGraceMs,
}) {
  let timeout;
  let forceTimeout;
  let completed = false;
  let timedOut = false;
  let terminating = false;
  const terminate = () => {
    if (completed || terminating) return;
    terminating = true;
    try {
      child.kill('SIGTERM');
    } catch {
      // The close/error event remains authoritative.
    }
    forceTimeout = setTimeout(() => {
      if (!completed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // A missing close event will keep the operation failed, never verified.
        }
      }
    }, terminationGraceMs);
  };
  const completion = new Promise((resolve) => {
    const finish = (result) => {
      if (!completed) {
        completed = true;
        clearTimeout(timeout);
        clearTimeout(forceTimeout);
        resolve({ ...result, timedOut });
      }
    };
    child.once('error', () => finish({ code: null, failedToStart: true }));
    child.once('close', (code, signal) => finish({ code, signal, failedToStart: false }));
  });
  timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  return { completion, terminate };
}

function writeToChild(input, value, end = false) {
  return new Promise((resolve, reject) => {
    const done = (error) => error ? reject(error) : resolve();
    if (end) input.end(value, done);
    else input.write(value, done);
  });
}

export async function restorePg17ArchiveToPg16({
  spawnProcess = spawn,
  pgRestore,
  psql,
  connectionArgs,
  applicationUser,
  databaseName,
  productionDatabaseName,
  dumpFile,
  applicationEnvironment,
  restoreTimeoutMs = DEFAULT_RESTORE_TIMEOUT_MS,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
}) {
  assertSafeVerificationDatabase(databaseName, productionDatabaseName);
  if (LIVE_DATABASES.has(databaseName)) {
    throw new Error('Compatibility restore target must never be a live CapyTech database.');
  }
  assertRoleIdentifier(applicationUser, 'Application database role');

  const sanitizedEnvironment = environmentWithoutPostgresVariables(applicationEnvironment);
  const applicationProcessEnvironment = {
    ...sanitizedEnvironment,
    PGPASSWORD: applicationEnvironment.PGPASSWORD,
  };
  const processOptions = {
    cwd: projectRoot,
    env: applicationProcessEnvironment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  };
  const probeChild = spawnProcess(psql, [
    ...connectionArgs,
    '--username', applicationUser,
    '--dbname', databaseName,
    '--no-psqlrc',
    '--no-align',
    '--tuples-only',
    '--field-separator=|',
    '--command=SELECT current_database(), current_user, current_setting(\'server_version_num\');',
  ], {
    ...processOptions,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const probeMonitor = monitorChild(probeChild, {
    timeoutMs: probeTimeoutMs,
    terminationGraceMs,
  });
  let probeOutput = '';
  let probeOverflow = false;
  probeChild.stdout.on('data', (chunk) => {
    if (!probeOverflow) probeOutput += chunk.toString('utf8');
    if (probeOutput.length > 1024) {
      probeOverflow = true;
      probeOutput = '';
      probeChild.stdout.destroy();
      probeMonitor.terminate();
    }
  });
  probeChild.stderr.resume();
  const probeResult = await probeMonitor.completion;
  const identity = probeOutput.trim().split('|');
  const serverVersionNumber = /^\d+$/.test(identity[2] || '') ? Number(identity[2]) : 0;
  if (
    probeOverflow
    || probeResult.failedToStart
    || probeResult.timedOut
    || probeResult.code !== 0
    || identity.length !== 3
    || identity[0] !== databaseName
    || identity[1] !== applicationUser
    || Math.floor(serverVersionNumber / 10000) !== 16
  ) {
    throw new Error('Compatibility restore requires the expected isolated database, application role, and PostgreSQL 16 server.');
  }

  const psqlChild = spawnProcess(psql, [
    ...connectionArgs,
    '--username', applicationUser,
    '--dbname', databaseName,
    '--no-psqlrc',
    '--set', 'ON_ERROR_STOP=1',
    '--file=-',
  ], processOptions);
  const psqlMonitor = monitorChild(psqlChild, {
    timeoutMs: restoreTimeoutMs,
    terminationGraceMs,
  });
  const psqlCompletion = psqlMonitor.completion;
  psqlChild.stdin.on('error', () => {});
  psqlChild.stdout.resume();
  psqlChild.stderr.resume();

  let pgRestoreChild;
  let pgRestoreCompletion;
  let pgRestoreMonitor;
  let commitAttempted = false;
  try {
    await writeToChild(psqlChild.stdin, 'BEGIN;\n');
    pgRestoreChild = spawnProcess(pgRestore, [
      '--file=-',
      '--exit-on-error',
      '--no-owner',
      '--no-acl',
      dumpFile,
    ], {
      ...processOptions,
      env: sanitizedEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pgRestoreMonitor = monitorChild(pgRestoreChild, {
      timeoutMs: restoreTimeoutMs,
      terminationGraceMs,
    });
    pgRestoreCompletion = pgRestoreMonitor.completion;
    pgRestoreChild.stderr.resume();

    const filter = createPg17ToPg16RestoreFilter();
    const [pipelineResult, restoreResult] = await Promise.all([
      pipeline(pgRestoreChild.stdout, filter, psqlChild.stdin, { end: false })
        .then(() => ({ error: null }), (pipelineError) => {
          pgRestoreMonitor.terminate();
          return { error: pipelineError };
        }),
      pgRestoreCompletion,
    ]);
    if (restoreResult.failedToStart || restoreResult.timedOut || restoreResult.code !== 0) {
      throw new Error('PostgreSQL 17 archive conversion failed before commit.');
    }
    if (pipelineResult.error) throw pipelineResult.error;

    commitAttempted = true;
    await writeToChild(psqlChild.stdin, 'COMMIT;\n', true);
    const psqlResult = await psqlCompletion;
    if (psqlResult.failedToStart || psqlResult.timedOut || psqlResult.code !== 0) {
      throw new Error('PostgreSQL SQL execution did not confirm success; the isolated database must be retained.');
    }
  } catch (error) {
    pgRestoreMonitor?.terminate();
    if (!psqlChild.stdin.destroyed && !psqlChild.stdin.writableEnded) {
      try {
        await writeToChild(psqlChild.stdin, 'ROLLBACK;\n', true);
      } catch {
        psqlChild.stdin.destroy();
      }
    }
    await Promise.allSettled([
      pgRestoreCompletion || Promise.resolve(),
      psqlCompletion,
    ]);
    if (commitAttempted) {
      throw new Error('PostgreSQL commit outcome was not confirmed; the isolated database must be retained.');
    }
    if (error instanceof Error && /Compatibility restore expected/.test(error.message)) throw error;
    if (error instanceof Error && /before commit|must be retained/.test(error.message)) throw error;
    throw new Error('PostgreSQL 17-to-16 compatibility restore failed; the transaction was rolled back.');
  }
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
  restoreDatabase,
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
      if (restoreDatabase) {
        await restoreDatabase();
      } else {
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
      }
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

export function parsePostgresToolVersion(output) {
  const match = String(output || '').match(/\b(\d+)\.(\d+)(?:\.(\d+))?\b/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? null : Number(match[3]),
  };
}

export function isSecurePg17Version(version) {
  return Boolean(version && version.major === 17 && version.minor >= 11);
}

function postgresToolVersion(candidate) {
  const result = spawnSync(candidate, ['--version'], {
    encoding: 'utf8',
    env: environmentWithoutPostgresVariables(),
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  return result.status === 0 ? parsePostgresToolVersion(result.stdout) : null;
}

function toolCandidates(name) {
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
    for (const version of [18, 17, 16, 15, 14]) {
      candidates.push(`/Applications/Postgres.app/Contents/Versions/${version}/bin/${executable}`);
    }
  }
  return [...new Set(candidates.filter(Boolean))];
}

function findTool(name, requiredMajor = null) {
  return toolCandidates(name).find((candidate) => {
    if (!fs.existsSync(candidate)) return false;
    const version = postgresToolVersion(candidate);
    return requiredMajor === null || version?.major === requiredMajor;
  }) || null;
}

function findSecurePg17RestoreTools() {
  const psqlExecutable = isWindows ? 'psql.exe' : 'psql';
  for (const candidate of toolCandidates('pg_restore')) {
    if (!fs.existsSync(candidate)) continue;
    let pgRestore;
    try {
      pgRestore = fs.realpathSync(candidate);
    } catch {
      continue;
    }
    const normalizedRestore = path.normalize(pgRestore).toLowerCase();
    const trustedRoots = isWindows
      ? [path.normalize('C:\\Program Files\\PostgreSQL\\').toLowerCase()]
      : ['/opt/homebrew/', '/usr/local/', '/applications/postgres.app/'];
    if (!trustedRoots.some((root) => normalizedRestore.startsWith(root))) continue;
    const pgRestoreVersion = postgresToolVersion(pgRestore);
    if (!isSecurePg17Version(pgRestoreVersion)) continue;

    const psqlCandidate = path.join(path.dirname(pgRestore), psqlExecutable);
    if (!fs.existsSync(psqlCandidate)) continue;
    let psql;
    try {
      psql = fs.realpathSync(psqlCandidate);
    } catch {
      continue;
    }
    if (path.dirname(psql) !== path.dirname(pgRestore)) continue;
    const psqlVersion = postgresToolVersion(psql);
    if (
      !psqlVersion
      || psqlVersion.major !== pgRestoreVersion.major
      || psqlVersion.minor !== pgRestoreVersion.minor
      || psqlVersion.patch !== pgRestoreVersion.patch
    ) continue;
    return { pgRestore, psql, version: pgRestoreVersion };
  }
  return null;
}

function findTrustedPg16LifecycleTools() {
  const dropdbExecutable = isWindows ? 'dropdb.exe' : 'dropdb';
  for (const candidate of toolCandidates('createdb')) {
    if (!fs.existsSync(candidate)) continue;
    let createdb;
    try {
      createdb = fs.realpathSync(candidate);
    } catch {
      continue;
    }
    const normalizedCreatedb = path.normalize(createdb).toLowerCase();
    const trustedRoots = isWindows
      ? [path.normalize('C:\\Program Files\\PostgreSQL\\').toLowerCase()]
      : ['/opt/homebrew/', '/usr/local/', '/applications/postgres.app/'];
    if (!trustedRoots.some((root) => normalizedCreatedb.startsWith(root))) continue;
    const createdbVersion = postgresToolVersion(createdb);
    if (createdbVersion?.major !== 16) continue;

    const dropdbCandidate = path.join(path.dirname(createdb), dropdbExecutable);
    if (!fs.existsSync(dropdbCandidate)) continue;
    let dropdb;
    try {
      dropdb = fs.realpathSync(dropdbCandidate);
    } catch {
      continue;
    }
    if (path.dirname(dropdb) !== path.dirname(createdb)) continue;
    const dropdbVersion = postgresToolVersion(dropdb);
    if (
      !dropdbVersion
      || dropdbVersion.major !== createdbVersion.major
      || dropdbVersion.minor !== createdbVersion.minor
      || dropdbVersion.patch !== createdbVersion.patch
    ) continue;
    return { createdb, dropdb };
  }
  return null;
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

async function runLockedVerification(args) {
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

  const securePg17Tools = args.pg17ToPg16Compat ? findSecurePg17RestoreTools() : null;
  const securePg16Tools = args.pg17ToPg16Compat ? findTrustedPg16LifecycleTools() : null;
  const pgRestore = securePg17Tools?.pgRestore || findTool('pg_restore');
  const psql = securePg17Tools?.psql || null;
  const createdb = securePg16Tools?.createdb || findTool('createdb');
  const dropdb = securePg16Tools?.dropdb || findTool('dropdb');
  if (
    !pgRestore
    || !createdb
    || !dropdb
    || (args.pg17ToPg16Compat && (!securePg17Tools || !securePg16Tools))
  ) {
    throw new Error(args.pg17ToPg16Compat
      ? 'Compatibility verification requires paired PostgreSQL 17.11-or-later pg_restore and psql, plus PostgreSQL 16 createdb and dropdb.'
      : 'PostgreSQL restore tools are required.');
  }

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
    restoreDatabase: args.pg17ToPg16Compat
      ? () => restorePg17ArchiveToPg16({
        pgRestore,
        psql,
        connectionArgs,
        applicationUser: actors.applicationUser,
        databaseName,
        productionDatabaseName: env.DB_NAME,
        dumpFile: findDump(path.join(args.backup, 'database')),
        applicationEnvironment,
      })
      : null,
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
  return {
    databaseName,
    receipt: verificationReceipt(databaseName, args.testMigrations, lifecycle),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const result = await runExclusiveVerificationAttempt(
    args.backup,
    () => runLockedVerification(args)
  );
  console.log(`Restore verification passed in isolated database ${result.databaseName}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Backup restore verification failed.');
    process.exitCode = 1;
  });
}
