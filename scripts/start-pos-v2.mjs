import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const expectedInstallDir = path.join(os.homedir(), 'capytech-pos-v2');

const children = [];
let shuttingDown = false;
let finishRun;

const requireFromBackend = createRequire(path.join(backendDir, 'package.json'));

function say(message) {
  console.log(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestOk(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(
      url,
      url.startsWith('https:') ? { rejectUnauthorized: false } : {},
      (res) => {
        res.resume();
        resolve(
          typeof res.statusCode === 'number' &&
            res.statusCode >= 200 &&
            res.statusCode < 500
        );
      }
    );
    req.setTimeout(2500, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
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

async function backendReady() {
  return requestOk('http://127.0.0.1:4001/api/health');
}

async function tillReady() {
  return requestOk('https://localhost:5174/');
}

function openTill() {
  if (isWindows) {
    spawn('cmd', ['/c', 'start', '', 'https://localhost:5174'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  spawn('open', ['https://localhost:5174'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, PORT: '4001', VITE_PORT: '5174', VITE_API_PROXY_TARGET: 'http://127.0.0.1:4001' },
    stdio: 'inherit',
    shell: isWindows,
    windowsHide: false,
  });

  children.push(child);
  child.on('exit', (code) => {
    if (shuttingDown) {
      return;
    }

    say('');
    say(`CapyTech POS V2 ${code ? 'stopped unexpectedly' : 'stopped'}.`);
    stopChildren();
    if (code) process.exitCode = 1;
    if (finishRun) finishRun();
  });

  return child;
}

async function waitUntil(check, label, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return true;
    }
    await wait(1000);
  }
  throw new Error(label);
}

function stopChildren() {
  shuttingDown = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) {
      continue;
    }
    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  }
}

async function verifyDatabaseIdentity(env) {
  const { Client } = requireFromBackend('pg');
  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: '-c default_transaction_read_only=on -c statement_timeout=10000',
  });
  await client.connect();
  try {
    const result = await client.query('SELECT current_database() AS database, current_user AS role');
    const identity = result.rows[0];
    if (identity?.database !== 'capytech_pos_v2' || identity?.role !== 'capytech_v2_user') {
      throw new Error('Safety stop: PostgreSQL returned an unexpected database or role identity.');
    }
  } finally {
    await client.end();
  }
}

async function main() {
  console.clear();
  say('========================================');
  say('  CapyTech POS');
  say('========================================');
  say('');

  if (process.platform === 'darwin' && path.resolve(root) !== path.resolve(expectedInstallDir)) {
    throw new Error(`Safety stop: start V2 only from ${expectedInstallDir}.`);
  }

  if (!fs.existsSync(path.join(backendDir, '.env'))) {
    if (process.platform === 'darwin') {
      say('This Mac is not set up as the shop yet.');
      say('Double-click Install CapyTech POS V2, then try Start again.');
    } else {
      say('The shop is not set up on this computer yet.');
      say('Ask your installer to copy the shop files and database first.');
    }
    process.exitCode = 1;
    return;
  }

  const envText = fs.readFileSync(path.join(backendDir, '.env'), 'utf8');
  const env = Object.fromEntries(
    envText.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );

  if (
    env.DB_NAME !== 'capytech_pos_v2' || env.DB_USER !== 'capytech_v2_user' ||
    !['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST) ||
    env.DB_PORT !== '5432' || env.PORT !== '4001'
  ) {
    throw new Error('Safety stop: V2 requires its dedicated database and PostgreSQL role.');
  }
  if (await portIsOpen(4001) || await portIsOpen(5174)) {
    throw new Error('Safety stop: V2 port 4001 or 5174 is already responding. Close the existing service or investigate the conflict before starting.');
  }
  if (!fs.existsSync(path.join(backendDir, 'node_modules')) || !fs.existsSync(path.join(frontendDir, 'node_modules'))) {
    throw new Error('V2 dependencies are incomplete. Run Install CapyTech POS V2 again; startup never installs or changes dependencies.');
  }
  await verifyDatabaseIdentity(env);

  try {
    say('Starting the shop...');
    run(npmCmd, ['run', 'start'], backendDir);
    await waitUntil(backendReady, 'The shop database did not start.');

    say('Opening the till screen...');
    run(npmCmd, ['run', 'dev'], frontendDir);
    await waitUntil(tillReady, 'The till screen did not open.');
  } catch (error) {
    stopChildren();
    throw error;
  }

  openTill();
  say('');
  say('CapyTech POS is ready.');
  say('Keep this window open while you sell.');
  say('At the end of the day, close this window to stop the till.');
  say('');

  await new Promise((resolve) => {
    finishRun = resolve;
    const finish = () => {
      stopChildren();
      resolve();
    };
    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
  });
}

process.on('uncaughtException', (error) => {
  stopChildren();
  say('');
  say(error instanceof Error ? error.message : 'Could not start CapyTech POS.');
  say('If Postgres is not running, start it and try again.');
  process.exitCode = 1;
});

await main().catch((error) => {
  say('');
  say(error instanceof Error ? error.message : 'Could not start CapyTech POS.');
  say('If this is the first time on this Mac, ask your installer to finish setup.');
  process.exitCode = 1;
});
