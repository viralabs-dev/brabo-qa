import type { Page } from '@playwright/test';

const PAINEL = '[data-testid="pendencias-de-outras-sessoes"]';

/**
 * Abre o painel de pendências do chat e devolve se ele é um Sheet (web com o chat compacto,
 * AT-950/web#109) ou o bloco inline (web anterior). Serve aos DOIS webs: o painel inline já
 * existe na tela; o Sheet só existe depois de aberto, e o mesmo evento que o contador "Pendências"
 * do cabeçalho e o atalho "Responder perguntas" usam (`brabo:abrir-fila`, `EVENTO_ABRIR_FILA`
 * do web) o abre. O evento é reenviado até o painel aparecer porque o listener só existe depois
 * de a página montar. `fila` abre também a aba pedida (as abas do web nascem fechadas).
 */
export async function abrirPendencias(page: Page, fila = 'perguntas'): Promise<boolean> {
  const painel = page.locator(PAINEL);
  const abrir = () => page.evaluate((f) => window.dispatchEvent(new CustomEvent('brabo:abrir-fila', { detail: f })), fila);
  const limite = Date.now() + 30_000;
  while (Date.now() < limite && !(await painel.isVisible())) {
    await abrir();
    await page.waitForTimeout(500);
  }
  await painel.waitFor({ timeout: 1_000 });
  // No bloco inline o painel já está visível e a aba pedida nasce fechada (`hidden`): o evento a abre.
  await abrir();
  return (await painel.getAttribute('role')) === 'dialog';
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
