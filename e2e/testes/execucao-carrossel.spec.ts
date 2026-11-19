import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar } from '../suporte/api.ts';
import { esperarGateAberto, semearExecucao, sessaoDaExecucao, type ExecucaoSemeada } from '../suporte/execucao.ts';
import { chamarInterno } from '../suporte/interno.ts';
import { cartao, contextoLogado } from '../suporte/navegador.ts';

/**
 * O carrossel de executores no chat do Criativo (AT-880, RN-1072 e RN-1073).
 *
 * Duas tarefas em dois módulos, `web` com `dependsOn: ['api']`. O spec abre a
 * sessão CRIATIVA (não a de execução) e prova: a faixa aparece com "x de N",
 * e o dev dependente cita a fundação de que espera. Os seletores são `data-testid`
 * (faixa, aba Executores e cartão por agente); nada de texto de tela.
 * Sem LLM.
 */

test.describe.configure({ mode: 'serial' });

let exec: ExecucaoSemeada;
let context: BrowserContext;
let page: Page;

/** Faixa de uma linha no chat do Criativo. */
const faixaDeEstado = (p: Page) => p.locator('[data-testid="faixa-de-estado"]');

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
  const barra = faixaDeEstado(page).locator('[role="progressbar"]');
  await expect(barra).toBeVisible({ timeout: 45_000 });
  await expect(barra).toHaveAttribute('aria-valuemax', '2');
  await expect(barra).toHaveAttribute('aria-valuenow', '0');
  await expect(await cartao(page, 'dev-api')).toBeVisible();
  await expect(await cartao(page, 'dev-web')).toBeVisible({ timeout: 45_000 });
});

test('o dev dependente mostra o motivo do ócio: cita o módulo de que espera', { tag: '@f-execucao' }, async () => {
  // O motivo é derivado do module_map + backlog (RN-1073); `dev-web` só fica ocioso depois do claim vazio.
  const dev = await cartao(page, 'dev-web');
  await expect(dev.filter({ hasText: 'api' })).toBeVisible({ timeout: 60_000 });
});

/**
 * Tarefa bloqueada com o gate aberto (AT-982 D e AT-985 L4): o Noop abre a PR e o gate
 * `awaiting_qa`; o bloqueio pela rota interna (`qa-lead`, origem `infra`) devolve a
 * tarefa a `todo` COM o gate aberto. O cartão do QA não pode seguir "Julgando" (o último
 * `pr.gate_changed` ainda é `awaiting_qa`) e diz que a PR espera voltar ao QA. Aqui o
 * texto É o objeto da asserção (o estado derivado no web), por isso é pt-BR.
 */
test.describe('com a tarefa bloqueada e o gate aberto', () => {
  test.describe.configure({ mode: 'serial' });
  let bloqueada: ExecucaoSemeada;
  let contexto: BrowserContext;
  let pagina: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const token = await autenticar();
    bloqueada = await semearExecucao(token, {
      modulos: [{ name: 'api' }],
      tarefas: [{ modulo: 'api', titulo: 'Tarefa bloqueada' }],
    });
    const { taskId } = await esperarGateAberto(token, bloqueada);
    await chamarInterno(sessaoDaExecucao(bloqueada), `tasks/${taskId}/block`, {
      agentId: 'qa-lead',
      reason: 'bloqueio semeado pelo E2E',
      diagnosis: 'o QA falhou por dentro',
      origin: 'infra',
    });
    ({ context: contexto, page: pagina } = await contextoLogado(browser));
    await pagina.goto(`/projects/${bloqueada.projectId}/sessions/${bloqueada.sessionId}`);
  });

  test.afterAll(async () => {
    await contexto?.close();
  });

  test('o cartão do QA não diz "Julgando" com a tarefa bloqueada', { tag: '@f-execucao' }, async () => {
    const qa = await cartao(pagina, 'qa');
    await expect(qa).toBeVisible({ timeout: 60_000 });
    await expect(qa).not.toContainText('Julgando');
  });

  test('a tarefa em todo com awaiting_qa mostra "espera voltar ao QA"', { tag: '@f-execucao' }, async () => {
    const qa = await cartao(pagina, 'qa');
    await expect(qa).toContainText('espera voltar ao QA', { timeout: 60_000 });
  });
});
