import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar } from '../suporte/api.ts';
import { aprovarOsGates, esperarGateAberto, semearExecucao, type ExecucaoSemeada } from '../suporte/execucao.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * PR pronta avisada na borda do fio (AT-810, RN-1063). No TP-01 27ª a PR
 * esperou 60 min pelo merge sem que nada avisasse.
 *
 * O Noop abre a PR da tarefa e o gate fica aberto; QA e SecOps aprovam pelas
 * rotas internas (o que o engine faria) e a tarefa vai a `awaiting_user`. Em
 * até 15 s (a releitura do backlog) o chat da sessão criativa mostra o
 * `aviso-pr-pronta`, o título da aba ganha o contador e o Mergear dele propõe
 * e aprova o `git_merge` (gesto humano, RN-418). Sem LLM.
 */

test.describe.configure({ mode: 'serial' });

let exec: ExecucaoSemeada;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const token = await autenticar();
  exec = await semearExecucao(token, {
    modulos: [{ name: 'api' }],
    tarefas: [{ modulo: 'api', titulo: 'Endpoint de cadastro' }],
  });
  const { taskId } = await esperarGateAberto(token, exec);
  await aprovarOsGates(exec, taskId);
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('a PR pronta aparece no aviso, o título ganha o contador e o Mergear faz o git_merge', { tag: '@f-chat-e-pendencias' }, async () => {
  await page.goto(`/projects/${exec.projectId}/sessions/${exec.sessionId}`);

  const aviso = page.locator('[data-testid="aviso-pr-pronta"]');
  await expect(aviso).toBeVisible({ timeout: 45_000 });
  await expect(page).toHaveTitle(/^\(1\) /);

  const proposta = page.waitForResponse(
    (r) => r.url().endsWith(`/sessions/${exec.sessionId}/actions`) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  const aprovacao = page.waitForResponse(
    (r) => /\/actions\/[^/]+\/approve$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await aviso.locator('button').first().click(); // Mergear
  await aviso.locator('button').first().click(); // Confirmar, na própria linha

  const acao = (await (await proposta).json()) as { actionType?: string };
  expect(acao.actionType).toBe('git_merge');
  const decidida = await aprovacao;
  expect(decidida.status(), 'a api recusou a aprovação do merge').toBeLessThan(300);
  expect(((await decidida.json()) as { status?: string }).status, 'o merge não executou').toBe('executed');
});
