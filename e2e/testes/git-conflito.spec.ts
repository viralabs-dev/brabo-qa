import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { API_URL, autenticar } from '../suporte/api.ts';
import { eventosDaSessao } from '../suporte/eventos.ts';
import { aprovarAcoesAte, aprovarOsGates, esperarGateAberto, semearExecucao, type ExecucaoSemeada } from '../suporte/execucao.ts';
import { mergearPr, semearCommitConflitante } from '../suporte/git.ts';
import { cartao, contextoLogado } from '../suporte/navegador.ts';

/**
 * O merge com conflito (RN-704, RN-705, RN-715). O Noop grava um arquivo por
 * tarefa (`NOOP-task-<id8>.md`), então duas PRs dele nunca conflitam: a spec
 * semeia na `main` um commit que ADICIONA o mesmo caminho com outro conteúdo
 * (add/add, pela PR de infra, `suporte/git.ts`) e só então o gesto humano
 * mergeia a PR do Noop. O segundo caso prova a reentrega (AT-1001): o Noop
 * readota a branch, o push pendente é aprovado, a tarefa volta a `in_review` e o gate a
 * `awaiting_user`. Sem LLM.
 */

test.describe.configure({ mode: 'serial' });

let token: string;
let exec: ExecucaoSemeada;
let taskId: string;
let arquivo: string;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  token = await autenticar();
  exec = await semearExecucao(token, {
    modulos: [{ name: 'api' }],
    tarefas: [{ modulo: 'api', titulo: 'Conflito' }],
  });
  ({ taskId } = await esperarGateAberto(token, exec));
  await aprovarOsGates(exec, taskId);
  arquivo = `NOOP-task-${taskId.slice(0, 8)}.md`;
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

/** O estado da tarefa pela rota pública do backlog. */
async function tarefa(): Promise<{ status: string; gateStatus: string | null }> {
  const r = await fetch(`${API_URL}/projects/${exec.projectId}/backlog`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET .../backlog respondeu ${r.status}`);
  const epicos = (await r.json()) as Array<{ stories: Array<{ tasks: Array<{ id: string; status: string; gateStatus: string | null }> }> }>;
  const achada = epicos.flatMap((e) => e.stories.flatMap((h) => h.tasks)).find((t) => t.id === taskId);
  if (!achada) throw new Error(`a tarefa ${taskId} não está no backlog`);
  return achada;
}

/** Os ids das PRs abertas do repositório local. */
async function prsAbertas(): Promise<string[]> {
  const r = await fetch(`${API_URL}/projects/${exec.projectId}/code/pull-requests?state=open`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`GET .../code/pull-requests respondeu ${r.status}`);
  return ((await r.json()) as { items: Array<{ id: string | number }> }).items.map((i) => String(i.id));
}

test('o merge com conflito vira git_merge failed com a lista de arquivos', { tag: '@f-git' }, async () => {
  const sessao = { projectId: exec.projectId, sessionId: exec.sessionId };

  // Antes do commit semeado só a PR do Noop está aberta.
  const [prDoNoop = '', ...outras] = await prsAbertas();
  expect(outras, 'esperava só a PR do Noop aberta').toEqual([]);
  expect((await tarefa()).status, 'a tarefa devia estar em revisão antes do merge').toBe('in_review');

  await semearCommitConflitante(token, sessao, arquivo, 'conteúdo semeado pelo E2E, diferente do Noop\n');

  const merge = await mergearPr(token, sessao, prDoNoop);
  expect(merge.status).toBe('failed');
  expect(merge.executionResult).toMatchObject({ kind: 'git_merge', failed: true, conflictingFiles: [arquivo] });
  expect(await prsAbertas(), 'a PR do Noop devia seguir aberta (RN-704)').toContain(prDoNoop);

  const eventos = await eventosDaSessao(token, sessao);
  const conflito = eventos.find((e) => e.type === 'backlog.task_merge_conflict');
  expect(conflito?.payload).toMatchObject({ taskId, conflictingFiles: [arquivo] });
  expect(
    eventos.find((e) => e.type === 'backlog.task_status_changed' && e.payload.cause === 'merge_conflict')?.payload,
  ).toMatchObject({ taskId, status: 'in_progress' });

  expect(await tarefa()).toMatchObject({ status: 'in_progress', gateStatus: null });

  await page.goto(`/projects/${exec.projectId}?tab=prs`);
  await expect(page.locator('[data-testid="aviso-merge-recusado"]')).toContainText(arquivo, { timeout: 30_000 });
});

test('o Noop reentrega a PR depois do conflito e o cartão espera o merge', { tag: '@f-git' }, async () => {
  test.setTimeout(240_000);
  // O push da reentrega nasce `pending` (RN-689); o filtro pega só o gate aberto pelo conflito.
  await aprovarAcoesAte(token, exec, 'dev.awaiting_gate', 150_000, (ev) => ev.payload.cause === 'merge_conflict').catch(async (e: unknown) => {
    const log = await eventosDaSessao(token, { projectId: exec.projectId, sessionId: exec.execucaoId });
    const resumo = log.filter((v) => v.type.startsWith('dev.') || v.type.startsWith('proposed_action')).map((v) => `${v.type} ${JSON.stringify(v.payload).slice(0, 200)}`);
    throw new Error(`${String(e)}\neventos da execução:\n${resumo.join('\n')}`);
  });
  // O `in_review` do Noop vem antes da reabertura do gate (AT-983).
  await expect.poll(async () => (await tarefa()).status, { timeout: 60_000 }).toBe('in_review');
  await aprovarOsGates(exec, taskId);
  await expect.poll(async () => (await tarefa()).gateStatus, { timeout: 60_000 }).toBe('awaiting_user');

  await page.goto(`/projects/${exec.projectId}/sessions/${exec.sessionId}`);
  await expect(await cartao(page, 'dev-api')).toContainText('Esperando o seu merge', { timeout: 60_000 });
});
