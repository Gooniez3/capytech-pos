import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('V2 installer uses only dedicated identities and fails on collisions', () => {
  const source = read('scripts/install-shop-v2.mjs');
  assert.match(source, /const dbName = 'capytech_pos_v2'/);
  assert.match(source, /const shopRole = 'capytech_v2_user'/);
  assert.match(source, /assertFreshV2DatabaseAndRole\(psql\)/);
  assert.match(source, /database or role already exists/);
  assert.match(source, /expectedInstallDir/);
  assert.match(source, /\['ci'\]/);
  assert.doesNotMatch(source, /DROP DATABASE|DROP ROLE|ALTER ROLE|TRUNCATE|DELETE FROM/i);
});

test('V2 runtime is pinned to dedicated ports, database, role, and folder', () => {
  const start = read('scripts/start-pos-v2.mjs');
  const vite = read('frontend/vite.config.ts');
  assert.match(start, /capytech_pos_v2/);
  assert.match(start, /capytech_v2_user/);
  assert.match(start, /portIsOpen\(4001\)/);
  assert.match(start, /portIsOpen\(5174\)/);
  assert.match(start, /current_database\(\).*current_user/);
  assert.match(start, /VITE_PORT: '5174'/);
  assert.match(start, /VITE_API_PROXY_TARGET: 'http:\/\/127\.0\.0\.1:4001'/);
  assert.match(vite, /strictPort: true/);
});

test('V2 backup is isolated from original ports, launchers, and storage', () => {
  const source = read('scripts/backup-shop-v2.mjs');
  assert.match(source, /env\.DB_NAME !== 'capytech_pos_v2'/);
  assert.match(source, /env\.DB_USER !== 'capytech_v2_user'/);
  assert.match(source, /portIsOpen\(5174\)/);
  assert.match(source, /CapyTech POS V2 Backups/);
  assert.match(source, /Start CapyTech POS V2\.command/);
  assert.match(source, /https:\/\/localhost:5174/);
  assert.doesNotMatch(source, /'Start CapyTech POS\.command'|'Backup CapyTech POS\.command'/);
});

test('macOS launchers are V2-specific and use LF line endings', () => {
  for (const file of [
    'Install CapyTech POS V2.command',
    'Start CapyTech POS V2.command',
    'Backup CapyTech POS V2.command',
  ]) {
    const source = read(file);
    assert.ok(source.startsWith('#!/bin/bash\n'), file);
    assert.doesNotMatch(source, /\r/, file);
    assert.match(source, /-v2\.mjs/, file);
  }
});
