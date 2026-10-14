import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must explicitly identify the disposable E2E environment`);
  return value;
}

const database = requiredEnvironment('CAPYTECH_E2E_DB_NAME');
const databaseHost = requiredEnvironment('CAPYTECH_E2E_DB_HOST');
const databasePort = Number(requiredEnvironment('CAPYTECH_E2E_DB_PORT'));
const databaseUser = requiredEnvironment('CAPYTECH_E2E_DB_USER');
const databasePassword = requiredEnvironment('CAPYTECH_E2E_DB_PASSWORD');

if (!/^capytech_e2e_[a-z0-9_]+$/.test(database) || database === 'pos_store') {
  throw new Error(`Refusing unsafe E2E database: ${database}`);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(databaseHost)) {
  throw new Error(`E2E database host must be loopback, received: ${databaseHost}`);
}
if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
  throw new Error(`Invalid CAPYTECH_E2E_DB_PORT: ${process.env.CAPYTECH_E2E_DB_PORT}`);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(os.tmpdir(), 'capytech-e2e', database);
const storageRoot = path.join(artifactRoot, 'storage');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['line']],
  outputDir: path.join(artifactRoot, 'results'),
  use: {
    baseURL: 'https://127.0.0.1:5573',
    channel: 'chrome',
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  webServer: [
    {
      command: 'node src/server.js',
      cwd: path.join(repositoryRoot, 'backend'),
      url: 'http://127.0.0.1:4400/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        PORT: '4400',
        DB_HOST: databaseHost,
        DB_PORT: String(databasePort),
        DB_NAME: database,
        DB_USER: databaseUser,
        DB_PASSWORD: databasePassword,
        JWT_SECRET: 'phase-3f2-disposable-browser-tests-only',
        PRODUCT_IMAGES_DIR: storageRoot,
      },
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5573',
      cwd: path.join(repositoryRoot, 'frontend'),
      url: 'https://127.0.0.1:5573',
      reuseExistingServer: false,
      timeout: 30_000,
      ignoreHTTPSErrors: true,
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: 'http://127.0.0.1:4400',
      },
    },
  ],
});
