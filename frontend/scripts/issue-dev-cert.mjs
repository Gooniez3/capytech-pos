import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const certDir = path.dirname(fileURLToPath(import.meta.url));
const repoCertDir = path.resolve(certDir, '../certs');
const certFile = path.join(repoCertDir, 'cert.pem');
const keyFile = path.join(repoCertDir, 'key.pem');

function lanIPv4s() {
  const addresses = new Set();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const ipv4 = entry.family === 'IPv4' || entry.family === 4;
      if (!ipv4 || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      addresses.add(entry.address);
    }
  }
  return [...addresses];
}

function mkcertAvailable() {
  const result = spawnSync('mkcert', ['-help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0 || result.status === 1;
}

fs.mkdirSync(repoCertDir, { recursive: true });

const names = ['localhost', '127.0.0.1', '::1', ...lanIPv4s()];

if (!mkcertAvailable()) {
  console.warn(
    'mkcert not found. Phone scanner HTTPS may fail if certs/cert.pem does not include this PC LAN IP.'
  );
  process.exit(0);
}

const issued = spawnSync(
  'mkcert',
  ['-cert-file', certFile, '-key-file', keyFile, ...names],
  { stdio: 'inherit' }
);

if (issued.status !== 0) {
  console.warn('mkcert could not refresh the local certificate.');
  process.exit(0);
}

console.log(`Dev certificate includes: ${names.join(', ')}`);
