import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const envFile = path.join(backendDir, '.env');
const imagesDir = path.join(backendDir, 'storage', 'product-images');
const backupsRoot = path.join(root, 'backups');
const isWindows = process.platform === 'win32';

function say(message) {
  console.log(message);
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

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

function existingFile(filePath) {
  return fs.existsSync(filePath) ? filePath : null;
}

function findPgDump() {
  const fromPath = isWindows ? 'pg_dump.exe' : 'pg_dump';
  const pathDirs = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);

  for (const dir of pathDirs) {
    const candidate = existingFile(path.join(dir, fromPath));
    if (candidate) {
      return candidate;
    }
  }

  const extra = [];

  if (isWindows) {
    extra.push(
      'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe'
    );

    try {
      for (const entry of fs.readdirSync('C:\\Program Files\\PostgreSQL')) {
        extra.push(
          path.join(
            'C:\\Program Files\\PostgreSQL',
            entry,
            'bin',
            'pg_dump.exe'
          )
        );
      }
    } catch {
      // No PostgreSQL folder.
    }
  } else {
    extra.push(
      '/opt/homebrew/bin/pg_dump',
      '/usr/local/bin/pg_dump',
      '/Applications/Postgres.app/Contents/Versions/latest/bin/pg_dump'
    );

    for (const cellar of [
      '/opt/homebrew/opt',
      '/usr/local/opt',
    ]) {
      try {
        for (const entry of fs.readdirSync(cellar)) {
          if (entry.startsWith('postgresql')) {
            extra.push(path.join(cellar, entry, 'bin', 'pg_dump'));
          }
        }
      } catch {
        // Not Homebrew.
      }
    }
  }

  for (const candidate of extra) {
    const found = existingFile(candidate);
    if (found) {
      return found;
    }
  }

  return null;
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Could not copy the shop database.'));
      }
    });
  });
}

function folderSize(dir) {
  if (!fs.existsSync(dir)) {
    return 0;
  }

  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += folderSize(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  console.clear();
  say('========================================');
  say('  CapyTech POS backup');
  say('========================================');
  say('');

  if (!fs.existsSync(envFile)) {
    say('This computer is not set up as the shop yet.');
    say('Ask your installer to finish setup, then try again.');
    process.exitCode = 1;
    return;
  }

  const env = loadEnv(envFile);
  const dbName = env.DB_NAME || 'pos_store';
  const dbUser = env.DB_USER || 'postgres';
  const dbHost = env.DB_HOST || 'localhost';
  const dbPort = env.DB_PORT || '5432';
  const dbPassword = env.DB_PASSWORD || '';

  const pgDump = findPgDump();
  if (!pgDump) {
    say('PostgreSQL tools were not found on this computer.');
    say('Ask your installer to install PostgreSQL, then try again.');
    process.exitCode = 1;
    return;
  }

  const dest = path.join(backupsRoot, `CapyTech_${stamp()}`);
  fs.mkdirSync(dest, { recursive: true });

  const dumpFile = path.join(dest, `${dbName}.dump`);
  say('Copying sales, products, and settings...');
  await run(
    pgDump,
    [
      '--host',
      dbHost,
      '--port',
      dbPort,
      '--username',
      dbUser,
      '--dbname',
      dbName,
      '--format',
      'custom',
      '--no-owner',
      '--no-acl',
      '--file',
      dumpFile,
    ],
    { PGPASSWORD: dbPassword }
  );

  say('Copying product photos...');
  const photosDest = path.join(dest, 'product-images');
  if (fs.existsSync(imagesDir)) {
    fs.cpSync(imagesDir, photosDest, { recursive: true });
  } else {
    fs.mkdirSync(photosDest, { recursive: true });
  }

  fs.copyFileSync(envFile, path.join(dest, 'shop.env'));

  fs.writeFileSync(
    path.join(dest, 'HOW-TO-RESTORE.txt'),
    [
      'CapyTech POS backup',
      '',
      `Made on: ${new Date().toString()}`,
      `Computer: ${os.hostname()}`,
      '',
      'Keep this whole folder on a USB stick, not only on this computer.',
      '',
      'To restore (installer only):',
      `  pg_restore --clean --if-exists --no-owner -h localhost -U postgres -d ${dbName} ${dbName}.dump`,
      '  Copy product-images into backend/storage/product-images',
      '  Copy shop.env to backend/.env',
      '',
    ].join('\n'),
    'utf8'
  );

  const dumpBytes = fs.existsSync(dumpFile) ? fs.statSync(dumpFile).size : 0;
  const photoBytes = folderSize(photosDest);

  say('');
  say('Backup complete.');
  say(`Saved to: ${dest}`);
  say(`Database: ${formatSize(dumpBytes)}`);
  say(`Photos:   ${formatSize(photoBytes)}`);
  say('');
  say('Copy this folder to a USB stick or an external drive.');
  say('Do not keep the only copy on this computer.');
}

await main().catch((error) => {
  say('');
  say(error instanceof Error ? error.message : 'Backup failed.');
  process.exitCode = 1;
});
