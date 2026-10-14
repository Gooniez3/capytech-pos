import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyDirectory,
  loadEnv,
  relativeFiles,
  resolveProductImagesDir,
  verifyChecksumManifest,
  writeChecksumManifest,
} from './lib/backup-safety.mjs';
import { captureProductionDataManifest } from './lib/production-data.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootArgumentIndex = process.argv.indexOf('--root');
if (
  rootArgumentIndex >= 0 &&
  (!process.argv[rootArgumentIndex + 1] || process.argv.length !== rootArgumentIndex + 2)
) {
  throw new Error('Usage: node scripts/backup-shop.mjs [--root <installed-shop-folder>]');
}
const root = rootArgumentIndex >= 0
  ? path.resolve(process.argv[rootArgumentIndex + 1])
  : scriptRoot;
const backendDir = path.join(root, 'backend');
const envFile = path.join(backendDir, '.env');
const backupsRoot = path.join(root, 'backups');
const isWindows = process.platform === 'win32';
const expectedInstallDir = path.join(os.homedir(), 'capytech-pos-v2');

function say(message = '') {
  console.log(message);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function existingFile(filePath) {
  return fs.existsSync(filePath) ? filePath : null;
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

function findPostgresTool(name) {
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
  return candidates.filter(Boolean).map(existingFile).find(Boolean) || null;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: { ...process.env, ...(options.env || {}) },
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout.on('data', (value) => { stdout += value; });
      child.stderr.on('data', (value) => { stderr += value; });
    }
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(options.failure || stderr.trim() || `Command failed: ${command}`));
    });
  });
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

async function assertPosStopped(backendPort) {
  if (await portIsOpen(backendPort) || await portIsOpen(5174)) {
    throw new Error(
      'CapyTech POS V2 is still running on port 4001 or 5174. Close the V2 Start window before backing up.'
    );
  }
}

function assertReferencedImagesPresent(imagesRoot, references) {
  for (const reference of references) {
    const relative = String(reference.image_path || '').replace(/\\/g, '/');
    const filePath = path.resolve(imagesRoot, ...relative.split('/'));
    const boundary = path.relative(imagesRoot, filePath);
    if (
      !relative ||
      boundary.startsWith('..') ||
      path.isAbsolute(boundary) ||
      !fs.existsSync(filePath)
    ) {
      throw new Error(`Referenced product image is missing: ${relative || '(empty path)'}`);
    }
  }
}

function copyFileExclusive(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function gitMetadata(destination) {
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  });
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const data = {
    revision: revision.status === 0 ? revision.stdout.trim() : null,
    workingTreeStatus: status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean) : null,
  };
  fs.writeFileSync(destination, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

function copyOperationalFiles(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const relative of [
    'Start CapyTech POS V2.command',
    'Backup CapyTech POS V2.command',
    'Install CapyTech POS V2.command',
    'scripts/start-pos-v2.mjs',
    'scripts/backup-shop-v2.mjs',
    'scripts/install-shop-v2.mjs',
    'backend/package.json',
    'backend/package-lock.json',
    'frontend/package.json',
    'frontend/package-lock.json',
  ]) {
    const source = path.join(root, relative);
    if (fs.existsSync(source)) {
      copyFileExclusive(source, path.join(destination, relative));
    }
  }
}

function usbDestinations(folderName) {
  if (process.platform !== 'darwin' || !fs.existsSync('/Volumes')) return [];
  const skipped = new Set(['Macintosh HD', 'Macintosh HD - Data', 'com.apple.TimeMachine.localsnapshots']);
  const destinations = [];
  for (const name of fs.readdirSync('/Volumes')) {
    if (skipped.has(name) || name.startsWith('.')) continue;
    const volume = path.join('/Volumes', name);
    try {
      if (!fs.statSync(volume).isDirectory()) continue;
      fs.accessSync(volume, fs.constants.W_OK);
      destinations.push(path.join(volume, 'CapyTech POS V2 Backups', folderName));
    } catch {
      // Ignore unavailable or read-only volumes.
    }
  }
  return destinations;
}

