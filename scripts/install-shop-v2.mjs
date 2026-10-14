import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const envFile = path.join(backendDir, '.env');
const envExample = path.join(backendDir, '.env.example');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const dbName = 'capytech_pos_v2';
const shopRole = 'capytech_v2_user';
const dbHost = 'localhost';
const dbPort = '5432';
const backendPort = '4001';
const expectedInstallDir = path.join(os.homedir(), 'capytech-pos-v2');

function say(message = '') {
  console.log(message);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function existingFile(filePath) {
  return fs.existsSync(filePath) ? filePath : null;
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

function which(command) {
  const result = spawnSync(isWindows ? 'where' : 'which', [command], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return null;
  }
  const line = String(result.stdout || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line || null;
}

function findTool(name, extra = []) {
  const fromPath = which(name);
  if (fromPath) {
    return fromPath;
  }

  for (const candidate of extra) {
    const found = existingFile(candidate);
    if (found) {
      return found;
    }
  }

  return null;
}

function findPsql() {
  return findTool('psql', [
    '/opt/homebrew/opt/postgresql@18/bin/psql',
    '/opt/homebrew/opt/postgresql@17/bin/psql',
    '/opt/homebrew/opt/postgresql@16/bin/psql',
    '/usr/local/opt/postgresql@18/bin/psql',
    '/usr/local/opt/postgresql@17/bin/psql',
    '/usr/local/opt/postgresql@16/bin/psql',
    '/opt/homebrew/bin/psql',
    '/usr/local/bin/psql',
    '/Applications/Postgres.app/Contents/Versions/latest/bin/psql',
  ]);
}

function findBrew() {
  return findTool('brew', ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
}

function findMkcert() {
  return findTool('mkcert', ['/opt/homebrew/bin/mkcert', '/usr/local/bin/mkcert']);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      env: { ...process.env, ...(options.env || {}) },
      stdio: options.stdio || 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(options.fail || `Command failed: ${command}`));
      }
    });
  });
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function loadEnv(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) {
    return values;
  }

  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const index = trimmed.indexOf('=');
    if (index === -1) {
      continue;
    }
    values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }

  return values;
}

function writeEnv({ dbUser, dbPassword, jwtSecret }) {
  const example = fs.existsSync(envExample)
    ? fs.readFileSync(envExample, 'utf8')
    : '';

  const required = {
    PORT: backendPort,
    DB_USER: dbUser,
    DB_PASSWORD: dbPassword,
    DB_HOST: dbHost,
    DB_PORT: dbPort,
    DB_NAME: dbName,
    JWT_SECRET: jwtSecret,
    PRODUCT_IMAGES_DIR: 'storage/product-images',
  };
  const requiredKeys = new Set(Object.keys(required));
  const lines = example.split(/\r?\n/).filter((line) => {
    const match = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    return !match || !requiredKeys.has(match[1]);
  });
  for (const [key, value] of Object.entries(required)) lines.push(`${key}=${value}`);
  fs.writeFileSync(envFile, `${lines.join('\n').trim()}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.chmodSync(envFile, 0o600);
}

function superuserPsql(psql, sql, database = 'postgres') {
  const result = runCapture(psql, [
    '-h',
    dbHost,
    '-p',
    dbPort,
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-t',
    '-A',
    '-c',
    sql,
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'PostgreSQL command failed.');
  }
  return result.stdout;
}

function assertFreshV2DatabaseAndRole(psql) {
  const existingDatabase = Number(superuserPsql(
    psql,
    `SELECT COUNT(*) FROM pg_database WHERE datname = ${sqlLiteral(dbName)}`
  ));

  const existingRole = Number(superuserPsql(
    psql,
    `SELECT COUNT(*) FROM pg_roles WHERE rolname = ${sqlLiteral(shopRole)}`
  ));

  if (existingDatabase || existingRole) {
    throw new Error('Safety stop: v2 database or role already exists. No installation changes allowed.');
  }
}
function ensureShopRole(psql, password) {
  superuserPsql(
    psql,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(shopRole)}) THEN
        CREATE ROLE ${shopRole} LOGIN PASSWORD ${sqlLiteral(password)}
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      ELSE
        RAISE EXCEPTION 'Safety stop: v2 PostgreSQL role already exists';
      END IF;
    END $$;`
  );
}

