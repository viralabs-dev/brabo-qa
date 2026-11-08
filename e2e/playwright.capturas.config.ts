import { defineConfig, devices } from '@playwright/test';

/**
 * Config PRÓPRIA das capturas da doc (AT-859, ADR 0286). Fica fora de `playwright.config.ts` de propósito:
 * o `pnpm test` e o portão da `main` não podem rodar capturas, e as capturas não podem herdar o projeto `setup`
 * nem o `testDir` das specs (`./testes`, o que o validador de `funcionalidades.yml` enxerga).
 *
 *   pnpm exec playwright test -c playwright.capturas.config.ts
 *
 * Roda contra o compose de teste com o dublê de LLM ligado (`suporte/compose-duble.yml`) apontando para
 * `capturas/roteiro.json`. Os dois temas saem do MESMO contexto logado (ver `doc.captura.ts`).
 */
export default defineConfig({
  testDir: './capturas',
  testMatch: /.*\.captura\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Sem retry: a captura que falha por dado sensível NÃO pode ser tentada de novo até passar.
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: 'capturas/.resultado',
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:8088',
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
