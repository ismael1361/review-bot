import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'review-bot-e2e-'));

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3300',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run build && node dist/server/server.js',
    url: 'http://127.0.0.1:3300/healthz',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      PORT: '3300',
      PUBLIC_URL: 'http://127.0.0.1:3300',
      DATA_DIR: dataDir,
      APP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      SETUP_TOKEN: 'token-de-setup-e2e-123456',
      LOG_LEVEL: 'warn',
    },
  },
});
