import { expect, test } from '@playwright/test';
import { API_URL, autenticar, semearSessao } from '../suporte/api.ts';

/**
 * RN-108 de uso único: o ticket do socket abre UMA conexão no engine e a
 * segunda com o mesmo ticket é recusada no handshake. Sem navegador e sem
 * login a mais (usa o token memoizado da semeadura); o `socket-da-sessao`
 * prova só que o ticket vai na query.
 */
const ENGINE = process.env.E2E_ENGINE_URL ?? 'http://localhost:4000';

function conectar(ticket: string): Promise<'aberto' | 'recusado'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${ENGINE.replace(/^http/, 'ws')}/socket/websocket?vsn=2.0.0&ticket=${encodeURIComponent(ticket)}`);
    const limite = setTimeout(() => {
      ws.close();
      resolve('recusado');
    }, 15_000);
    ws.addEventListener('open', () => {
      clearTimeout(limite);
      ws.close();
      resolve('aberto');
    });
    ws.addEventListener('error', () => {
      clearTimeout(limite);
      resolve('recusado');
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

  expect(await conectar(ticket), 'a primeira conexão devia abrir').toBe('aberto');
  expect(await conectar(ticket), 'o ticket foi reaproveitado (RN-108)').toBe('recusado');
});
