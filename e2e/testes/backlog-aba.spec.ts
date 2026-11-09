import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar, semearSessao, type SessaoSemeada } from '../suporte/api.ts';
import { anexarEvento } from '../suporte/eventos.ts';
import { criarEpico, criarHistoria } from '../suporte/interno.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * A aba Backlog (P2): história semeada pela rota interna aparece na aba, que
 * abre por deep-link (`?tab=backlog`). Sem LLM. Promover e arquivar ficam de
 * fora: o estado inicial da história depende da política do projeto.
 */
test.describe.configure({ mode: 'serial' });

let semeada: SessaoSemeada;
let context: BrowserContext;
let page: Page;
const titulo = `História do backlog ${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  const token = await autenticar();
  semeada = await semearSessao(token, 'criativa');
  const regra = await anexarEvento(token, semeada, 'artifact.business_rule', { kind: 'agent', id: 'po' }, {
    title: 'Regra semeada pelo E2E',
    text: 'O módulo entrega o combinado.',
  });
  const epico = await criarEpico(semeada, 'Épico do backlog');
  await criarHistoria(semeada, epico.id, titulo, [regra.id]);
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('a história semeada aparece na aba Backlog', { tag: '@f-backlog' }, async () => {
  await page.goto(`/projects/${semeada.projectId}?tab=backlog`);
  await expect(page.getByText(titulo).first()).toBeVisible({ timeout: 30_000 });
});
