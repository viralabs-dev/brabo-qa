import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar, semearSessao, type SessaoSemeada } from '../suporte/api.ts';
import { chamarInterno, criarMapaDeModulos } from '../suporte/interno.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * A aba Arquitetura renderiza o C4 semeado (P2): mapa de módulos e diagrama
 * pelas rotas internas, e o mermaid desenha um SVG no navegador. Sem LLM.
 */
test.describe.configure({ mode: 'serial' });

let semeada: SessaoSemeada;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  const token = await autenticar();
  semeada = await semearSessao(token, 'criativa');
  await criarMapaDeModulos(semeada, [{ name: 'api' }, { name: 'web', dependsOn: ['api'] }]);
  await chamarInterno(semeada, 'c4-diagram', { systemName: 'Sistema E2E', actors: [{ name: 'Operador' }] });
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('a aba Arquitetura desenha o diagrama C4 semeado', { tag: '@f-conhecimento' }, async () => {
  await page.goto(`/projects/${semeada.projectId}?tab=arquitetura`);
  await expect(page.locator('svg[id^="mermaid"], svg[aria-roledescription]').first()).toBeVisible({ timeout: 45_000 });
});
