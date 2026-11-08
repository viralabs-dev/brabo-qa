import type { Page } from '@playwright/test';

/**
 * Abre uma aba do bloco de pendências do chat (`perguntas`, `aprovacoes`,
 * `merges`, `prontas`, `bloqueadas`, `travados`). As abas nascem fechadas e o
 * conteúdo fica montado com `hidden`; o evento é o que o próprio painel ouve
 * (`EVENTO_ABRIR_FILA` do web) para o atalho "Responder perguntas".
 */
export async function abrirFila(page: Page, fila: string): Promise<void> {
  await page.locator('[data-testid="pendencias-de-outras-sessoes"]').waitFor({ timeout: 30_000 });
  await page.evaluate((f) => window.dispatchEvent(new CustomEvent('brabo:abrir-fila', { detail: f })), fila);
}
