import { defineConfig, devices } from '@playwright/test';

/**
 * Config das capturas da v9 (AT-897): o produto fotografado a 1440 px nos dois temas, para a "Comparação v9" do Vault.
 * NÃO é a captura da doc (`playwright.capturas.config.ts`, 1366×768, ADR 0286/0289) e não roda no CI.
 *
 *   pnpm exec playwright test -c playwright.capturas-v9.config.ts
 */
export default defineConfig({
  testDir: './capturas-v9',
  testMatch: /.*\.captura\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: 'capturas-v9/.resultado',
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:8088',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
