import { expect, test } from '@playwright/test';
import { autenticar, semearSessao } from '../suporte/api.ts';
import { anexarEvento } from '../suporte/eventos.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * A rolagem do fio (AT-959, RN-977): com o fio rolado para cima e mensagem nova chegando, o botão
 * "Ir ao fim · N novas" aparece; clicar leva ao fim e o contador zera (o botão some). O fio é o
 * `role=log`; o botão mora no `message-scroller-button`. O rótulo É o objeto da asserção (contador
 * derivado no web), por isso é pt-BR. Sem LLM.
 */
test('rolado para cima, a mensagem nova acende "Ir ao fim · N novas" e o clique zera', { tag: '@f-sessao-e-canal' }, async ({ browser }) => {
  test.setTimeout(180_000);
  const token = await autenticar();
  const semeada = await semearSessao(token, 'criativa');
  const agente = { kind: 'agent', id: 'po' } as const;
  const linhas = Array.from({ length: 12 }, (_, i) => `linha ${i + 1} da resposta`).join('\n\n');
  for (let n = 1; n <= 20; n++) await anexarEvento(token, semeada, 'agent.response', agente, { content: `resposta-rolagem-${n}\n\n${linhas}` });

  const { context, page } = await contextoLogado(browser);
  try {
    await page.goto(`/projects/${semeada.projectId}/sessions/${semeada.sessionId}`);
    const fio = page.getByRole('log', { name: 'Conversa da sessão' });
    await expect(fio).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('resposta-rolagem-20', { exact: false })).toBeVisible({ timeout: 30_000 });
    const botao = page.locator('[data-slot="message-scroller-button"] button');
    await expect(botao).toHaveCount(0);

    // Gesto real (roda): o web só pausa o acompanhamento com gesto do usuário (RN-1510), não com scrollTo de script.
    await fio.hover();
    await page.mouse.wheel(0, -9999);
    await expect.poll(() => fio.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop), { timeout: 15_000 }).toBeGreaterThan(100);
    await expect(botao).toHaveText('Ir ao fim', { timeout: 15_000 });

    await anexarEvento(token, semeada, 'agent.response', agente, { content: 'resposta-rolagem-nova-1' });
    await anexarEvento(token, semeada, 'agent.response', agente, { content: 'resposta-rolagem-nova-2' });
    await expect(botao).toHaveText('Ir ao fim · 2 novas', { timeout: 30_000 });

    await botao.click();
    await expect(botao).toHaveCount(0);
    await expect(page.getByText('resposta-rolagem-nova-2', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
