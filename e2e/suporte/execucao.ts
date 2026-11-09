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
import { API_URL, idsPendentes, semearSessao, type SessaoSemeada } from './api.ts';
import { anexarEvento, eventosDaSessao } from './eventos.ts';
import {
  criarEpico,
  decidirImagem,
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
  /** `false` semeia sem a decisão de imagem (padrão: decide, e libera `/code/*`). AT-843. */
  decidirImagem?: boolean;
  /** O nome que a tela mostra para o projeto (as capturas da doc, AT-872). */
  name?: string;
  /** Os textos que a tela mostra (as capturas da doc, AT-874); o padrão é o do E2E. */
  regra?: { title: string; text: string };
  epico?: string;
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
    ...(plano.name ? { name: plano.name } : {}),
  });
  const sufixo = Date.now();

  await postar(token, `/projects/${sessao.projectId}/git/local/repository`, {
    name: `e2e-${sufixo}`,
    visibility: 'private',
  });
  await criarMapaDeModulos(sessao, plano.modulos);
  if (plano.decidirImagem !== false) await decidirImagem(sessao); // libera `/code/*` (portão da aba Code, RN-105)

  // A história só é promovida com ao menos uma regra de negócio EXISTENTE (evento `artifact.business_rule`).
  const regra = await anexarEvento(token, sessao, 'artifact.business_rule', { kind: 'agent', id: 'po' }, plano.regra ?? {
    title: 'Regra semeada pelo E2E',
    text: 'O módulo entrega o combinado.',
  });
  const epico = await criarEpico(sessao, plano.epico ?? 'Épico semeado pelo E2E');

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
 * Espera `tipo` no log da execução APROVANDO as ações pendentes dela. O
 * `git_push` e o `pr_open` do dev estão no teto de efeito externo (RN-418,
 * RN-689): nascem `pending` mesmo com o dev em `auto_approve`, e quem decide é
 * o usuário. Sem este gesto o Noop fica em `awaiting_approval` para sempre.
 */
export async function aprovarAcoesAte(token: string, e: ExecucaoSemeada, tipo: string, prazoMs = 150_000) {
  const sessao = sessaoDaExecucao(e);
  const limite = Date.now() + prazoMs;
  for (;;) {
    const achado = (await eventosDaSessao(token, sessao)).find((ev) => ev.type === tipo);
    if (achado) return achado;
    for (const id of await idsPendentes(token, { ...e, sessionId: e.execucaoId })) {
      // 409 numa corrida com outra decisão não importa: o próximo giro relê a fila.
      await fetch(`${API_URL}/projects/${e.projectId}/sessions/${e.execucaoId}/actions/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
    }
    if (Date.now() > limite) throw new Error(`o evento ${tipo} não apareceu em ${prazoMs} ms`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Espera o Noop abrir a PR da primeira tarefa (aprovando o push e a PR) e
 * entrar em `dev.awaiting_gate`, com o gate aberto. Devolve o agente e a
 * tarefa, que as specs usam nas rotas internas.
 */
export async function esperarGateAberto(token: string, e: ExecucaoSemeada): Promise<{ agentId: string; taskId: string }> {
  const aguardando = await aprovarAcoesAte(token, e, 'dev.awaiting_gate');
  return { agentId: String(aguardando.payload.agentId), taskId: String(aguardando.payload.taskId) };
}

/** QA e SecOps aprovam: a tarefa vai a `awaiting_user` e a PR fica pronta para o dono mergear (RN-825). */
export async function aprovarOsGates(e: ExecucaoSemeada, taskId: string): Promise<void> {
  await vereditoDeGate(sessaoDaExecucao(e), taskId, 'qa', 'approved');
  await vereditoDeGate(sessaoDaExecucao(e), taskId, 'secops', 'approved');
}
