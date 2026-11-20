import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { API_URL, autenticar } from '../suporte/api.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * Tela de Containers do workspace (AT-1008, AT-976, AT-1006): a lista, o menu "…" da linha e o
 * detalhe. O compose do `e2e-pr` não tem broker (`sem_broker_na_instalacao`), então o projeto
 * semeado é "nunca provisionado": o que se prova é a tela e as ações DESABILITADAS com razão, não o
 * ciclo de vida do container (esse fica nas suítes do broker, da api e do engine). Sem LLM.
 *
 * O projeto nasce no PRIMEIRO workspace do usuário, o mesmo que a tela usa (`list[0]`). Os rótulos
 * são os do pt-BR, o idioma padrão do web.
 */
test.describe.configure({ mode: 'serial' });

let token: string;
let projectId: string;
let context: BrowserContext;
let page: Page;
const nome = `Container E2E ${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  token = await autenticar();
  const cabecalhos = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const lista = (await (await fetch(`${API_URL}/workspaces`, { headers: cabecalhos })).json()) as Array<{
    id?: string;
    workspace?: { id: string };
  }>;
  const workspaceId = lista[0]?.workspace?.id ?? lista[0]?.id;
  expect(workspaceId, 'o usuário não tem workspace').toBeTruthy();
  const resposta = await fetch(`${API_URL}/workspaces/${workspaceId}/projects`, {
    method: 'POST',
    headers: cabecalhos,
    body: JSON.stringify({ name: nome, slug: `ctr-${Date.now()}` }),
  });
  expect(resposta.ok, `POST projects respondeu ${resposta.status}`).toBe(true);
  projectId = ((await resposta.json()) as { id: string }).id;
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('a lista traz o projeto como "nunca provisionado" e o nome abre o detalhe', { tag: '@f-container-e-broker' }, async () => {
  await page.goto('/containers');
  const linha = page.locator('[data-testid="linha-da-tabela"]').filter({ hasText: nome });
  await expect(linha).toBeVisible({ timeout: 30_000 });
  await expect(linha.getByText('nunca provisionado')).toBeVisible();

  await linha.getByRole('link', { name: nome }).click();
  await expect(page).toHaveURL(new RegExp(`/containers/${projectId}$`));
  await expect(page.getByRole('heading', { name: nome })).toBeVisible();
  await expect(page.locator('[data-testid="container-detalhe"]')).toBeVisible();
});

test('o menu "…" da linha oferece Parar, Ver detalhes e Remover (AT-976)', { tag: '@f-container-e-broker' }, async () => {
  await page.goto('/containers');
  const linha = page.locator('[data-testid="linha-da-tabela"]').filter({ hasText: nome });
  await linha.getByRole('button', { name: `Mais ações de ${nome}` }).click();
  // Sem container registrado não há o que parar nem remover: os itens existem, desabilitados.
  await expect(page.getByRole('menuitem', { name: 'Parar' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Remover' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Ver detalhes' }).click();
  await expect(page).toHaveURL(new RegExp(`/containers/${projectId}$`));
});
