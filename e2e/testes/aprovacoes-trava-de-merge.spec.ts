import { expect, test } from '@playwright/test';
import { API_URL, autenticar, semearSessao } from '../suporte/api.ts';

/**
 * A trava de merge em branch protegida (RN-418): nem a autonomia
 * `auto_approve` do agente nem o `permissions.json` liberando `GitMerge()`
 * auto-aprovam um merge em `dev`. É o teto de segurança do produto (merge na
 * protegida é do usuário), provado pelas rotas públicas, como o passo 4 de
 * `scripts/demo-noop-execution.ts` da api, mas contra a instalação de pé.
 *
 * Sem navegador e sem LLM. O projeto tem repo local (a política lê o
 * `permissions.json` da pasta do projeto) e o papel do usuário semeado é o de
 * quem a política herda. A contraprova: o MESMO arranjo num destino NÃO
 * protegido não fica `pending`, senão a trava bloquearia merge em geral.
 */
test('merge em branch protegida fica pending mesmo com auto_approve e permissions liberando', { tag: '@f-aprovacoes' }, async () => {
  const token = await autenticar();
  const cabecalhos = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const chamar = async (metodo: string, rota: string, corpo: unknown) => {
    const r = await fetch(`${API_URL}${rota}`, { method: metodo, headers: cabecalhos, body: JSON.stringify(corpo) });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${rota} respondeu ${r.status}: ${texto.slice(0, 400)}`);
    return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
  };

  const { projectId, sessionId } = await semearSessao(token, 'criativa');
  await chamar('POST', `/projects/${projectId}/git/local/repository`, { name: `e2e-${Date.now()}`, visibility: 'private' });
  await chamar('PUT', `/projects/${projectId}/agent-autonomy`, {
    agentId: 'dev-api',
    actionType: 'git_merge',
    mode: 'auto_approve',
  });
  await chamar('PUT', `/projects/${projectId}/permissions`, { allow: ['GitMerge()'], deny: [], ask: [] });

  const propor = (targetBranch: string, pullRequestId: string) =>
    chamar('POST', `/projects/${projectId}/sessions/${sessionId}/actions`, {
      actionType: 'git_merge',
      actor: { kind: 'agent', id: 'dev-api' },
      payload: { pullRequestId, targetBranch },
    });

  const protegida = await propor('dev', '1');
  expect(protegida.status, 'a trava deixou o merge em branch protegida passar').toBe('pending');

  const livre = await propor('feature/x', '2');
  expect(livre.status, 'a trava bloqueou também o destino não protegido').not.toBe('pending');
});
