import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

const children = [];
let shuttingDown = false;

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

async function backendReady() {
  return requestOk('http://127.0.0.1:4000/api/health');
}

async function tillReady() {
  return requestOk('https://localhost:5173/');
}

function openTill() {
  if (isWindows) {
    spawn('cmd', ['/c', 'start', '', 'https://localhost:5173'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  spawn('open', ['https://localhost:5173'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
    windowsHide: false,
  });

  children.push(child);
  child.on('exit', (code) => {
    if (shuttingDown) {
      return;
    }

    if (code) {
      say('');
      say('CapyTech POS stopped unexpectedly.');
      say('Leave this window open and contact your installer if it happens again.');
    }
  });

  return child;
}

function hasModules(dir) {
  return fs.existsSync(path.join(dir, 'node_modules'));
}

async function ensureInstall(dir, label) {
  if (hasModules(dir)) {
    return;
  }

  say(`First-time setup for ${label}. This can take a few minutes...`);
  await new Promise((resolve, reject) => {
    const child = spawn(npmCmd, ['install'], {
      cwd: dir,
      env: process.env,
      stdio: 'inherit',
      shell: isWindows,
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Could not finish setup for ${label}.`));
      }
    });
  });
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

async function main() {
  console.clear();
  say('========================================');
  say('  CapyTech POS');
  say('========================================');
  say('');

  if (!fs.existsSync(path.join(backendDir, '.env'))) {
    say('The shop is not set up on this computer yet.');
    say('Ask your installer to copy the shop files and database first.');
    process.exitCode = 1;
    return;
  }

  const alreadyBackend = await backendReady();
  const alreadyTill = await tillReady();

  if (alreadyBackend && alreadyTill) {
    say('The till is already running.');
    say('Opening CapyTech POS...');
    openTill();
    say('');
    say('You can close this window. Keep selling in the browser.');
    return;
  }

  await ensureInstall(backendDir, 'the shop server');
  await ensureInstall(frontendDir, 'the till screen');

  if (!alreadyBackend) {
    say('Starting the shop...');
    run(npmCmd, ['run', 'start'], backendDir);
    await waitUntil(backendReady, 'The shop database did not start.');
  }

  if (!alreadyTill) {
    say('Opening the till screen...');
    run(npmCmd, ['run', 'dev'], frontendDir);
    await waitUntil(tillReady, 'The till screen did not open.');
  }

  openTill();
  say('');
  say('CapyTech POS is ready.');
  say('Keep this window open while you sell.');
  say('At the end of the day, close this window to stop the till.');
  say('');

  await new Promise((resolve) => {
    const finish = () => {
      stopChildren();
      resolve();
    };
    process.on('SIGINT', finish);
    process.on('SIGTERM', finish);
  });
}

process.on('uncaughtException', (error) => {
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
