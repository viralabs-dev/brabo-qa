import type { Page } from '@playwright/test';

const PAINEL = '[data-testid="pendencias-de-outras-sessoes"]';

/**
 * Abre o painel de pendências do chat pelo contador "Pendências" do cabeçalho (o painel da sessão,
 * `data-modo` = `aba` no desktop e `sheet` abaixo de 1024 px). O evento `brabo:abrir-fila` abre
 * a aba pedida e é reenviado até o painel aparecer, porque o listener só existe depois de a página
 * montar. Devolve `true`: a aba Pendências mostra uma pergunta por vez em qualquer `data-modo` (AT-957).
 */
export async function abrirPendencias(page: Page, fila = 'perguntas'): Promise<boolean> {
  const painel = page.locator(PAINEL);
  const abrir = () => page.evaluate((f) => window.dispatchEvent(new CustomEvent('brabo:abrir-fila', { detail: f })), fila);
  const limite = Date.now() + 30_000;
  while (Date.now() < limite && !(await painel.isVisible())) {
    await page.locator('[data-testid="contador-de-pendencias"]').first().click({ timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await painel.waitFor({ timeout: 1_000 });
  await abrir();
  return true;
}

/**
 * Abre uma aba do bloco de pendências do chat (`perguntas`, `aprovacoes`,
 * `merges`, `prontas`, `bloqueadas`, `travados`), em qualquer dos dois webs.
 */
export async function abrirFila(page: Page, fila: string): Promise<void> {
  await abrirPendencias(page, fila);
}

/**
 * Ações secundárias que o web compacto moveu para o menu "⋯" (`mais-acoes-do-cartao`):
 * abre-o se existir, senão não faz nada (web anterior, com o botão solto na tela).
 */
export async function abrirMaisAcoesSeExistir(page: Page): Promise<void> {
  const menu = page.locator('[data-testid="mais-acoes-do-cartao"]').first();
  if (await menu.isVisible()) await menu.click();
}
