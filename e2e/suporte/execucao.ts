/**
 * Semeia uma EXECUÇÃO sem LLM (AT-815 R1): repo local, mapa de módulos,
 * backlog e a ativação com `devAgentImpl: 'noop'`, que usa o mesmo `AgentIo`
 * dos dev agents reais (claim, worktree, commit, push, PR e gate).
 *
 * A ordem espelha `scripts/demo-noop-execution.ts` da api: sem repo a
 * ativação é 409 (RN-582), sem módulo no mapa não sobe agente, e a história
 * só é pegável `ready` e ligada ao módulo. O papel de quem ativa é o do
 * usuário semeado (owner do workspace), que é o que o IAM dos agentes herda.
 */
import { API_URL, semearSessao, type SessaoSemeada } from './api.ts';
import { anexarEvento, esperarEvento } from './eventos.ts';
import {
  criarEpico,
  criarHistoria,
  criarMapaDeModulos,
  criarTarefa,
  vereditoDeGate,
  ligarModulos,
  type Modulo,
} from './interno.ts';

export interface PlanoDeExecucao {
  modulos: Modulo[];
  /** `modulo` é o nome de um módulo do mapa; cada tarefa ganha a própria história. */
  tarefas: Array<{ modulo: string; titulo: string }>;
  /** O disjuntor do projeto (RN-047): `1` trava o agente na primeira tarefa bloqueada. */
  maxConsecutiveBlocked?: number;
}

export interface ExecucaoSemeada extends SessaoSemeada {
  /** A sessão de execução que a ativação criou. */
  execucaoId: string;
  tarefaIds: string[];
}

async function postar(token: string, rota: string, corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resposta = await fetch(`${API_URL}${rota}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  if (!resposta.ok) throw new Error(`POST ${rota} respondeu ${resposta.status}: ${texto.slice(0, 500)}`);
  return JSON.parse(texto) as Record<string, unknown>;
}

export async function semearExecucao(token: string, plano: PlanoDeExecucao): Promise<ExecucaoSemeada> {
  const sessao = await semearSessao(token, 'criativa', {
    ...(plano.maxConsecutiveBlocked ? { maxConsecutiveBlocked: plano.maxConsecutiveBlocked } : {}),
  });
  const sufixo = Date.now();

  await postar(token, `/projects/${sessao.projectId}/git/local/repository`, {
    name: `e2e-${sufixo}`,
    visibility: 'private',
  });
  await criarMapaDeModulos(sessao, plano.modulos);

  // A história só é promovida com ao menos uma regra de negócio EXISTENTE (evento `artifact.business_rule`).
  const regra = await anexarEvento(token, sessao, 'artifact.business_rule', { kind: 'agent', id: 'po' }, {
    title: 'Regra semeada pelo E2E',
    text: 'O módulo entrega o combinado.',
  });
  const epico = await criarEpico(sessao, 'Épico semeado pelo E2E');

  const tarefaIds: string[] = [];
  for (const [i, t] of plano.tarefas.entries()) {
    const historia = await criarHistoria(sessao, epico.id, `História ${i + 1}: ${t.titulo}`, [regra.id]);
    await ligarModulos(sessao, historia.id, [t.modulo]);
    tarefaIds.push((await criarTarefa(sessao, historia.id, t.titulo)).id);
  }

  const ativada = await postar(token, `/projects/${sessao.projectId}/execution/activate`, {
    devAgentImpl: 'noop',
  });
  const execucaoId = String(ativada.sessionId ?? '');
  if (!execucaoId) throw new Error(`a ativação não devolveu sessionId: ${JSON.stringify(ativada).slice(0, 300)}`);
  return { ...sessao, execucaoId, tarefaIds };
}

/** A sessão de EXECUÇÃO da semeadura: onde moram os eventos `dev.*` e onde o engine registra as tarefas. */
export const sessaoDaExecucao = (e: ExecucaoSemeada) => ({ projectId: e.projectId, sessionId: e.execucaoId });

/**
 * Espera o Noop abrir a PR da primeira tarefa e entrar em `dev.awaiting_gate`
 * (o gate já está aberto). Devolve o agente e a tarefa, que as specs usam nas
 * rotas internas.
 */
export async function esperarGateAberto(token: string, e: ExecucaoSemeada): Promise<{ agentId: string; taskId: string }> {
  const aguardando = await esperarEvento(token, sessaoDaExecucao(e), 'dev.awaiting_gate', 120_000);
  return { agentId: String(aguardando.payload.agentId), taskId: String(aguardando.payload.taskId) };
}

/** QA e SecOps aprovam: a tarefa vai a `awaiting_user` e a PR fica pronta para o dono mergear (RN-825). */
export async function aprovarOsGates(e: ExecucaoSemeada, taskId: string): Promise<void> {
  await vereditoDeGate(sessaoDaExecucao(e), taskId, 'qa', 'approved');
  await vereditoDeGate(sessaoDaExecucao(e), taskId, 'secops', 'approved');
}
