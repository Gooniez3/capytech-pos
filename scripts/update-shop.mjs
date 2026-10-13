import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertMigrationDataPreserved,
  loadEnv,
  relativeFiles,
  resolveProductImagesDir,
  sha256File,
} from './lib/backup-safety.mjs';
import {
  assertPhase2BMigrationInitialState,
  assertPhase3AMigrationInitialState,
  captureProductionDataManifest,
} from './lib/production-data.mjs';

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function parseArguments(args) {
  const index = args.indexOf('--current');
  if (index < 0 || !args[index + 1] || args.length !== 2) {
    throw new Error('Usage: node scripts/update-shop.mjs --current <existing-installation-folder>');
  }
  const currentRoot = path.resolve(args[index + 1]);
  if (currentRoot === releaseRoot) {
    throw new Error('Run Update from a separate reviewed release folder, not inside the live installation.');
  }
  return { currentRoot };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || releaseRoot,
      env: { ...process.env, ...(options.env || {}) },
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let output = '';
    if (options.capture) {
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

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout).trim());
  return String(result.stdout).trim();
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(750);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

function directoryDigest(root) {
  if (!fs.existsSync(root)) return [];
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Refusing symbolic link in protected persisted data: ${root}`);
  }
  if (rootStat.isFile()) {
    return [['.', sha256File(root)]];
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Unsupported protected persisted path: ${root}`);
  }
  return relativeFiles(root).map((relative) => [
    relative,
    sha256File(path.join(root, ...relative.split('/'))),
  ]);
}