function ensureShopDatabase(psql) {
  const hasDatabase =
    Number(
      superuserPsql(
        psql,
        `SELECT COUNT(*) FROM pg_database WHERE datname = ${sqlLiteral(dbName)}`
      )
    ) > 0;

  if (!hasDatabase) {
    say('Creating an empty shop database...');
    superuserPsql(psql, `CREATE DATABASE ${dbName} OWNER ${shopRole}`);
    return;
  }

  throw new Error(`Safety stop: database ${dbName} already exists. Refusing to reuse or modify it.`);
}

async function ensureTools() {
  const brew = findBrew();
  const need = [];

  if (!which('node')) need.push('node');
  if (!findPsql()) need.push('postgresql@18');
  if (!findMkcert()) need.push('mkcert');
  if (!which('git')) need.push('git');

  if (need.length === 0) {
    return;
  }

  say(`Missing on this Mac: ${need.join(', ')}`);

  if (!hasFlag('--install-tools')) {
    say('Re-run with Homebrew install:');
    say('  Double-click Install CapyTech POS V2.command');
    throw new Error('Install the missing tools, then try again.');
  }

  if (!brew) {
    say('Homebrew is not installed.');
    say('In Terminal, paste this, then double-click Install again:');
    say(
      '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    );
    throw new Error('Homebrew is required on the shop Mac.');
  }

  say('Installing shop tools with Homebrew. This can take several minutes...');
  const packages = [...new Set([...need, 'nss'])];
  await run(brew, ['install', ...packages], {
    fail: 'Homebrew could not install the shop tools.',
  });

  if (packages.includes('postgresql@18')) {
    await run(brew, ['services', 'start', 'postgresql@18'], {
      fail: 'PostgreSQL did not start.',
    }).catch(async () => {
      throw new Error('PostgreSQL 18 did not start. No V2 database was created.');
    });
  }
}

function ensurePostgresRunning(psql) {
  const connection = ['-h', dbHost, '-p', dbPort, '-d', 'postgres'];
  const ping = runCapture(psql, [...connection, '-c', 'SELECT 1']);
  if (ping.status === 0) {
    return;
  }

  const brew = findBrew();
  if (brew) {
    spawnSync(brew, ['services', 'start', 'postgresql@18'], { stdio: 'ignore' });
    spawnSync(brew, ['services', 'start', 'postgresql@17'], { stdio: 'ignore' });
    spawnSync(brew, ['services', 'start', 'postgresql@16'], { stdio: 'ignore' });
  }

  const retry = runCapture(psql, [...connection, '-c', 'SELECT 1']);
  if (retry.status !== 0) {
    throw new Error(
      'PostgreSQL is not running. Open the Postgres app or start it from Homebrew, then try again.'
    );
  }
}

function tableCount(psql, env, table) {
  const exists = runCapture(
    psql,
    [
      '-d',
      env.DB_NAME,
      '-U',
      env.DB_USER,
      '-h',
      env.DB_HOST,
      '-p',
      env.DB_PORT,
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-c',
      `SELECT COUNT(*) FROM ${table}`,
    ],
    { env: { PGPASSWORD: env.DB_PASSWORD } }
  );

  if (exists.status !== 0) {
    return null;
  }

  const n = Number(exists.stdout);
  return Number.isFinite(n) ? n : null;
}

function shopPsql(psql, env, sql) {
  const result = runCapture(psql, [
    '-h', env.DB_HOST,
    '-p', env.DB_PORT,
    '-U', env.DB_USER,
    '-d', env.DB_NAME,
    '-v', 'ON_ERROR_STOP=1',
    '-c', sql,
  ], { env: { PGPASSWORD: env.DB_PASSWORD } });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Could not initialize V2 shop defaults.');
  }
}

