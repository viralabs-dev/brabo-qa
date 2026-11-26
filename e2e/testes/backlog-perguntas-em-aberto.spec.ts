import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar, semearSessao, type SessaoSemeada } from '../suporte/api.ts';
import { anexarEvento } from '../suporte/eventos.ts';
import { abrirPendencias } from '../suporte/chat.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * As perguntas em aberto na tela (AT-804, RN-861): a fila lista as perguntas
 * de QUALQUER autor (PO e Arquiteto aqui), o contador é o total da api, e
 * responder pela tela fecha uma e o contador cai SEM recarregar (achado 1 da
 * 26ª). O log é semeado pela rota pública com `artifact.open_question`, o
 * mesmo evento que as ferramentas dos agentes gravam. Sem LLM.
 *
 * A fila pagina de 3 em 3 (RN-975): com 4 perguntas a primeira página mostra 3
 * e o contador, 4. Só o AUTOR da sessão responde (RN-858): a sessão é do
 * usuário semeado.
 */

test.describe.configure({ mode: 'serial' });

let semeada: SessaoSemeada;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  const token = await autenticar();
  semeada = await semearSessao(token, 'criativa');
  const autores = ['po', 'arquiteto', 'po', 'arquiteto'];
  for (const [i, autor] of autores.entries()) {
    await anexarEvento(token, semeada, 'artifact.open_question', { kind: 'agent', id: autor }, {
      questionId: randomUUID(),
      pergunta: `Pergunta ${i + 1} semeada pelo E2E?`,
      afeta: { regras: [], historias: [], tarefas: [] },
      autor,
      sessionId: semeada.sessionId,
    });
  }
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('a fila lista as perguntas de dois autores e responder baixa o contador sem recarregar', { tag: '@f-chat-e-pendencias' }, async () => {
  await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);
  // Sheet (web compacto) ou bloco inline (web anterior); abre a aba Perguntas nos dois.
  const noSheet = await abrirPendencias(page);

  const fila = page.locator('[data-testid="fila-perguntas-em-aberto"]');
  const contador = fila.locator('h4 > span');
  await expect(contador).toHaveText('4', { timeout: 30_000 });
  await expect(fila.locator('[data-testid="pergunta-em-aberto"]')).toHaveCount(noSheet ? 1 : 3); // no Sheet, uma pergunta por vez

  const resposta = page.waitForResponse(
    (r) => /\/open-questions\/[^/]+\/answer$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  const primeira = fila.locator('[data-testid="pergunta-em-aberto"]').first();
  await primeira.locator('input[type="text"]').fill('Sim, pode seguir.');
  await primeira.locator('button').last().click();
  expect((await resposta).status(), 'a api recusou a resposta').toBeLessThan(300);

  // Sem reload: a invalidação relê a fila e o contador cai.
  await expect(contador).toHaveText('3', { timeout: 30_000 });
});
