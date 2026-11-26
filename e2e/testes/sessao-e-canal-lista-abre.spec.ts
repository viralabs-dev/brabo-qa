import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar, semearSessao, type SessaoSemeada } from '../suporte/api.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * A lista de sessões do projeto (AT-962): o título é o LINK da sessão (clique abre
 * `/projects/:id/sessions/:sid`) e o lápis renomeia sem sair da lista. Seletores por
 * papel e rótulo acessível (o link leva a hashtag `#<8 primeiros do id>`, que o id
 * semeado torna única na lista). Sem LLM.
 */

test.describe.configure({ mode: 'serial' });

let semeada: SessaoSemeada;
let context: BrowserContext;
let page: Page;
let hashtag: string;

const titulo = (nome: string | RegExp) => page.getByRole('link', { name: nome });

test.beforeAll(async ({ browser }) => {
  semeada = await semearSessao(await autenticar(), 'criativa');
  hashtag = `#${semeada.sessionId.slice(0, 8)}`;
  ({ context, page } = await contextoLogado(browser));
  await page.goto(`/projects/${semeada.projectId}?tab=todas`);
});

test.afterAll(async () => {
  await context?.close();
});

test('o lápis renomeia a sessão na própria lista, sem abri-la', { tag: '@f-sessao-e-canal' }, async () => {
  const link = titulo(new RegExp(hashtag));
  await expect(link).toBeVisible({ timeout: 45_000 });
  // O lápis nasce com opacity 0 e só aparece no hover/foco da linha.
  await link.hover();
  await page.getByRole('button', { name: 'Renomear sessão' }).click();
  await page.getByLabel('Nome da sessão').fill('Sessão renomeada pelo E2E');
  await page.getByLabel('Nome da sessão').press('Enter');

  await expect(titulo('Sessão renomeada pelo E2E')).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/sessions\//);
});

test('clicar no título abre a sessão', { tag: '@f-sessao-e-canal' }, async () => {
  await titulo('Sessão renomeada pelo E2E').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`));
});