async function captureLiveManifest(env, packageRoot, comparisonManifest = null) {
  const requireFromBackend = createRequire(path.join(packageRoot, 'backend', 'package.json'));
  const { Client } = requireFromBackend('pg');
  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: '-c default_transaction_read_only=on -c statement_timeout=60000',
  });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const manifest = await captureProductionDataManifest(client, {
      comparisonManifest,
    });
    await client.query('COMMIT');
    return manifest;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function verifyLiveAdditiveSchema(env, packageRoot, expectations) {
  const requireFromBackend = createRequire(path.join(packageRoot, 'backend', 'package.json'));
  const { Client } = requireFromBackend('pg');
  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: '-c default_transaction_read_only=on -c statement_timeout=60000',
  });
  await client.connect();
  try {
    const column = await client.query(`
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
      throw new Error('Live warranty column is not nullable and default-free.');
    }
    if (expectations.phase2B) {
      await assertPhase2BMigrationInitialState(client);
    }
    if (expectations.phase3A) {
      await assertPhase3AMigrationInitialState(client);
    }
    await captureProductionDataManifest(client);
  } finally {
    await client.end();
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('The production updater is restricted to the client Mac.');
  }

  const { currentRoot } = parseArguments(process.argv.slice(2));
  const envFile = path.join(currentRoot, 'backend', '.env');
  if (!fs.existsSync(envFile)) throw new Error('Existing backend/.env is missing. Refusing update.');
  if (!fs.existsSync(path.join(currentRoot, '.git'))) throw new Error('Existing installation is not a Git checkout.');
  if (!fs.existsSync(path.join(releaseRoot, '.git'))) throw new Error('Update release is not a verified Git checkout.');
  const currentStatus = capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], currentRoot);
  const releaseStatus = capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], releaseRoot);
  if (currentStatus) throw new Error('Existing installation has uncommitted source changes. Refusing to overwrite them.');
  if (releaseStatus) throw new Error('Update release has uncommitted files. Refusing an unreviewed release.');

  const currentCommit = capture('git', ['rev-parse', 'HEAD'], currentRoot);
  const releaseCommit = capture('git', ['rev-parse', 'HEAD'], releaseRoot);
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', currentCommit, releaseCommit], {
    cwd: releaseRoot,
  });
  if (ancestor.status !== 0) {
    throw new Error('Update is not a reviewed fast-forward from the installed version.');
  }

  const env = loadEnv(envFile);
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    if (!env[key]) throw new Error(`Existing backend/.env is missing ${key}.`);
  }
  const backendPortText = String(env.PORT || '4000');
  const backendPort = Number(backendPortText);
  if (!/^\d+$/.test(backendPortText) || backendPort < 1 || backendPort > 65535) {
    throw new Error('Existing backend/.env contains an invalid PORT.');
  }
  if (await portIsOpen(backendPort) || await portIsOpen(5173)) {
    throw new Error('CapyTech POS is running. Close it before updating.');
  }
  const imagesRoot = resolveProductImagesDir(env, path.join(currentRoot, 'backend'));
  const certificatesRoot = path.join(currentRoot, 'frontend', 'certs');
  const protectedPaths = ['backend/.env', 'frontend/certs', 'backups'];
  const imagesRelative = path.relative(currentRoot, imagesRoot);
  if (
    imagesRelative &&
    !imagesRelative.startsWith('..') &&
    !path.isAbsolute(imagesRelative)
  ) {
    protectedPaths.push(imagesRelative.split(path.sep).join('/'));
  }
  const trackedProtectedPaths = capture(
    'git',
    ['ls-tree', '-r', '--name-only', releaseCommit, '--', ...protectedPaths],
    releaseRoot
  )
    .split(/\r?\n/)
    .filter((entry) => entry && !entry.endsWith('/.gitkeep'));
  if (trackedProtectedPaths.length) {
    throw new Error(
      `Reviewed release tracks protected persisted paths:\n${trackedProtectedPaths.join('\n')}`
    );
  }
  const envHash = sha256File(envFile);
  const imageHashes = directoryDigest(imagesRoot);
  const certificateHashes = directoryDigest(certificatesRoot);
  const existingBackups = fs.existsSync(path.join(currentRoot, 'backups'))
    ? fs.readdirSync(path.join(currentRoot, 'backups')).sort()
    : [];
  const existingBackupHashes = Object.fromEntries(
    existingBackups.map((name) => [
      name,
      directoryDigest(path.join(currentRoot, 'backups', name)),
    ])
  );

  console.log('Preparing and testing the reviewed release...');
  const npm = isWindows ? 'npm.cmd' : 'npm';
  await run(npm, ['ci'], { cwd: path.join(releaseRoot, 'backend') });
  await run(npm, ['ci'], { cwd: path.join(releaseRoot, 'frontend') });
  await run(npm, ['run', 'typecheck'], { cwd: path.join(releaseRoot, 'frontend') });
  await run(npm, ['run', 'build'], { cwd: path.join(releaseRoot, 'frontend') });

  const beforeBackups = new Set(existingBackups);
  await run(process.execPath, [
    path.join(releaseRoot, 'scripts', 'backup-shop.mjs'),
    '--root', currentRoot,
  ]);
  const backupRoot = path.join(currentRoot, 'backups');
  const newBackups = fs.readdirSync(backupRoot)
    .filter((name) => !beforeBackups.has(name))
    .map((name) => path.join(backupRoot, name));
  if (newBackups.length !== 1) throw new Error('Updater could not identify one new verified backup.');

  await run(process.execPath, [
    path.join(releaseRoot, 'scripts', 'verify-backup.mjs'),
    '--backup', newBackups[0],
    '--test-migrations',
  ]);
  const verification = JSON.parse(
    fs.readFileSync(path.join(newBackups[0], 'RESTORE-VERIFIED.json'), 'utf8')
  );
  if (!verification.protectedDataMatched || !verification.migrationsTested) {
    throw new Error('Backup restore and migration rehearsal did not pass.');
  }

  const beforeManifest = await captureLiveManifest(env, releaseRoot);
  const databaseEnvironment = {
    DB_HOST: env.DB_HOST,
    DB_PORT: env.DB_PORT,
    DB_NAME: env.DB_NAME,
    DB_USER: env.DB_USER,
    DB_PASSWORD: env.DB_PASSWORD,
  };
  await run(npm, ['run', 'migrate:status'], {
    cwd: path.join(releaseRoot, 'backend'),
    env: databaseEnvironment,
  });
  await run(npm, ['run', 'migrate:check'], {
    cwd: path.join(releaseRoot, 'backend'),
    env: databaseEnvironment,
  });

  console.log(`Applying reviewed additive migrations to ${env.DB_NAME}...`);
  await run(npm, ['run', 'migrate:up', '--', '--database', env.DB_NAME], {
    cwd: path.join(releaseRoot, 'backend'),
    env: databaseEnvironment,
  });
  const afterManifest = await captureLiveManifest(env, releaseRoot, beforeManifest);
  assertMigrationDataPreserved(beforeManifest, afterManifest);
  await verifyLiveAdditiveSchema(
    env,
    releaseRoot,
    {
      phase2B: !beforeManifest.protectedShape?.tables?.stock_units,
      phase3A: !beforeManifest.protectedShape?.tables?.inventory_movements,
    }
  );

  const rollbackBranch = `rollback/pre-update-${Date.now()}`;
  await run('git', ['branch', rollbackBranch, currentCommit], { cwd: currentRoot });
  await run('git', ['fetch', releaseRoot, releaseCommit], { cwd: currentRoot });
  await run('git', ['merge', '--ff-only', releaseCommit], { cwd: currentRoot });

  try {
    await run(npm, ['ci'], { cwd: path.join(currentRoot, 'backend') });
    await run(npm, ['ci'], { cwd: path.join(currentRoot, 'frontend') });
  } catch (error) {
    await run('git', ['switch', rollbackBranch], { cwd: currentRoot }).catch(() => {});
    throw error;
  }

  if (sha256File(envFile) !== envHash) throw new Error('backend/.env changed during update. Stop and use rollback.');
  if (JSON.stringify(directoryDigest(imagesRoot)) !== JSON.stringify(imageHashes)) {
    throw new Error('Product-image storage changed during update. Stop and use rollback.');
  }
  if (
    JSON.stringify(directoryDigest(certificatesRoot)) !==
    JSON.stringify(certificateHashes)
  ) {
    throw new Error('HTTPS certificates changed during update. Stop and use rollback.');
  }
  const finalBackups = fs.readdirSync(backupRoot);
  if (existingBackups.some((name) => !finalBackups.includes(name))) {
    throw new Error('A pre-existing backup disappeared during update. Stop and use rollback.');
  }
  for (const name of existingBackups) {
    if (
      JSON.stringify(directoryDigest(path.join(backupRoot, name))) !==
      JSON.stringify(existingBackupHashes[name])
    ) {
      throw new Error(`Pre-existing backup changed during update: ${name}`);
    }
  }

  fs.writeFileSync(
    path.join(newBackups[0], 'UPDATE-RESULT.json'),
    `${JSON.stringify({
      updatedAt: new Date().toISOString(),
      previousCommit: currentCommit,
      installedCommit: releaseCommit,
      rollbackBranch,
      productionDataMatched: true,
      environmentPreserved: true,
      imagesPreserved: true,
      certificatesPreserved: true,
      existingBackupsPreserved: true,
    }, null, 2)}\n`,
    'utf8'
  );

  console.log('CapyTech POS update completed safely.');
  console.log(`Rollback branch retained: ${rollbackBranch}`);
  console.log('Start the POS and perform the documented read-only verification before reopening sales.');
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Update failed closed.');
  process.exitCode = 1;
});
