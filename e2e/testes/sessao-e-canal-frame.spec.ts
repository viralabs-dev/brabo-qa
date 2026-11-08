import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar, semearSessao, type SessaoSemeada } from '../suporte/api.ts';
import { anexarEvento, ouvirCanal, type FrameDoCanal } from '../suporte/eventos.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * O evento que a api grava chega como frame no canal `session:<id>` aberto
 * (AT-815 R2, RN-579): api → engine (`event_appended`) → Phoenix → navegador.
 *
 * Um `agent.response` semeado pela rota pública não passa pelo engine: é a
 * api quem avisa o canal depois do commit, e o engine rebroadcasta como
 * `event.appended` (só `type` e `actorId`, nunca o payload). É a base dos
 * cenários seguintes: sem o frame, a tela só descobriria pelo poll de 3 s.
 * A asserção é sobre o FRAME observado, não sobre o texto da tela.
 */

test.describe.configure({ mode: 'serial' });

let token: string;
let semeada: SessaoSemeada;
let context: BrowserContext;
let page: Page;
let frames: FrameDoCanal[];

test.beforeAll(async ({ browser }) => {
  token = await autenticar();
  semeada = await semearSessao(token, 'criativa');
  ({ context, page } = await contextoLogado(browser));
  frames = ouvirCanal(page, semeada.sessionId);
  await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);
  // O join confirmado: sem ele um broadcast anterior se perde e o spec mediria a corrida.
  await expect
    .poll(() => frames.some((f) => f.evento === 'phx_reply' && (f.carga as { status?: unknown }).status === 'ok'), {
      message: 'o engine não confirmou o join do canal da sessão',
      timeout: 30_000,
    })
    .toBe(true);
});

test.afterAll(async () => {
  await context?.close();
});

test('o evento anexado pela api chega como frame event.appended no canal aberto', { tag: '@f-sessao-e-canal' }, async () => {
  await anexarEvento(token, semeada, 'agent.response', { kind: 'agent', id: 'po' }, { content: 'resposta semeada pelo E2E' });

  await expect
    .poll(
      () =>
        frames.some(
          (f) => f.evento === 'event.appended' && f.carga.type === 'agent.response' && f.carga.actorId === 'po',
        ),
      {
        message: `o frame event.appended não chegou; recebido: ${JSON.stringify(frames.map((f) => f.evento))}`,
        timeout: 15_000,
      },
    )
    .toBe(true);
  // O aviso é só gatilho: o conteúdo não atravessa o socket.
  const aviso = frames.find((f) => f.evento === 'event.appended' && f.carga.type === 'agent.response');
  expect(aviso?.carga).not.toHaveProperty('payload');
});
