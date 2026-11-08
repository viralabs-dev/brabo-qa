/**
 * Semeadura de um commit conflitante no repositório local do projeto (AT-842),
 * só por rotas PÚBLICAS: nada de Docker nem de `git` no volume. O caminho é a
 * ação `open_infra_pr` (commita arquivos de caminho livre numa branch nascida
 * da `main` e abre a PR) seguida do `git_merge` dela na `main`. Quem faz o
 * merge é sempre o gesto do usuário semeado (RN-418, RN-689).
 */
import { API_URL, type SessaoSemeada } from './api.ts';

type Sessao = Pick<SessaoSemeada, 'projectId' | 'sessionId'>;

export interface AcaoDecidida {
  id: string;
  status: string;
  executionResult?: Record<string, unknown>;
}

async function chamar(token: string, rota: string, corpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${API_URL}${rota}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`POST ${rota} respondeu ${r.status}: ${texto.slice(0, 500)}`);
  return JSON.parse(texto) as Record<string, unknown>;
}

/** Propõe a ação e, se ela nasceu `pending`, aprova (o gesto humano). `auto_approved` já vem executada. */
async function proporEDecidir(
  token: string,
  s: Sessao,
  actionType: string,
  actor: { kind: 'agent'; id: string },
  payload: Record<string, unknown>,
): Promise<AcaoDecidida> {
  const base = `/projects/${s.projectId}/sessions/${s.sessionId}/actions`;
  const proposta = await chamar(token, base, { actionType, actor, payload });
  const decidida = proposta.status === 'pending' ? await chamar(token, `${base}/${String(proposta.id)}/approve`, {}) : proposta;
  return decidida as unknown as AcaoDecidida;
}

/** Propõe e aprova o `git_merge` da PR na `main`. Devolve a ação decidida (`executed` ou `failed`). */
export const mergearPr = (token: string, s: Sessao, pullRequestId: string) =>
  proporEDecidir(token, s, 'git_merge', { kind: 'agent', id: 'dev-api' }, { pullRequestId, targetBranch: 'main' });

/**
 * Commita `caminho` com `conteudo` na `main` do projeto (PR de infra aberta e mergeada) e devolve o id da PR.
 * Lança se algum dos dois passos não terminar `executed`.
 */
export async function semearCommitConflitante(token: string, s: Sessao, caminho: string, conteudo: string): Promise<string> {
  const aberta = await proporEDecidir(token, s, 'open_infra_pr', { kind: 'agent', id: 'infra-lead' }, {
    title: 'Commit semeado pelo E2E',
    files: [{ path: caminho, content: conteudo }],
    // RN-852: `run` é obrigatório; sem `app`, o `decide` não muda.
    run: { command: 'true', urls: [{ label: 'web', url: 'http://localhost:3000', kind: 'web' }], envExample: false },
  });
  const pullRequestId = String(aberta.executionResult?.pullRequestId ?? '');
  if (aberta.status !== 'executed' || !pullRequestId) {
    throw new Error(`o open_infra_pr não executou (status ${aberta.status}): ${JSON.stringify(aberta).slice(0, 400)}`);
  }
  const mergeada = await mergearPr(token, s, pullRequestId);
  if (mergeada.status !== 'executed') {
    throw new Error(`o merge da PR semeada não executou (status ${mergeada.status}): ${JSON.stringify(mergeada).slice(0, 400)}`);
  }
  return pullRequestId;
}
