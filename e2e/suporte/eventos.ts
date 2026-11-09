/**
 * Eventos da sessão pela rota PÚBLICA (`POST .../sessions/:s/events`, papel
 * `developer`, AT-815 R1): o `type` é livre e o ator pode ser `user`, `agent`
 * ou `system`, então a spec semeia `agent.response`, `question.opened`,
 * `dev.idle_tripped` etc. sem LLM. A web renderiza o que está no log.
 */
import type { Page } from '@playwright/test';
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

export interface FrameDoCanal {
  topico: string;
  evento: string;
  carga: Record<string, unknown>;
}

/**
 * Um frame do Phoenix: o serializador v2 manda `[join_ref, ref, topic, event,
 * payload]`; o v1, um objeto. Qualquer outra coisa (binário, heartbeat
 * malformado) não é deste canal.
 */
function lerFrame(bruto: string | Buffer): FrameDoCanal | null {
  if (typeof bruto !== 'string') return null;
  let dado: unknown;
  try {
    dado = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (Array.isArray(dado) && dado.length === 5) {
    const [, , topico, evento, carga] = dado as [unknown, unknown, unknown, unknown, unknown];
    if (typeof topico !== 'string' || typeof evento !== 'string') return null;
    return { topico, evento, carga: (carga ?? {}) as Record<string, unknown> };
  }
  if (dado && typeof dado === 'object') {
    const o = dado as { topic?: unknown; event?: unknown; payload?: unknown };
    if (typeof o.topic !== 'string' || typeof o.event !== 'string') return null;
    return { topico: o.topic, evento: o.event, carga: (o.payload ?? {}) as Record<string, unknown> };
  }
  return null;
}

/**
 * Os frames do canal `session:<id>` que a página recebe, do socket do engine.
 * Registre ANTES do `goto`: o socket pode subir antes de a navegação voltar.
 */
export function ouvirCanal(page: Page, sessionId: string): FrameDoCanal[] {
  const frames: FrameDoCanal[] = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/socket/websocket')) return;
    ws.on('framereceived', ({ payload }) => {
      const frame = lerFrame(payload);
      if (frame && frame.topico === `session:${sessionId}`) frames.push(frame);
    });
  });
  return frames;
}
