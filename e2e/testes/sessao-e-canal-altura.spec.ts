import { expect, test } from '@playwright/test';
import { autenticar, semearSessao } from '../suporte/api.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * A sessão tem altura fixa e só o fio rola (AT-956, RN-1389 a RN-1391): a página não rola, o
 * composer cabe inteiro na janela e, em 1366×768, o fio fica com pelo menos 70% da coluna do chat.
 * jsdom não mede altura; aqui é a medida real. Seletores: o fio é o `role=log` (rótulo "Conversa da
 * sessão"), a coluna é o pai dele e o composer é a caixa de texto. A web não tem `data-testid`
 * nesses três pontos; estes são os mais estáveis (papel e rótulo acessível). Sem LLM.
 */

for (const [largura, altura] of [
  [1366, 768],
  [1848, 925],
] as const) {
  test(`a sessão não rola e o composer cabe em ${largura}x${altura}`, { tag: '@f-sessao-e-canal' }, async ({ browser }) => {
    const semeada = await semearSessao(await autenticar(), 'criativa');
    const { context, page } = await contextoLogado(browser);
    try {
      await page.setViewportSize({ width: largura, height: altura });
      await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);
      const fio = page.getByRole('log', { name: 'Conversa da sessão' });
      const composer = page.getByRole('textbox').last();
      await expect(fio).toBeVisible({ timeout: 45_000 });
      await expect(composer).toBeVisible();

      const m = await page.evaluate(() => ({
        rolagem: document.scrollingElement?.scrollHeight ?? 0,
        janela: window.innerHeight,
      }));
      expect(m.rolagem, `a página rola: scrollHeight ${m.rolagem} > innerHeight ${m.janela}`).toBeLessThanOrEqual(m.janela);

      const caixa = await composer.boundingBox();
      expect(caixa, 'o composer não tem caixa').not.toBeNull();
      expect(caixa!.y, 'o composer começa acima da janela').toBeGreaterThanOrEqual(0);
      expect(caixa!.y + caixa!.height, 'o composer passa do fim da janela').toBeLessThanOrEqual(altura);

      if (largura === 1366) {
        const f = await fio.boundingBox();
        const c = await fio.locator('..').boundingBox();
        expect(f && c, 'sem caixa do fio ou da coluna').toBeTruthy();
        const razao = f!.height / c!.height;
        console.log(`altura 1366x768: fio ${f!.height}px, coluna ${c!.height}px, razão ${razao.toFixed(3)}`);
        expect(razao, `o fio ocupa ${(razao * 100).toFixed(1)}% da coluna (mínimo 70%)`).toBeGreaterThanOrEqual(0.7);
      }
    } finally {
      await context.close();
    }
  });
}
