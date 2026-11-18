import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { autenticar } from '../suporte/api.ts';
import { esperarGateAberto, semearExecucao, sessaoDaExecucao, type ExecucaoSemeada } from '../suporte/execucao.ts';
import { chamarInterno } from '../suporte/interno.ts';
import { contextoLogado } from '../suporte/navegador.ts';

/**
 * O carrossel de executores no chat do Criativo (AT-880, RN-1072 e RN-1073).
 *
 * Duas tarefas em dois módulos, `web` com `dependsOn: ['api']`. O spec abre a
 * sessão CRIATIVA (não a de execução) e prova: a faixa aparece com "x de N",
 * o dev dependente cita a fundação de que espera, minimizar tira os cartões e
 * deixa só estado, tempo e gasto, e a escolha sobrevive ao reload. Os seletores
 * são `data-testid` (faixa, minimizar e cartão/chip por agente); nada de texto de tela.
 * Sem LLM.
 */

test.describe.configure({ mode: 'serial' });

let exec: ExecucaoSemeada;
let context: BrowserContext;
let page: Page;

// shortcut: compatível com a web antes e depois da web#120 (AT-957); tirar o fallback quando a #120 estiver na dev
// Tela nova: faixa de uma linha + aba Executores. Tela antiga: carrossel com cartões. A nova vem primeiro.
const faixaNova = (p: Page) => p.locator('[data-testid="faixa-de-estado"]');
const carrossel = (p: Page) => p.locator('[data-testid="carrossel-executores"]');
const faixa = () => faixaNova(page).or(carrossel(page));
const alternar = () => carrossel(page).locator('[data-testid="carrossel-minimizar"]');

/** Qual tela está de pé; espera a faixa (nova) ou o carrossel (antiga) aparecer. */
async function tela(p: Page): Promise<'nova' | 'antiga'> {
  await faixaNova(p).or(carrossel(p)).first().waitFor({ timeout: 45_000 });
  return (await faixaNova(p).count()) ? 'nova' : 'antiga';
}

/** O cartão do executor (`agentId`): na tela nova abre a aba Executores; na antiga é o do carrossel. */
async function cartao(p: Page, agentId: string) {
  if ((await tela(p)) === 'nova') {
    const lista = p.locator('[data-testid="lista-de-executores"]');
    if (!(await lista.isVisible())) await p.locator('[data-testid="faixa-abrir-executores"]').click();
    return lista.locator(`[data-testid="executor-${agentId}"]`);
  }
  return carrossel(p).locator(`[data-testid="carrossel-cartao-${agentId}"]`);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const token = await autenticar();
  exec = await semearExecucao(token, {
    modulos: [{ name: 'api' }, { name: 'web', dependsOn: ['api'] }],
    tarefas: [
      { modulo: 'api', titulo: 'Endpoint de cadastro' },
      { modulo: 'web', titulo: 'Tela de cadastro' },
    ],
    decidirImagem: false,
  });
  ({ context, page } = await contextoLogado(browser));
  await page.goto(`/projects/${exec.projectId}/sessions/${exec.sessionId}`);
});

test.afterAll(async () => {
  await context?.close();
});

test('a faixa aparece no chat do Criativo com o "x de N" e um cartão por dev', { tag: '@f-execucao' }, async () => {
  const barra = faixa().locator('[role="progressbar"]');
  await expect(barra).toBeVisible({ timeout: 45_000 });
  await expect(barra).toHaveAttribute('aria-valuemax', '2');
  await expect(barra).toHaveAttribute('aria-valuenow', '0');
  await expect(await cartao(page, 'dev-api')).toBeVisible();
  await expect(await cartao(page, 'dev-web')).toBeVisible({ timeout: 45_000 });
});

test('o dev dependente mostra o motivo do ócio: cita o módulo de que espera', { tag: '@f-execucao' }, async () => {
  // O motivo é derivado do module_map + backlog (RN-1073); `dev-web` só fica ocioso depois do claim vazio.
  const dev = await cartao(page, 'dev-web');
  const motivo = (await tela(page)) === 'nova' ? dev.filter({ hasText: 'api' }) : dev.locator('p', { hasText: 'api' });
  await expect(motivo).toBeVisible({ timeout: 60_000 });
});

test('minimizar deixa só estado, tempo e gasto, e a escolha persiste ao recarregar', { tag: '@f-execucao' }, async () => {
  // shortcut: compatível com a web antes e depois da web#120 (AT-957); tirar o fallback quando a #120 estiver na dev
  test.skip((await tela(page)) === 'nova', 'minimizar só existe no carrossel da tela antiga; a faixa nova não minimiza');
  await expect(alternar()).toHaveAttribute('aria-expanded', 'true');
  await alternar().click();
  await expect(alternar()).toHaveAttribute('aria-expanded', 'false');
  await expect(carrossel(page).locator('article')).toHaveCount(0);
  await expect(carrossel(page).locator('ul li', { hasText: 'dev-api' })).toBeVisible();
  await expect(carrossel(page).locator('ul li', { hasText: 'dev-web' })).toBeVisible();
  await expect(carrossel(page).locator('[role="progressbar"]')).toBeVisible(); // o "x de N" continua

  await page.reload();
  await expect(alternar()).toHaveAttribute('aria-expanded', 'false', { timeout: 45_000 });
  await expect(carrossel(page).locator('article')).toHaveCount(0);
});

/**
 * Tarefa bloqueada com o gate aberto (AT-982 D e AT-985 L4): o Noop abre a PR e o gate
 * `awaiting_qa`; o bloqueio pela rota interna (`qa-lead`, origem `infra`) devolve a
 * tarefa a `todo` COM o gate aberto. O cartão do QA não pode seguir "Julgando" (o último
 * `pr.gate_changed` ainda é `awaiting_qa`) e diz que a PR espera voltar ao QA. Aqui o
 * texto É o objeto da asserção (o estado derivado no web), por isso é pt-BR.
 */
test.describe('com a tarefa bloqueada e o gate aberto', () => {
  test.describe.configure({ mode: 'serial' });
  let bloqueada: ExecucaoSemeada;
  let contexto: BrowserContext;
  let pagina: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const token = await autenticar();
    bloqueada = await semearExecucao(token, {
      modulos: [{ name: 'api' }],
      tarefas: [{ modulo: 'api', titulo: 'Tarefa bloqueada' }],
    });
    const { taskId } = await esperarGateAberto(token, bloqueada);
    await chamarInterno(sessaoDaExecucao(bloqueada), `tasks/${taskId}/block`, {
      agentId: 'qa-lead',
      reason: 'bloqueio semeado pelo E2E',
      diagnosis: 'o QA falhou por dentro',
      origin: 'infra',
    });
    ({ context: contexto, page: pagina } = await contextoLogado(browser));
    await pagina.goto(`/projects/${bloqueada.projectId}/sessions/${bloqueada.sessionId}`);
  });

  test.afterAll(async () => {
    await contexto?.close();
  });

  test('o cartão do QA não diz "Julgando" com a tarefa bloqueada', { tag: '@f-execucao' }, async () => {
    const qa = await cartao(pagina, 'qa');
    await expect(qa).toBeVisible({ timeout: 60_000 });
    await expect(qa).not.toContainText('Julgando');
  });

  test('a tarefa em todo com awaiting_qa mostra "espera voltar ao QA"', { tag: '@f-execucao' }, async () => {
    const qa = await cartao(pagina, 'qa');
    await expect(qa).toContainText('espera voltar ao QA', { timeout: 60_000 });
  });
});
