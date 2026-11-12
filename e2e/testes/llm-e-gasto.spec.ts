import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { API_URL, autenticar, semearSessao, type SessaoSemeada } from '../suporte/api.ts';
import { semearSessaoComDuble } from '../suporte/duble.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * Providers, modelos e gasto (AT-927): a aba Gastos (`?tab=spend`) carrega sem
 * erro e o resumo do gasto vem da api; o catálogo de modelos lista os modelos
 * e o dublê (provider `ollama`, sem chave e sem token pago) está entre eles.
 * Sem LLM: nenhum turno roda. O seletor da UI não tem `data-testid`, então o
 * catálogo que ele lista é provado na rota que o alimenta.
 */
test.describe.configure({ mode: 'serial' });

let token: string;
let semeada: SessaoSemeada;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  token = await autenticar();
  semeada = await semearSessao(token, 'criativa');
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

const get = async (url: string): Promise<unknown> => {
  const r = await fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  const texto = await r.text();
  if (!r.ok) throw new Error(`GET ${url} respondeu ${r.status}: ${texto.slice(0, 500)}`);
  return JSON.parse(texto);
};

test('a aba Gastos carrega e o resumo do gasto responde', { tag: '@f-llm-e-gasto' }, async () => {
  await page.goto(`/projects/${semeada.projectId}?tab=spend`);
  await expect(page).toHaveURL(/tab=spend/);
  // Erro da aba vira `role=alert`, nunca silêncio.
  await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[role="alert"]')).toHaveCount(0, { timeout: 30_000 });

  const resumo = (await get(`/workspaces/${semeada.workspaceId}/spend-report`)) as {
    workspaceId: string;
    totalMicros: number;
  };
  expect(resumo.workspaceId).toBe(semeada.workspaceId);
  expect(typeof resumo.totalMicros).toBe('number');
});

test('o catálogo de modelos lista os modelos, com o dublê entre eles', { tag: '@f-llm-e-gasto' }, async () => {
  const sessao = await semearSessaoComDuble(token, `Modelos ${Date.now()}`);
  const catalogo = (await get(`/workspaces/${sessao.workspaceId}/models/catalog`)) as {
    local?: Record<string, Array<{ id: string; provider: string }>>;
    cloud?: Record<string, Array<{ id: string; provider: string }>>;
  };
  const modelos = [...Object.values(catalogo.local ?? {}), ...Object.values(catalogo.cloud ?? {})].flat();
  expect(modelos.length).toBeGreaterThan(0);
  expect(modelos.some((m) => m.provider === 'ollama')).toBe(true);
});