function writeDesktopLauncher(fileName, targetCommand) {
  const desktop = path.join(os.homedir(), 'Desktop');
  if (!fs.existsSync(desktop)) {
    return;
  }

  const dest = path.join(desktop, fileName);
  const script = [
    '#!/bin/bash',
    `cd ${JSON.stringify(root)} || exit 1`,
    `exec bash ${JSON.stringify(targetCommand)}`,
    '',
  ].join('\n');

  if (fs.existsSync(dest)) {
    if (fs.readFileSync(dest, 'utf8') !== script) {
      throw new Error(`Safety stop: Desktop/${fileName} already exists and is not this V2 launcher.`);
    }
    return;
  }
  fs.writeFileSync(dest, script, { encoding: 'utf8', flag: 'wx' });
  fs.chmodSync(dest, 0o755);
}

async function main() {
  console.clear();
  say('========================================');
  say('  Install CapyTech POS V2');
  say('========================================');
  say('');

  if (isWindows) {
    say('This installer is for the customer MacBook Air only.');
    say('This Windows PC already has the live shop. Nothing was changed.');
    process.exitCode = 1;
    return;
  }

  if (!isMac) {
    throw new Error('Install CapyTech POS on the shop MacBook Air.');
  }

  if (path.resolve(root) !== path.resolve(expectedInstallDir)) {
    throw new Error(`Safety stop: V2 must be installed at ${expectedInstallDir}. The original shop folder is never reused.`);
  }

  if (await portIsOpen(Number(backendPort)) || await portIsOpen(5174)) {
    throw new Error('Safety stop: V2 port 4001 or 5174 is already in use. No installation changes were made.');
  }

  await ensureTools();

  const psql = findPsql();
  const mkcert = findMkcert();
  const node = which('node');

  if (!node) {
    throw new Error('Node.js is not available after install.');
  }
  if (!psql) {
    throw new Error('PostgreSQL tools were not found.');
  }

  ensurePostgresRunning(psql);

  if (fs.existsSync(envFile)) {
    throw new Error('Safety stop: backend/.env already exists. This installer never overwrites configuration. Review the interrupted-install recovery guide.');
  }

  assertFreshV2DatabaseAndRole(psql);

  say('Installing V2 dependencies before creating database resources...');
  await run(isWindows ? 'npm.cmd' : 'npm', ['ci'], {
    cwd: backendDir,
    fail: 'Could not install the V2 server. No V2 database was created.',
  });
  await run(isWindows ? 'npm.cmd' : 'npm', ['ci'], {
    cwd: frontendDir,
    fail: 'Could not install the V2 till. No V2 database was created.',
  });

  const dbPassword = crypto.randomBytes(16).toString('hex');
  const jwtSecret = crypto.randomBytes(32).toString('hex');

  ensureShopRole(psql, dbPassword);
  ensureShopDatabase(psql);

  const databaseOwner = superuserPsql(
    psql,
    `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = ${sqlLiteral(dbName)}`
  );
  if (databaseOwner !== shopRole) {
    throw new Error('Safety stop: V2 database ownership is not the dedicated V2 role.');
  }

  writeEnv({ dbUser: shopRole, dbPassword, jwtSecret });
  say('Created fresh V2 database configuration.');
  const env = loadEnv(envFile);
  if (
    env.DB_NAME !== dbName || env.DB_USER !== shopRole ||
    env.DB_HOST !== dbHost || env.DB_PORT !== dbPort || env.PORT !== backendPort ||
    env.PRODUCT_IMAGES_DIR !== 'storage/product-images' ||
    !env.DB_PASSWORD || !env.JWT_SECRET
  ) {
    throw new Error('backend/.env is incomplete.');
  }

  const sales = tableCount(psql, env, 'sales');
  if (sales && sales > 0) {
    say('');
    say(`This Mac already has ${sales} sale(s) in ${env.DB_NAME}.`);
    say('Install will not wipe a shop that has already sold.');
    say('Do not restore the Windows test USB backup onto this Mac.');
    say('If this is the wrong database, create a new empty one and try again.');
    process.exitCode = 1;
    return;
  }

  say('Building empty shop tables...');
  await run(
    isWindows ? 'npm.cmd' : 'npm',
    ['run', 'migrate:up', '--', '--database', env.DB_NAME],
    {
      cwd: backendDir,
      env: {
        DB_HOST: env.DB_HOST,
        DB_PORT: env.DB_PORT,
        DB_NAME: env.DB_NAME,
        DB_USER: env.DB_USER,
        DB_PASSWORD: env.DB_PASSWORD,
      },
      fail: 'Could not create the empty shop database.',
    }
  );

  say('Writing CAPY TECH store card and product categories...');
  shopPsql(
    psql,
    env,
    `
      INSERT INTO store_settings (
        id, store_name, phone, email, address, currency, tax_rate
      )
      VALUES (
        1,
        'CAPY TECH',
        '09781973322',
        NULL,
        'No. 51, Aung Thu Kha Street, Pathein, Myanmar',
        'ks',
        0
      )
      ON CONFLICT (id) DO UPDATE SET
        store_name = EXCLUDED.store_name,
        phone = COALESCE(store_settings.phone, EXCLUDED.phone),
        address = COALESCE(store_settings.address, EXCLUDED.address),
        currency = EXCLUDED.currency
    `
  );

  shopPsql(
    psql,
    env,
    `
      INSERT INTO categories (name) VALUES
        ('Keyboard'),
        ('Mouse'),
        ('Cable'),
        ('Storage'),
        ('Audio'),
        ('Accessories')
      ON CONFLICT (name) DO NOTHING
    `
  );

  if (mkcert) {
    say('Trusting this Mac for the till and phone scanner...');
    spawnSync(mkcert, ['-install'], { stdio: 'inherit' });
    await run(node, ['scripts/issue-dev-cert.mjs'], {
      cwd: frontendDir,
      fail: 'Could not create the till certificate.',
    }).catch(() => {
      say('Certificate refresh can wait until the first Start CapyTech POS.');
    });
  }

  writeDesktopLauncher('Start CapyTech POS V2.command', path.join(root, 'Start CapyTech POS V2.command'));
  writeDesktopLauncher('Backup CapyTech POS V2.command', path.join(root, 'Backup CapyTech POS V2.command'));

  for (const file of [
    path.join(root, 'Install CapyTech POS V2.command'),
    path.join(root, 'Start CapyTech POS V2.command'),
    path.join(root, 'Backup CapyTech POS V2.command'),
  ]) {
    try {
      fs.chmodSync(file, 0o755);
      spawnSync('xattr', ['-d', 'com.apple.quarantine', file], { stdio: 'ignore' });
    } catch {
      // Gatekeeper attribute may not exist.
    }
  }

  say('');
  say('This Mac now has a separate empty CapyTech POS V2 shop.');
  say('First V2 sale will be INV-000001.');
  say('');
  say('The original ~/capytech-pos-shop installation and pos_store database were not changed.');
  say('Do not restore or import the original database into V2.');
  say('');
  say('Each morning:');
  say('  Double-click Start CapyTech POS V2 on the Desktop.');
  say('  The owner creates their own username and password on first open.');
  say('  Then they add products and sell.');
  say('');
  say('Each night:');
  say('  Plug in a USB stick and double-click Backup CapyTech POS V2.');
  say('');
  say('Also turn on Time Machine:');
  say('  System Settings -> General -> Time Machine -> Add Backup Disk.');
  say('  Use a different disk than the daily USB stick if you can.');
  say('');
  say('Phone scanner: same shop Wi-Fi as this Mac, not Guest.');
}

await main().catch((error) => {
  say('');
  say(error instanceof Error ? error.message : 'Install failed.');
  say('Do not delete or alter ~/capytech-pos-shop, pos_store, or the pos_shop role.');
  say('If backend/.env, capytech_pos_v2, or capytech_v2_user was created, stop and have the installer review the V2-only partial state before retrying.');
  process.exitCode = 1;
});
