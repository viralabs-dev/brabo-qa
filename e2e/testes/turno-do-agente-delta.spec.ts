import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar, API_URL, type SessaoSemeada } from '../suporte/api.ts';
import { semearSessaoComDuble, TEXTO_DO_PASSO_0 } from '../suporte/duble.ts';
import { esperarEvento, ouvirCanal } from '../suporte/eventos.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * O streaming do turno (AT-815 R4): o `agent.delta` chega pelo canal
 * `session:<id>`, entre `working` e `idle`, com o texto do passo 0 do roteiro
 * do provider dublê da api (RN-1065). Sem LLM real e sem custo (`costMicros` 0).
 * A mensagem sai pela api; a página só abre o canal, e é ela que recebe os frames.
 * Um login de navegador (`contextoLogado`).
 */

test.describe.configure({ mode: 'serial' });

let token: string;
let semeada: SessaoSemeada;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  token = await autenticar();
  semeada = await semearSessaoComDuble(token);
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('o texto do turno chega como agent.delta entre working e idle', { tag: '@f-turno-do-agente' }, async () => {
  const frames = ouvirCanal(page, semeada.sessionId);
  await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);
  await expect
    .poll(() => frames.some((f) => f.evento === 'phx_reply'), { message: 'o canal não confirmou o join', timeout: 30_000 })
    .toBe(true);

  const resposta = await fetch(`${API_URL}/projects/${semeada.projectId}/sessions/${semeada.sessionId}/agents/criativo/message`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Quero um app de receitas.' }),
  });
  expect(resposta.status, 'a api recusou a mensagem').toBeLessThan(300);

  const idx = (pred: (f: (typeof frames)[number]) => boolean, depois = -1) => frames.findIndex((f, i) => i > depois && pred(f));
  const status = (s: string) => (f: (typeof frames)[number]) => f.evento === 'agent.status' && f.carga.status === s;

  await expect
    .poll(
      () => {
        const w = idx(status('working'));
        const d = idx((f) => f.evento === 'agent.delta', w);
        return w >= 0 && d >= 0 && idx(status('idle'), d) >= 0;
      },
      { message: `working → agent.delta → idle não chegaram; recebido: ${JSON.stringify(frames.map((f) => f.evento))}`, timeout: 45_000 },
    )
    .toBe(true);

  const delta = frames[idx((f) => f.evento === 'agent.delta', idx(status('working')))];
  expect(delta?.carga.text, 'o texto do delta é o do roteiro').toBe(TEXTO_DO_PASSO_0);
  expect(delta?.carga.agent).toBe('criativo');
  // O fechamento do turno: a resposta persistida tem o mesmo texto, e nenhuma falha de turno.
  const final = await esperarEvento(token, semeada, 'agent.response', 30_000);
  expect(final.payload.content).toBe(TEXTO_DO_PASSO_0);
  expect(frames.some((f) => f.evento === 'agent.error')).toBe(false);
});
