import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:3000', trace: 'off' },
  webServer: [
    {
      command: 'rm -rf apps/worker/.data/e2e && npm run start -w @calmling/worker',
      env: { PGLITE_DIR: '.data/e2e', TIME_SCALE: '300', ADMIN_TOKEN: 'e2e-admin', CHAT_OBSERVE_EVERY_SEC: '5' },
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -w @calmling/web',
      url: 'http://localhost:3000/about',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
