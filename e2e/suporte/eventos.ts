/**
 * Eventos da sessão pela rota PÚBLICA (`POST .../sessions/:s/events`, papel
 * `developer`, AT-815 R1): o `type` é livre e o ator pode ser `user`, `agent`
 * ou `system`, então a spec semeia `agent.response`, `question.opened`,
 * `dev.idle_tripped` etc. sem LLM. A web renderiza o que está no log.
 */
import { API_URL, type SessaoSemeada } from './api.ts';

export interface Ator {
  kind: 'user' | 'agent' | 'system';
  id: string;
}

export interface EventoDaSessao {
  id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

async function corpoJson<T>(resposta: Response, oque: string): Promise<T> {
  const texto = await resposta.text();
  if (!resposta.ok) throw new Error(`${oque} respondeu ${resposta.status}: ${texto.slice(0, 500)}`);
  return JSON.parse(texto) as T;
}

export async function anexarEvento(
  token: string,
  sessao: Pick<SessaoSemeada, 'projectId' | 'sessionId'>,
  tipo: string,
  ator: Ator,
  carga: Record<string, unknown> = {},
): Promise<EventoDaSessao> {
  return corpoJson(
    await fetch(`${API_URL}/projects/${sessao.projectId}/sessions/${sessao.sessionId}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: tipo, actor: ator, payload: carga }),
    }),
    `POST .../events (${tipo})`,
  );
}

/** A cauda do log (200 eventos) pela rota pública. */
export async function eventosDaSessao(
  token: string,
  sessao: Pick<SessaoSemeada, 'projectId' | 'sessionId'>,
): Promise<EventoDaSessao[]> {
  const pagina = await corpoJson<{ items?: EventoDaSessao[] }>(
    await fetch(
      `${API_URL}/projects/${sessao.projectId}/sessions/${sessao.sessionId}/events?latest=true&limit=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
    'GET .../events',
  );
  return pagina.items ?? [];
}

/** Espera um evento do tipo aparecer no log; lança nomeando o tipo se o prazo estourar. */
export async function esperarEvento(
  token: string,
  sessao: Pick<SessaoSemeada, 'projectId' | 'sessionId'>,
  tipo: string,
  prazoMs = 60_000,
): Promise<EventoDaSessao> {
  const limite = Date.now() + prazoMs;
  for (;;) {
    const achado = (await eventosDaSessao(token, sessao)).find((e) => e.type === tipo);
    if (achado) return achado;
    if (Date.now() > limite) throw new Error(`o evento ${tipo} não apareceu em ${prazoMs} ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
