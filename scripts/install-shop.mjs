import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
const dbName = 'pos_store';
const shopRole = 'pos_shop';

function say(message = '') {
  console.log(message);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function existingFile(filePath) {
  return fs.existsSync(filePath) ? filePath : null;
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
    '/opt/homebrew/opt/postgresql@17/bin/psql',
    '/opt/homebrew/opt/postgresql@16/bin/psql',
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

  const lines = example
    ? example.split(/\r?\n/).map((line) => {
        if (line.startsWith('DB_USER=')) return `DB_USER=${dbUser}`;
        if (line.startsWith('DB_PASSWORD=')) return `DB_PASSWORD=${dbPassword}`;
        if (line.startsWith('DB_HOST=')) return 'DB_HOST=localhost';
        if (line.startsWith('DB_PORT=')) return 'DB_PORT=5432';
        if (line.startsWith('DB_NAME=')) return `DB_NAME=${dbName}`;
        if (line.startsWith('JWT_SECRET=')) return `JWT_SECRET=${jwtSecret}`;
        if (line.startsWith('PORT=')) return 'PORT=4000';
        return line;
      })
    : [
        'PORT=4000',
        `DB_USER=${dbUser}`,
        `DB_PASSWORD=${dbPassword}`,
        'DB_HOST=localhost',
        'DB_PORT=5432',
        `DB_NAME=${dbName}`,
        `JWT_SECRET=${jwtSecret}`,
      ];

  fs.writeFileSync(envFile, `${lines.filter((line) => line !== undefined).join('\n').trim()}\n`, 'utf8');
}

function superuserPsql(psql, sql, database = 'postgres') {
  const result = runCapture(psql, [
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

function ensureShopRole(psql, password) {
  superuserPsql(
    psql,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(shopRole)}) THEN
        CREATE ROLE ${shopRole} LOGIN PASSWORD ${sqlLiteral(password)};
      ELSE
        ALTER ROLE ${shopRole} WITH LOGIN PASSWORD ${sqlLiteral(password)};
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

  superuserPsql(psql, `ALTER DATABASE ${dbName} OWNER TO ${shopRole}`);
}

async function ensureTools() {
  const brew = findBrew();
  const need = [];

  if (!which('node')) need.push('node');
  if (!findPsql()) need.push('postgresql@17');
  if (!findMkcert()) need.push('mkcert');
  if (!which('git')) need.push('git');

  if (need.length === 0) {
    return;
  }

  say(`Missing on this Mac: ${need.join(', ')}`);

  if (!hasFlag('--install-tools')) {
    say('Re-run with Homebrew install:');
    say('  Double-click Install CapyTech POS.command');
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

  if (packages.includes('postgresql@17')) {
    await run(brew, ['services', 'start', 'postgresql@17'], {
      fail: 'PostgreSQL did not start.',
    }).catch(async () => {
      await run(brew, ['services', 'start', 'postgresql@16'], {
        fail: 'PostgreSQL did not start.',
      });
    });
  }
}

function ensurePostgresRunning(psql) {
  const ping = runCapture(psql, ['-d', 'postgres', '-c', 'SELECT 1']);
  if (ping.status === 0) {
    return;
  }

  const brew = findBrew();
  if (brew) {
    spawnSync(brew, ['services', 'start', 'postgresql@17'], { stdio: 'ignore' });
    spawnSync(brew, ['services', 'start', 'postgresql@16'], { stdio: 'ignore' });
  }

  const retry = runCapture(psql, ['-d', 'postgres', '-c', 'SELECT 1']);
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

  fs.writeFileSync(dest, script, 'utf8');
  fs.chmodSync(dest, 0o755);
}

async function main() {
  console.clear();
  say('========================================');
  say('  Install CapyTech POS on this Mac');
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
    const existing = loadEnv(envFile);
    if (existing.DB_NAME && existing.DB_NAME !== dbName) {
      throw new Error(
        `backend/.env points at ${existing.DB_NAME}, not ${dbName}. Refusing to mix shops.`
      );
    }
    if (existing.DB_USER === 'postgres') {
      throw new Error(
        'backend/.env looks copied from the Windows PC. Delete that file and run Install again. Do not copy shop.env from the test USB backup.'
      );
    }
    if (!existing.DB_USER || !existing.DB_PASSWORD) {
      throw new Error('backend/.env is incomplete.');
    }
    say('Keeping the existing backend/.env on this Mac.');
    ensureShopRole(psql, existing.DB_PASSWORD);
    ensureShopDatabase(psql);
  } else {
    const dbPassword = crypto.randomBytes(16).toString('hex');
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    ensureShopRole(psql, dbPassword);
    ensureShopDatabase(psql);
    writeEnv({ dbUser: shopRole, dbPassword, jwtSecret });
    say('Wrote backend/.env for this Mac. It stays on this computer.');
  }

  const env = loadEnv(envFile);
  if (!env.DB_NAME || !env.DB_USER || !env.DB_PASSWORD) {
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

  const users = tableCount(psql, env, 'users');
  if (users && users > 0 && sales === 0) {
    say('This database has logins but no sales. Clearing leftover test users...');
    await run(node, ['scripts/prepare-customer-shop.mjs', '--yes-wipe-test-data'], {
      cwd: root,
      fail: 'Could not clear leftover test logins.',
    });
  }

  say('Installing shop software...');
  await run(isWindows ? 'npm.cmd' : 'npm', ['install'], {
    cwd: backendDir,
    fail: 'Could not install the shop server.',
  });
  await run(isWindows ? 'npm.cmd' : 'npm', ['install'], {
    cwd: frontendDir,
    fail: 'Could not install the till screen.',
  });

  say('Building empty shop tables...');
  await run(
    isWindows ? 'npm.cmd' : 'npm',
    ['run', 'migrate:up', '--', '--database', env.DB_NAME],
    {
      cwd: backendDir,
      fail: 'Could not create the empty shop database.',
    }
  );

  say('Writing CAPY TECH store card and product categories...');
  superuserPsql(
    psql,
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
    `,
    env.DB_NAME
  );

  superuserPsql(
    psql,
    `
      INSERT INTO categories (name) VALUES
        ('Keyboard'),
        ('Mouse'),
        ('Cable'),
        ('Storage'),
        ('Audio'),
        ('Accessories')
      ON CONFLICT (name) DO NOTHING
    `,
    env.DB_NAME
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

  writeDesktopLauncher('Start CapyTech POS.command', path.join(root, 'Start CapyTech POS.command'));
  writeDesktopLauncher('Backup CapyTech POS.command', path.join(root, 'Backup CapyTech POS.command'));

  for (const file of [
    path.join(root, 'Install CapyTech POS.command'),
    path.join(root, 'Start CapyTech POS.command'),
    path.join(root, 'Backup CapyTech POS.command'),
  ]) {
    try {
      fs.chmodSync(file, 0o755);
      spawnSync('xattr', ['-d', 'com.apple.quarantine', file], { stdio: 'ignore' });
    } catch {
      // Gatekeeper attribute may not exist.
    }
  }

  say('');
  say('This Mac is an empty CapyTech shop.');
  say('There is no Windows test data here. First sale will be INV-000001.');
  say('');
  say('Do not restore the test USB backup from the Windows PC onto this Mac.');
  say('');
  say('Each morning:');
  say('  Double-click Start CapyTech POS on the Desktop.');
  say('  The owner creates their own username and password on first open.');
  say('  Then they add products and sell.');
  say('');
  say('Each night:');
  say('  Plug in a USB stick and double-click Backup CapyTech POS.');
  say('');
  say('Also turn on Time Machine:');
  say('  System Settings → General → Time Machine → Add Backup Disk.');
  say('  Use a different disk than the daily USB stick if you can.');
  say('');
  say('Phone scanner: same shop Wi-Fi as this Mac, not Guest.');
}

await main().catch((error) => {
  say('');
  say(error instanceof Error ? error.message : 'Install failed.');
  process.exitCode = 1;
});