async function main() {
  console.clear();
  say('========================================');
  say('  CapyTech POS V2 verified backup');
  say('========================================');
  say();

  if (process.platform === 'darwin' && path.resolve(root) !== path.resolve(expectedInstallDir)) {
    throw new Error(`Safety stop: back up V2 only from ${expectedInstallDir}.`);
  }

  if (!fs.existsSync(envFile)) throw new Error('backend/.env is missing. Refusing to guess a database.');
  const env = loadEnv(envFile);
  if (env.DB_NAME !== 'capytech_pos_v2' || env.DB_USER !== 'capytech_v2_user') {
    throw new Error('Safety stop: V2 backup requires the dedicated V2 database and role.');
  }
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    if (!env[key]) throw new Error(`backend/.env is missing ${key}.`);
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST) || env.DB_PORT !== '5432') {
    throw new Error('Safety stop: V2 backup requires local PostgreSQL on port 5432.');
  }
  if (String(env.PORT || '') !== '4001') {
    throw new Error('Safety stop: V2 backend must use port 4001.');
  }
  const backendPortText = String(env.PORT);
  const backendPort = Number(backendPortText);
  if (!/^\d+$/.test(backendPortText) || backendPort < 1 || backendPort > 65535) {
    throw new Error('backend/.env contains an invalid PORT.');
  }
  await assertPosStopped(backendPort);

  const pgDump = findPostgresTool('pg_dump');
  const pgRestore = findPostgresTool('pg_restore');
  if (!pgDump || !pgRestore) throw new Error('PostgreSQL pg_dump and pg_restore are required.');

  const requireFromBackend = createRequire(path.join(backendDir, 'package.json'));
  const { Client } = requireFromBackend('pg');
  const identityClient = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: '-c default_transaction_read_only=on -c statement_timeout=10000',
  });
  await identityClient.connect();
  try {
    const identity = (await identityClient.query(
      'SELECT current_database() AS database, current_user AS role'
    )).rows[0];
    if (identity?.database !== 'capytech_pos_v2' || identity?.role !== 'capytech_v2_user') {
      throw new Error('Safety stop: PostgreSQL returned an unexpected V2 database or role identity.');
    }
  } finally {
    await identityClient.end();
  }

  const imagesDir = resolveProductImagesDir(env, backendDir);
  const imageBoundary = path.relative(root, imagesDir);
  if (!imageBoundary || imageBoundary.startsWith('..') || path.isAbsolute(imageBoundary)) {
    throw new Error('Safety stop: V2 product images must remain inside the V2 installation folder.');
  }
  if (!fs.existsSync(imagesDir)) {
    throw new Error(`Configured product-image directory does not exist: ${imagesDir}`);
  }
  // Refuse links so a backup can never silently copy data from outside the
  // configured image root.
  relativeFiles(imagesDir);

  const backupName = `CapyTech_V2_${timestamp()}`;
  const destination = path.join(backupsRoot, backupName);
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists.');
  fs.mkdirSync(destination, { recursive: true });

  const databaseDir = path.join(destination, 'database');
  const configDir = path.join(destination, 'configuration');
  fs.mkdirSync(databaseDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  const dumpFile = path.join(databaseDir, `${env.DB_NAME}.dump`);
  say('Creating a consistent PostgreSQL dump...');
  await run(pgDump, [
    '--host', env.DB_HOST,
    '--port', env.DB_PORT,
    '--username', env.DB_USER,
    '--dbname', env.DB_NAME,
    '--format', 'custom',
    '--no-owner',
    '--no-acl',
    '--serializable-deferrable',
    '--file', dumpFile,
  ], { env: { PGPASSWORD: env.DB_PASSWORD }, failure: 'PostgreSQL backup failed.' });

  const listing = await run(pgRestore, ['--list', dumpFile], { capture: true });
  if (!listing.stdout.includes('TABLE DATA') || !listing.stdout.includes('sales')) {
    throw new Error('Database dump did not pass structural inspection.');
  }
  fs.writeFileSync(path.join(databaseDir, 'pg-restore-list.txt'), listing.stdout, 'utf8');

  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: '-c default_transaction_read_only=on -c statement_timeout=60000',
  });
  await client.connect();
  let dataManifest;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    dataManifest = await captureProductionDataManifest(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  assertReferencedImagesPresent(imagesDir, dataManifest.imageReferences);
  fs.writeFileSync(
    path.join(databaseDir, 'protected-data-manifest.json'),
    `${JSON.stringify(dataManifest, null, 2)}\n`,
    'utf8'
  );

  say('Copying configuration, images, trash, and metadata...');
  copyFileExclusive(envFile, path.join(configDir, 'backend.env'));
  copyDirectory(imagesDir, path.join(destination, 'product-images'));

  const certsDir = path.join(root, 'frontend', 'certs');
  if (fs.existsSync(certsDir)) {
    copyDirectory(certsDir, path.join(destination, 'certificates'));
  }
  copyOperationalFiles(path.join(destination, 'operational-files'));
  const gitInfo = gitMetadata(path.join(destination, 'application-version.json'));

  fs.writeFileSync(
    path.join(destination, 'BACKUP-README.txt'),
    [
      'CapyTech POS V2 verified backup',
      '',
      `Created: ${new Date().toString()}`,
      `Computer: ${os.hostname()}`,
      `Database: ${env.DB_NAME}`,
      `Product image source: ${imagesDir}`,
      '',
      'This backup is complete only when BACKUP-COMPLETE.json exists.',
      'Run: node scripts/verify-backup.mjs --backup <this-folder>',
      'That workflow restores into a new capytech_verify_* database and never overwrites production.',
      '',
      'Browser localStorage (including an unsold cart draft) is protected by preserving',
      'the browser profile and the https://localhost:5174 origin. Keep Time Machine enabled.',
      'The database dump and file backup do not directly read browser-private storage.',
      '',
    ].join('\n'),
    'utf8'
  );

  fs.writeFileSync(
    path.join(destination, 'BACKUP-COMPLETE.json'),
    `${JSON.stringify({
      completedAt: new Date().toISOString(),
      database: env.DB_NAME,
      imageSource: imagesDir,
      filesVerified: relativeFiles(destination).length + 1,
      gitRevision: gitInfo.revision,
      restoreVerified: false,
    }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  );

  const checksumFiles = writeChecksumManifest(destination);
  const verifiedFiles = verifyChecksumManifest(destination);
  if (checksumFiles !== verifiedFiles.length) throw new Error('Checksum verification count mismatch.');

  say(`Verified local backup: ${destination}`);
  for (const usbPath of usbDestinations(backupName)) {
    copyDirectory(destination, usbPath);
    verifyChecksumManifest(usbPath);
    say(`Verified external copy: ${usbPath}`);
  }
  say();
  say('Backup checksums passed. A test restore is still required before upgrading.');
}

await main().catch((error) => {
  say();
  say(error instanceof Error ? error.message : 'Backup failed.');
  process.exitCode = 1;
});
