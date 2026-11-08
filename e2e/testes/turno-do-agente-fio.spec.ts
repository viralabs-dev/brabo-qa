import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar, semearSessao, type SessaoSemeada } from '../suporte/api.ts';
import { anexarEvento, ouvirCanal } from '../suporte/eventos.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * O fio da sessão não repete turno (AT-803, RN-974) no navegador real.
 *
 * Um `agent.response` com raciocínio gera VÁRIAS entradas do fio com o mesmo
 * `seq`; com a `key` por `seq` o React deixava nós órfãos a cada poll, até a
 * aba travar. O defeito só aparece com o poll de 3 s e o canal juntos, então o
 * spec semeia turnos pela rota pública, anexa mais com a página aberta (o
 * canal manda reler), espera mais de um poll e confere que nenhum texto de
 * resposta se repete e que o número de blocos de raciocínio não cresce.
 * Contagem estrutural: cada resposta tem texto único gerado aqui.
 */

test.describe.configure({ mode: 'serial' });

const AGENTE = { kind: 'agent', id: 'po' } as const;
const resposta = (n: number) => `resposta-e2e-${n}`;

let token: string;
let semeada: SessaoSemeada;
let userId: string;
let context: BrowserContext;
let page: Page;

async function turno(n: number): Promise<void> {
  await anexarEvento(token, semeada, 'chat.message', { kind: 'user', id: userId }, { text: `pergunta-e2e-${n}` });
  await anexarEvento(token, semeada, 'agent.response', AGENTE, {
    content: resposta(n),
    raciocinio: `pensei no turno ${n}`,
    raciocinioTotal: 20,
  });
}

const repeticoes = (n: number) => page.getByText(resposta(n), { exact: true }).count();
const blocosDeRaciocinio = () => page.locator('[data-testid="raciocinio-do-turno"]').count();

test.beforeAll(async ({ browser }) => {
  token = await autenticar();
  userId = (JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { sub: string }).sub;
  semeada = await semearSessao(token, 'criativa');
  for (const n of [1, 2, 3]) await turno(n);
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('nenhum turno se repete depois de vários polls e eventos novos pelo canal', { tag: '@f-chat-e-pendencias' }, async () => {
  const frames = ouvirCanal(page, semeada.sessionId);
  await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);
  await expect(page.getByText(resposta(3), { exact: true })).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => frames.some((f) => f.evento === 'phx_reply'), { message: 'o canal não confirmou o join', timeout: 30_000 })
    .toBe(true);

  // Eventos novos na cauda, com a página aberta: o canal avisa e a lista é relida.
  for (const n of [4, 5, 6]) {
    await turno(n);
    await expect(page.getByText(resposta(n), { exact: true })).toHaveCount(1, { timeout: 20_000 });
  }

  const antes = await blocosDeRaciocinio();
  // Mais de dois polls de 3 s sem nada de novo: é aqui que o nó órfão nascia.
  await page.waitForTimeout(8_000);
  for (const n of [1, 2, 3, 4, 5, 6]) {
    expect(await repeticoes(n), `${resposta(n)} aparece mais de uma vez no fio`).toBeLessThanOrEqual(1);
  }
  expect(await repeticoes(6), 'a última resposta sumiu do fio').toBe(1);
  expect(await blocosDeRaciocinio(), 'os blocos de raciocínio cresceram sem evento novo').toBe(antes);
});
