import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storageRoot = 'C:\\tmp\\capytech-2g1-storage-1d4560e';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['line']],
  outputDir: 'C:\\tmp\\capytech-2g1-playwright-results-1d4560e',
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
        DB_HOST: '127.0.0.1',
        DB_PORT: '55439',
        DB_NAME: 'capytech_e2e_2g1_20261013d_1d4560e',
        DB_USER: 'capytech_e2e_admin',
        DB_PASSWORD: 'e2e-only-unused',
        JWT_SECRET: 'phase-2g1-disposable-browser-tests-only',
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
