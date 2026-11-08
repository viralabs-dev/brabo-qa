import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar } from '../suporte/api.ts';
import { abrirFila } from '../suporte/chat.ts';
import { aprovarOsGates, esperarGateAberto, semearExecucao, type ExecucaoSemeada } from '../suporte/execucao.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * Mergear no chat com o repositório LOCAL (AT-740, ADR 0011): a PR que o Noop
 * abriu no bare repo aparece na fila "PRs prontas", o Mergear propõe e aprova
 * o `git_merge` pelos endpoints do cartão, o `LocalGitProvider` executa o merge
 * e a PR sai da fila de abertas. Era validado só no TP-01. Sem LLM e sem
 * GitHub.
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
    tarefas: [{ modulo: 'api', titulo: 'Listagem' }],
  });
  const { taskId } = await esperarGateAberto(token, exec);
  await aprovarOsGates(exec, taskId);
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('o Mergear da fila de PRs prontas faz o merge no repositório local', { tag: '@f-git' }, async () => {
  await page.goto(`/projects/${exec.projectId}/sessions/${exec.sessionId}`);
  await abrirFila(page, 'prontas');

  const pr = page.locator('[data-testid="pr-pronta"]');
  await expect(pr).toHaveCount(1, { timeout: 45_000 });

  const aprovacao = page.waitForResponse(
    (r) => /\/actions\/[^/]+\/approve$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await pr.locator('button').first().click(); // Mergear
  await pr.locator('button').first().click(); // Confirmar
  const decidida = await aprovacao;
  expect(decidida.status(), 'a api recusou a aprovação do merge').toBeLessThan(300);
  expect(((await decidida.json()) as { status?: string }).status, 'o merge local não executou').toBe('executed');

  // A PR mergeada deixa a lista de abertas (o painel relê as PRs depois do merge).
  await expect(pr).toHaveCount(0, { timeout: 30_000 });
});
