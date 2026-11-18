import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar } from '../suporte/api.ts';
import { abrirFila } from '../suporte/chat.ts';
import { esperarEvento, eventosDaSessao } from '../suporte/eventos.ts';
import { aprovarAcoesAte, esperarGateAberto, semearExecucao, sessaoDaExecucao, type ExecucaoSemeada } from '../suporte/execucao.ts';
import { chamarInterno } from '../suporte/interno.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * Execução travada: o disjuntor, o aviso de execução parada e o Rearmar
 * (AT-799 e AT-800, RN-047, RN-1059, RN-1061), com eventos REAIS do Noop e sem
 * LLM.
 *
 * Arranjo: disjuntor do projeto em 1, UM módulo e DUAS tarefas. O Noop abre a
 * PR da primeira e espera o gate; a spec bloqueia a tarefa pela rota interna
 * (o mesmo caso de uso do ciclo de correção esgotado), o engine conta o
 * bloqueio, o agente vai a `idle_tripped` e, 5 s depois, o
 * `ExecucaoParadaWorker` grava `execution.stalled` (a segunda tarefa está
 * pendente atrás da bloqueada). Rearmar só é aceito pelo engine com o agente
 * em `idle_tripped` (`execution_command_controller.ex`), então o 2xx do POST
 * prova o estado real, não só o clique.
 *
 * Ordem dos testes importa (serial): o aviso de parada vem antes do Rearmar,
 * que o desfaz.
 */

test.describe.configure({ mode: 'serial' });

let token: string;
let exec: ExecucaoSemeada;
let agentId: string;
let taskId: string;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  token = await autenticar();
  exec = await semearExecucao(token, {
    modulos: [{ name: 'api' }],
    tarefas: [
      { modulo: 'api', titulo: 'Primeira tarefa' },
      { modulo: 'api', titulo: 'Segunda tarefa' },
    ],
    maxConsecutiveBlocked: 1,
  });
  ({ agentId, taskId } = await esperarGateAberto(token, exec));
  await chamarInterno(sessaoDaExecucao(exec), `tasks/${taskId}/block`, {
    agentId,
    reason: 'bloqueio semeado pelo E2E',
    diagnosis: 'a spec simula o ciclo de correção esgotado',
    origin: 'politica',
  });
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('a execução parada é avisada com o agente e a tarefa nomeados (AT-800)', { tag: '@f-execucao' }, async () => {
  const parada = await esperarEvento(token, sessaoDaExecucao(exec), 'execution.stalled', 90_000);
  const travados = parada.payload.agentesTravados as Array<{ agentId: string }>;
  const bloqueadas = parada.payload.tarefasBloqueadas as Array<{ taskId: string }>;
  expect(travados.map((a) => a.agentId)).toContain(agentId);
  expect(bloqueadas.map((t) => t.taskId)).toContain(taskId);

  await page.goto(`/projects/${exec.projectId}/sessions/${exec.execucaoId}`);
  await expect(page.locator('[data-testid="execucao-parada"]').first()).toBeVisible({ timeout: 30_000 });
  // Os mesmos botões do chat: Rearmar o agente travado e Desbloquear a tarefa.
  await expect(page.locator('[data-testid="destravar-execucao"] button')).toHaveCount(2);
});

test('o Rearmar do agente travado chega ao engine e o aviso sai (AT-799)', { tag: '@f-execucao' }, async () => {
  await page.goto(`/projects/${exec.projectId}/sessions/${exec.sessionId}`);
  await abrirFila(page, 'travados');
  const card = page.locator('[data-testid="agente-travado"]');
  await expect(card).toHaveCount(1, { timeout: 30_000 });

  const rearme = page.waitForResponse(
    (r) => r.url().endsWith(`/agents/${agentId}/rearm`) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await card.locator('button').click();
  expect((await rearme).status(), 'o engine recusou o Rearmar').toBeLessThan(300);
  await esperarEvento(token, sessaoDaExecucao(exec), 'dev.rearmed', 30_000);

  await page.goto(`/projects/${exec.projectId}/sessions/${exec.execucaoId}`);
  await expect(page.locator('[data-testid="destravar-execucao"]')).toHaveCount(0, { timeout: 30_000 });
});

/**
 * AT-984: o bloqueio que vem do gate falhando (`qa-lead`, origem `infra`) NÃO conta no
 * disjuntor do dev; o do próprio dev com origem `politica` (acima) conta. Com o disjuntor
 * em 1 e duas tarefas: o bloqueio de `qa-lead`/`infra` na primeira deixa o dev livre para
 * pegar a segunda (novo `dev.awaiting_gate`, sem `dev.idle_tripped`); só o bloqueio
 * `politica` na segunda o trava. Só API, sem navegador.
 */
test('o bloqueio do gate por infra não trava o dev; o da política trava (AT-984)', { tag: '@f-execucao' }, async () => {
  test.setTimeout(300_000);
  const e = await semearExecucao(token, {
    modulos: [{ name: 'api' }],
    tarefas: [
      { modulo: 'api', titulo: 'Primeira tarefa' },
      { modulo: 'api', titulo: 'Segunda tarefa' },
    ],
    maxConsecutiveBlocked: 1,
  });
  const sessao = sessaoDaExecucao(e);
  const primeira = await esperarGateAberto(token, e);
  await chamarInterno(sessao, `tasks/${primeira.taskId}/block`, {
    agentId: 'qa-lead',
    reason: 'o QA falhou por dentro',
    diagnosis: 'a spec simula a falha do gate',
    origin: 'infra',
  });

  // O dev segue livre: pega a segunda tarefa e abre o gate dela.
  const segunda = await aprovarAcoesAte(
    token,
    e,
    'dev.awaiting_gate',
    150_000,
    (ev) => ev.payload.taskId !== primeira.taskId,
  );
  expect((await eventosDaSessao(token, sessao)).map((ev) => ev.type), 'o dev não podia travar').not.toContain('dev.idle_tripped');

  await chamarInterno(sessao, `tasks/${String(segunda.payload.taskId)}/block`, {
    agentId: String(segunda.payload.agentId),
    reason: 'bloqueio semeado pelo E2E',
    diagnosis: 'a spec simula o ciclo de correção esgotado',
    origin: 'politica',
  });
  await esperarEvento(token, sessao, 'dev.idle_tripped', 60_000);
});
