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
import { anexarEvento } from './eventos.ts';
import {
  criarEpico,
  criarHistoria,
  criarMapaDeModulos,
  criarTarefa,
  ligarModulos,
  type Modulo,
} from './interno.ts';

export interface PlanoDeExecucao {
  modulos: Modulo[];
  /** `modulo` é o nome de um módulo do mapa; cada tarefa ganha a própria história. */
  tarefas: Array<{ modulo: string; titulo: string }>;
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
  const sessao = await semearSessao(token, 'criativa');
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
