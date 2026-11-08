import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar, idsPendentes, proporAcaoPendente, semearSessao, type SessaoSemeada } from '../suporte/api.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * Caminho feliz do card (P2): aprovar `write_file` inline. O primeiro botão de
 * `[data-acoes-do-card]` é aprovar (o segundo é recusar, ver
 * `aprovacao-inline.spec.ts`). `write_file` de ator `user` não tem executor:
 * volta `approved` e a fila esvazia.
 */
test.describe.configure({ mode: 'serial' });

let semeada: SessaoSemeada;
let token: string;
let acaoId: string;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  token = await autenticar();
  semeada = await semearSessao(token);
  acaoId = await proporAcaoPendente(token, semeada);
  ({ context, page } = await contextoLogado(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('aprovar pelo card devolve approved e esvazia a fila', { tag: '@f-aprovacoes' }, async () => {
  await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);
  const card = page.locator('[data-testid="motivo-da-politica"]');
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  const aprovar = card.locator('xpath=ancestor::*[@data-confirmacao][1]').locator('[data-acoes-do-card] button').first();

  const decisao = page.waitForResponse(
    (r) => r.url().endsWith(`/actions/${acaoId}/approve`) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await aprovar.click();
  const resposta = await decisao;
  expect(resposta.status(), 'a api recusou a aprovação').toBe(201);
  expect(((await resposta.json()) as { status?: string }).status).toBe('approved');
  await expect.poll(() => idsPendentes(token, semeada)).not.toContain(acaoId);
});
