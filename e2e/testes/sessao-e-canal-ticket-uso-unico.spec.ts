import { expect, test } from '@playwright/test';
import { API_URL, autenticar, semearSessao } from '../suporte/api.ts';

/**
 * RN-108 de uso único: o ticket do socket abre UMA conexão no engine e a
 * segunda com o mesmo ticket é recusada no handshake. Sem navegador e sem
 * login a mais (usa o token memoizado da semeadura); o `socket-da-sessao`
 * prova só que o ticket vai na query.
 */
const ENGINE = process.env.E2E_ENGINE_URL ?? 'http://localhost:4000';

/** O ticket é consumido no JOIN do canal (session_channel.ex), então a prova é a resposta do `phx_join`. */
function entrar(ticket: string, sessionId: string): Promise<'aceito' | 'recusado'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${ENGINE.replace(/^http/, 'ws')}/socket/websocket?vsn=2.0.0&ticket=${encodeURIComponent(ticket)}`);
    const fim = (r: 'aceito' | 'recusado') => {
      clearTimeout(limite);
      ws.close();
      resolve(r);
    };
    const limite = setTimeout(() => fim('recusado'), 15_000);
    ws.addEventListener('open', () => ws.send(JSON.stringify(['1', '1', `session:${sessionId}`, 'phx_join', {}])));
    ws.addEventListener('error', () => fim('recusado'));
    ws.addEventListener('message', (m) => {
      const [, , , evento, carga] = JSON.parse(String(m.data)) as [unknown, unknown, unknown, string, { status?: string }];
      if (evento === 'phx_reply') fim(carga.status === 'ok' ? 'aceito' : 'recusado');
    });
  });
}

test('o ticket usado uma vez é recusado na segunda conexão', { tag: '@f-sessao-e-canal' }, async () => {
  const token = await autenticar();
  const sessao = await semearSessao(token);
  const resposta = await fetch(`${API_URL}/projects/${sessao.projectId}/sessions/${sessao.sessionId}/socket-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'heartbeat' }),
  });
  expect(resposta.status, 'a api recusou emitir o ticket').toBe(201);
  const { ticket } = (await resposta.json()) as { ticket: string };

  expect(await entrar(ticket, sessao.sessionId), 'o primeiro join devia ser aceito').toBe('aceito');
  expect(await entrar(ticket, sessao.sessionId), 'o ticket foi reaproveitado (RN-108)').toBe('recusado');
});
