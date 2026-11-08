import { expect, test } from '@playwright/test';
import { API_URL } from '../suporte/api.ts';

/** Smoke explícito da instalação (P2): /health de api e engine e a casca do web sem erro de página. Sem login. */
test.use({ storageState: { cookies: [], origins: [] } });

const ENGINE = process.env.E2E_ENGINE_URL ?? 'http://localhost:4000';

test('api e engine respondem /health e a casca do web carrega', { tag: '@f-instalacao' }, async ({ page }) => {
  for (const base of [API_URL, ENGINE]) {
    expect((await fetch(`${base}/health`)).status, `${base}/health`).toBe(200);
  }
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto('/login');
  await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 30_000 });
  expect(erros).toEqual([]);
});
