import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar, semearSessao, type SessaoSemeada } from '../suporte/api.ts';
import { esperarEvento } from '../suporte/eventos.ts';
import { ofertarHandoff } from '../suporte/interno.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * O handoff aceito DENTRO do chat (TP-01: "tudo pelo chat"). A oferta é
 * semeada pela rota interna, como o engine a faria (`create_handoff` do
 * Criativo ao PO); a tela mostra o card com o botão de aceitar, o clique chama
 * `POST .../handoffs/:id/accept` e o log ganha `handoff.accepted`. Sem LLM: o
 * aceite só dispara o início do turno do destino, que não é asserido aqui.
 */

test.describe.configure({ mode: 'serial' });

let token: string;
let semeada: SessaoSemeada;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  token = await autenticar();
  semeada = await semearSessao(token, 'criativa');
  await ofertarHandoff(semeada, 'criativo', 'po');
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('o handoff oferecido é aceito no chat e o aceite entra no log', { tag: '@f-time-e-handoffs' }, async () => {
  await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);

  // O card da oferta é o único alerta com ação da sessão semeada.
  const aceitar = page.locator('[data-slot="alert"] button').first();
  await expect(aceitar).toBeVisible({ timeout: 30_000 });

  const aceite = page.waitForResponse(
    (r) => /\/handoffs\/[^/]+\/accept$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await aceitar.click();
  expect((await aceite).status(), 'a api recusou o aceite').toBeLessThan(300);

  await esperarEvento(token, semeada, 'handoff.accepted', 30_000);
});
