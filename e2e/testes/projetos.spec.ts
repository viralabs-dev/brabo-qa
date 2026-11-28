import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { API_URL, autenticar } from '../suporte/api.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * Assistente de projeto novo (AT-1040, RN-513, ADR 0301): abre pelo "Novo projeto" da lateral, oferece
 * Criar novo e Adotar existente, e cria o projeto, que aparece na lista. O compose do `e2e-pr` não tem
 * broker (`sem_broker_na_instalacao`), então o que se afirma é o que ESSE ambiente mostra: o padrão é
 * `runner`, e Container e Pasta montada ficam inertes com o aviso dito uma vez. Vale igual antes e depois
 * do ADR 0301 (sem broker os dois comportam-se igual). O padrão `container` com broker confirmado fica
 * nos testes de unidade do web. Sem LLM. Os rótulos são os do pt-BR, o idioma padrão do web.
 */
test.describe.configure({ mode: 'serial' });

let token: string;
let context: BrowserContext;
let page: Page;
const nome = `Projeto E2E ${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  token = await autenticar();
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

const abrirAssistente = async () => {
  await page.goto('/');
  await page.locator('[data-slot="sidebar-menu-button"]', { hasText: 'Novo projeto' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible({ timeout: 30_000 });
  return dialogo;
};

test('o assistente abre e oferece Criar novo e Adotar existente', { tag: '@f-projetos' }, async () => {
  const dialogo = await abrirAssistente();
  await expect(dialogo.getByText('Novo projeto').first()).toBeVisible();
  await expect(dialogo.getByRole('button', { name: /^Criar novo/ })).toBeVisible();
  await expect(dialogo.getByRole('button', { name: /^Adotar existente/ })).toBeVisible();
  // Sem escolher a origem não há para onde ir.
  await expect(dialogo.getByRole('button', { name: 'Continuar' })).toBeDisabled();
});

test('sem broker o padrão é Runner local e Container e Pasta montada ficam inertes com o aviso', { tag: '@f-projetos' }, async () => {
  const dialogo = await abrirAssistente();
  await dialogo.getByRole('button', { name: /^Criar novo/ }).click();
  await dialogo.getByRole('button', { name: 'Continuar' }).click();

  await expect(dialogo.locator('[data-testid="aviso-sem-broker"]')).toBeVisible({ timeout: 30_000 });
  await expect(dialogo.getByRole('button', { name: /^Runner local/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialogo.getByRole('button', { name: /^Container/ })).toBeDisabled();
  // A Pasta montada só é oferecida com a base de projetos conhecida; se aparecer, sem broker está inerte.
  const montada = dialogo.getByRole('button', { name: /^Pasta montada/ });
  if (await montada.count()) await expect(montada).toBeDisabled();
});

test('criar o projeto no padrão Runner local o leva para a tela dele e ele aparece na lista', { tag: '@f-projetos' }, async () => {
  const dialogo = await abrirAssistente();
  await dialogo.getByRole('button', { name: /^Criar novo/ }).click();
  await dialogo.getByRole('button', { name: 'Continuar' }).click();
  await dialogo.locator('#projeto-slug').fill(nome);
  await dialogo.locator('#workspace-path').fill(`/tmp/e2e-projetos-${Date.now()}`);
  await dialogo.getByRole('button', { name: 'Continuar' }).click();
  await dialogo.getByRole('button', { name: 'Criar projeto' }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/, { timeout: 30_000 });
  await expect(dialogo).toBeHidden();
  await expect(page.getByRole('link', { name: nome }).first()).toBeVisible({ timeout: 30_000 });

  // A api também o lista, no modo escolhido.
  const cabecalhos = { Authorization: `Bearer ${token}` };
  const workspaces = (await (await fetch(`${API_URL}/workspaces`, { headers: cabecalhos })).json()) as Array<{
    id?: string;
    workspace?: { id: string };
  }>;
  const workspaceId = workspaces[0]?.workspace?.id ?? workspaces[0]?.id;
  const projetos = (await (await fetch(`${API_URL}/workspaces/${workspaceId}/projects`, { headers: cabecalhos })).json()) as Array<{
    name: string;
    executionMode?: string;
  }>;
  expect(projetos.find((p) => p.name === nome)?.executionMode).toBe('runner');
});
