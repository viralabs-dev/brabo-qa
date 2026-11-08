import { expect, test } from '@playwright/test';
import { autenticar, API_URL } from '../suporte/api.ts';
import { PERGUNTAS_DO_ROTEIRO, semearSessaoComDuble } from '../suporte/duble.ts';
import { anexarEvento, eventosDaSessao, esperarEvento } from '../suporte/eventos.ts';

/**
 * "Aceito todas" do lado do AGENTE (AT-804, RN-1058; AT-815 R4): 7 perguntas
 * abertas de dois autores, e o Criativo (roteiro do provider dublê, RN-1065)
 * chama `list_open_questions` e fecha as 7 com `answer_open_question`, sem
 * `resposta` (vale a sugestão). Os `questionId` são os do roteiro. O conteúdo do
 * prompt fica no ExUnit do engine. Só api: não abre navegador, não gasta login.
 *
 * A 1ª mensagem consome o passo 0 do roteiro (texto); a 2ª, o passo 1 (ferramentas).
 */

// FIXME(AT-815 R4): a imagem publicada traz a marca `prd` (release.yml e ci.yml da api passam BRABO_AMBIENTE=prd em todo build) e o dublê nunca carrega em `prd` (RN-1065); o run 42515015341 logou LLM_DUBLE=1 ignorado. Sai do fixme quando houver imagem sem a marca prd.
test.fixme('o agente lista e fecha as 7 perguntas de dois autores', { tag: '@f-backlog' }, async () => {
  const token = await autenticar();
  const sessao = await semearSessaoComDuble(token);
  for (const [i, questionId] of PERGUNTAS_DO_ROTEIRO.entries()) {
    const autor = i % 2 === 0 ? 'po' : 'arquiteto';
    await anexarEvento(token, sessao, 'artifact.open_question', { kind: 'agent', id: autor }, {
      questionId,
      pergunta: `Pergunta ${i + 1} semeada pelo E2E?`,
      sugestao: `Sugestão ${i + 1}`,
      afeta: { regras: [], historias: [], tarefas: [] },
      autor,
      sessionId: sessao.sessionId,
    });
  }

  const enviar = async (text: string) => {
    const r = await fetch(`${API_URL}/projects/${sessao.projectId}/sessions/${sessao.sessionId}/agents/criativo/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    expect(r.status, 'a api recusou a mensagem').toBeLessThan(300);
  };
  await enviar('Quais perguntas estão abertas?');
  await esperarEvento(token, sessao, 'agent.response', 30_000);
  await enviar('Aceito todas.');

  await expect
    .poll(async () => (await eventosDaSessao(token, sessao)).filter((e) => e.type === 'open_question.answered').length, {
      message: 'o agente não fechou as 7 perguntas',
      timeout: 60_000,
    })
    .toBe(7);
  const fechadas = (await eventosDaSessao(token, sessao))
    .filter((e) => e.type === 'open_question.answered')
    .map((e) => String(e.payload.questionId))
    .sort();
  expect(fechadas).toEqual([...PERGUNTAS_DO_ROTEIRO].sort());
});
