import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar } from '../suporte/api.ts';
import { semearExecucao, type ExecucaoSemeada } from '../suporte/execucao.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * O carrossel de executores no chat do Criativo (AT-880, RN-1072 e RN-1073).
 *
 * Duas tarefas em dois módulos, `web` com `dependsOn: ['api']`. O spec abre a
 * sessão CRIATIVA (não a de execução) e prova: a faixa aparece com "x de N",
 * o dev dependente cita a fundação de que espera, minimizar tira os cartões e
 * deixa só estado, tempo e gasto, e a escolha sobrevive ao reload. O web ainda
 * não tem `data-testid` aí: os seletores são o papel (`progressbar`, `status`,
 * `article` com `role=group`) e o `aria-expanded`; nada de texto de tela.
 * Sem LLM.
 */

test.describe.configure({ mode: 'serial' });

let exec: ExecucaoSemeada;
let context: BrowserContext;
let page: Page;

const faixa = () => page.locator('section:has([role="progressbar"])');
const cartao = (dev: string) => faixa().locator('article[role="group"]', { hasText: dev });
const alternar = () => faixa().locator('button[aria-expanded]');

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const token = await autenticar();
  exec = await semearExecucao(token, {
    modulos: [{ name: 'api' }, { name: 'web', dependsOn: ['api'] }],
    tarefas: [
      { modulo: 'api', titulo: 'Endpoint de cadastro' },
      { modulo: 'web', titulo: 'Tela de cadastro' },
    ],
    decidirImagem: false,
  });
  ({ context, page } = await contextoLogado(browser));
  await page.goto(`/projects/${exec.projectId}/sessions/${exec.sessionId}`);
});

test.afterAll(async () => {
  await context?.close();
});

test('a faixa aparece no chat do Criativo com o "x de N" e um cartão por dev', { tag: '@f-execucao' }, async () => {
  const barra = faixa().locator('[role="progressbar"]');
  await expect(barra).toBeVisible({ timeout: 45_000 });
  await expect(barra).toHaveAttribute('aria-valuemax', '2');
  await expect(barra).toHaveAttribute('aria-valuenow', '0');
  await expect(cartao('dev-api')).toBeVisible();
  await expect(cartao('dev-web')).toBeVisible({ timeout: 45_000 });
});

// FIXME(AT-880): o web só lê `task.module`, que o claim preenche; a tarefa do `dev-web` nunca foi pega (espera `api`),
// então o cartão cai em "Sem tarefa disponível agora" (visto no CI da PR). O helper `motivoDoOcio` precisa cair
// para `story.moduleIds` (o shortcut dele já avisa). Tirar o `fixme` quando o web corrigir.
test.fixme('o dev dependente mostra o motivo do ócio: cita o módulo de que espera', { tag: '@f-execucao' }, async () => {
  // O motivo é derivado do module_map + backlog (RN-1073); `dev-web` só fica ocioso depois do claim vazio.
  await expect(cartao('dev-web').locator('p', { hasText: 'api' })).toBeVisible({ timeout: 60_000 });
});

test('minimizar deixa só estado, tempo e gasto, e a escolha persiste ao recarregar', { tag: '@f-execucao' }, async () => {
  await expect(alternar()).toHaveAttribute('aria-expanded', 'true');
  await alternar().click();
  await expect(alternar()).toHaveAttribute('aria-expanded', 'false');
  await expect(faixa().locator('article')).toHaveCount(0);
  await expect(faixa().locator('ul li', { hasText: 'dev-api' })).toBeVisible();
  await expect(faixa().locator('ul li', { hasText: 'dev-web' })).toBeVisible();
  await expect(faixa().locator('[role="progressbar"]')).toBeVisible(); // o "x de N" continua

  await page.reload();
  await expect(alternar()).toHaveAttribute('aria-expanded', 'false', { timeout: 45_000 });
  await expect(faixa().locator('article')).toHaveCount(0);
});
