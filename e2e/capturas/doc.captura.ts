import { randomUUID } from 'node:crypto';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { autenticar, API_URL, proporAdr, proporPlanoDoDevLead, type SessaoSemeada } from '../suporte/api.ts';
import { semearSessaoComDuble } from '../suporte/duble.ts';
import { anexarEvento, eventosDaSessao } from '../suporte/eventos.ts';
import { contextoLogado } from '../suporte/navegador.ts';
import { abrirFila } from '../suporte/chat.ts';
import { aprovarOsGates, esperarGateAberto, semearExecucao } from '../suporte/execucao.ts';
import { chamarInterno, criarEpico, criarHistoria, criarMapaDeModulos, criarTarefa, ligarModulos } from '../suporte/interno.ts';
import { COR_DA_MASCARA, conferirSemDadoSensivel, mascaras } from '../suporte/ocultar.ts';

/**
 * As capturas das telas que a doc do `brabo` mostra (AT-859, ADR 0286). Não é spec: não leva `@f-`, vive fora de
 * `testes/` e só roda pela `playwright.capturas.config.ts`.
 *
 * Conta: o `owner@brabo.dev` do seed de produção (fictícia). O acesso rápido `<papel>@brabo.dev` NÃO serve: só existe
 * em imagem sem a marca (RN-984, ADR 0245), e a doc descreve a imagem da release.
 *
 * Cada tela sai nos dois temas, em 1366×768, DEPOIS de `conferirSemDadoSensivel` e com `mask` cobrindo o que for
 * pessoal. O tema vem de `localStorage['brabo.theme']` (RN-182) e o MESMO contexto logado serve aos dois: o refresh
 * do login vale uma vez só (ver o README), então um contexto por tema gastaria dois logins à toa.
 *
 * Saída: `<CAPTURAS_SAIDA>/<nome>-<tema>.png` + `capturas.json` (arquivo, tela, tema, web, api, engine, data).
 */

const SAIDA = process.env.CAPTURAS_SAIDA ?? join(import.meta.dirname, 'saida');
const TEMAS = ['claro', 'escuro'] as const;
const TETO_DO_PNG = 400 * 1024; // o orçamento da AT-859 por imagem estática

interface Entrada {
  arquivo: string;
  tela: string;
  tema: (typeof TEMAS)[number];
  web: string;
  api: string;
  engine: string;
  data: string;
}
const manifesto: Entrada[] = [];

/** As versões vêm do workflow (tags da pin do `componentes.json`); fora dele não há como saber. */
const versoes = {
  web: process.env.CAPTURAS_WEB ?? 'desconhecida',
  api: process.env.CAPTURAS_API ?? 'desconhecida',
  engine: process.env.CAPTURAS_ENGINE ?? 'desconhecida',
};

async function definirTema(page: Page, tema: (typeof TEMAS)[number]): Promise<void> {
  await page.evaluate((t) => localStorage.setItem('brabo.theme', t === 'claro' ? 'light' : 'dark'), tema);
}

/** Fotografa a tela atual nos dois temas. `preparar` roda depois de recarregar, antes da guarda e do screenshot. */
async function fotografar(page: Page, nome: string, tela: string, preparar?: () => Promise<void>): Promise<void> {
  mkdirSync(SAIDA, { recursive: true });
  // Navegar com a renovação do token ainda em voo ABORTA a resposta do refresh: a api já rotacionou o cookie, o
  // navegador não o guardou, e o reuso revoga a família (a sessão cai no /login). Por isso: assentar ANTES de recarregar.
  await page.waitForLoadState('networkidle');
  const url = page.url();
  for (const tema of TEMAS) {
    await definirTema(page, tema);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await preparar?.();
    // Tela de erro não ensina nada: falha a captura em vez de publicá-la.
    const corpo = await page.locator('body').innerText();
    if (/Não foi possível|Não consegui descobrir|Limite de requisi/i.test(corpo)) throw new Error(`${nome}-${tema}: a tela mostra um erro, não a tela da doc: ${corpo.slice(0, 300)}`);
    await conferirSemDadoSensivel(page, `${nome}-${tema}`);
    const arquivo = `${nome}-${tema}.png`;
    await page.screenshot({
      path: join(SAIDA, arquivo),
      mask: mascaras(page),
      maskColor: COR_DA_MASCARA,
      animations: 'disabled',
      caret: 'hide',
    });
    const peso = statSync(join(SAIDA, arquivo)).size;
    if (peso > TETO_DO_PNG) throw new Error(`${arquivo} pesa ${peso} bytes; o teto é ${TETO_DO_PNG}`);
    manifesto.push({ arquivo, tela, tema, ...versoes, data: new Date().toISOString().slice(0, 10) });
  }
}

test.describe.configure({ mode: 'serial' });

let page: Page;
let token: string;
let sessao: SessaoSemeada;

test.beforeAll(async ({ browser }) => {
  token = await autenticar();
  sessao = await semearSessaoComDuble(token, 'Encurtador de links');
  ({ page } = await contextoLogado(browser));
  // O Criativo conversa pelo roteiro didático do dublê (`roteiro.json`): duas mensagens, duas respostas.
  let esperadas = 0;
  const falar = async (text: string, respostas: number): Promise<void> => {
    const r = await fetch(`${API_URL}/projects/${sessao.projectId}/sessions/${sessao.sessionId}/agents/criativo/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error(`a api recusou a mensagem: ${r.status}`);
    esperadas += respostas;
    const limite = Date.now() + 60_000;
    while ((await eventosDaSessao(token, sessao)).filter((e) => e.type === 'agent.response').length < esperadas) {
      if (Date.now() > limite) throw new Error(`faltam respostas do Criativo (esperava ${esperadas})`);
      await new Promise((ok) => setTimeout(ok, 500));
    }
  };
  await falar('Quero um encurtador de links: colo um endereço longo e recebo um código curto.', 1);
  await anexarPerguntas();
});

test.afterAll(async () => {
  await page?.context().close();
  writeFileSync(join(SAIDA, 'capturas.json'), `${JSON.stringify(manifesto, null, 2)}\n`);
});

/** O mesmo evento que as ferramentas dos agentes gravam: a fila "Perguntas abertas" do chat. */
async function anexarPerguntas(): Promise<void> {
  const perguntas = [
    ['po', 'Quando um link é apagado, o histórico de cliques dele também é?'],
    ['arquiteto', 'Qual o tamanho mínimo da senha de quem cria links?'],
    ['po', 'Um link pode ter data de expiração?'],
  ] as const;
  for (const [autor, pergunta] of perguntas) {
    await anexarEvento(token, sessao, 'artifact.open_question', { kind: 'agent', id: autor }, {
      questionId: randomUUID(),
      pergunta,
      afeta: { regras: [], historias: [], tarefas: [] },
      autor,
      sessionId: sessao.sessionId,
    });
  }
}

test('projetos: a lista de projetos', async () => {
  await page.goto('/');
  await page.locator('[data-testid="busca-de-projetos"]').waitFor();
  await fotografar(page, 'projetos', 'Lista de projetos');
});

test('novo projeto: o assistente de criação', async () => {
  await page.goto('/');
  await page.locator('[data-slot="sidebar-group-action"]').click();
  await page.locator('[role="dialog"]').waitFor();
  // O estado do diálogo não sobrevive ao `goto` do `fotografar`: reabre depois de cada recarga.
  await fotografar(page, 'novo-projeto', 'Assistente de novo projeto', async () => {
    await page.locator('[data-slot="sidebar-group-action"]').click();
    await page.locator('[role="dialog"]').waitFor();
  });
});

test('modelo do time: configurações do projeto', async () => {
  await page.goto(`/projects/${sessao.projectId}?tab=settings`);
  await page.waitForLoadState('networkidle');
  await fotografar(page, 'modelo-do-time', 'Modelos por agente');
});

test('ideia: o chat do Criativo', async () => {
  await page.goto(`/projects/${sessao.projectId}/sessions/${sessao.sessionId}`);
  await page.locator('[data-testid="pendencias-de-outras-sessoes"]').waitFor({ timeout: 30_000 });
  await fotografar(page, 'ideia-no-chat', 'Chat do Criativo');
});

test('perguntas abertas: a fila no chat', async () => {
  await page.goto(`/projects/${sessao.projectId}/sessions/${sessao.sessionId}`);
  await fotografar(page, 'perguntas-abertas', 'Fila de perguntas abertas', async () => {
    await abrirFila(page, 'perguntas');
    await page.locator('[data-testid="fila-perguntas-em-aberto"]').waitFor();
  });
});

test('providers: os provedores de modelo, sem chave', async () => {
  await page.goto('/providers');
  await page.waitForLoadState('networkidle');
  await fotografar(page, 'providers', 'Provedores de modelo');
});

test('gastos: o consumo do projeto', async () => {
  // `/spend` (workspace) exige o papel no workspace, que o seed de produção não dá ao owner: a aba do projeto serve.
  await page.goto(`/projects/${sessao.projectId}?tab=spend`);
  await page.waitForLoadState('networkidle');
  await fotografar(page, 'gastos', 'Gastos do projeto');
});

// AT-872: as telas dos passos 4 a 6 e dos READMEs. A ORDEM importa: os testes de execução criam outro projeto (que apareceria
// em `projetos` se viesse antes), e as três primeiras telas precisam ser fotografadas antes de o plano ser proposto.
// Tudo vem de estado semeado por HTTP, sem turno de LLM, e nada é aprovado: aprovar o ADR abriria PR e aprovar o plano ativaria dev real.

let tarefasDoPlano: string[] = [];

/** Mapa, regra, backlog e o ADR do Arquiteto pendente na sessão do Criativo. */
async function semearArquitetura(): Promise<void> {
  // `agent.activated` é o que liga o botão "Confirmar arquitetura pronta" (session-readiness do web).
  await anexarEvento(token, sessao, 'agent.activated', { kind: 'agent', id: 'arquiteto' }, { agent: 'arquiteto' });
  await criarMapaDeModulos(sessao, [
    { name: 'api', responsibility: 'Cria e resolve os links curtos' },
    { name: 'web', responsibility: 'Tela para colar o endereço', dependsOn: ['api'] },
  ]);
  await chamarInterno(sessao, 'c4-diagram', { systemName: 'Encurtador de links', actors: [{ name: 'Pessoa que cola o endereço' }] });
  const regra = await anexarEvento(token, sessao, 'artifact.business_rule', { kind: 'agent', id: 'po' }, {
    title: 'Só endereços http e https',
    text: 'O encurtador só aceita endereços http e https.',
  });
  const epico = await criarEpico(sessao, 'Encurtar e acompanhar links');
  for (const [titulo, modulo] of [['Encurtar um endereço', 'api'], ['Tela de colar o endereço', 'web']] as const) {
    const historia = await criarHistoria(sessao, epico.id, titulo, [regra.id]);
    await ligarModulos(sessao, historia.id, [modulo]);
    tarefasDoPlano.push((await criarTarefa(sessao, historia.id, titulo)).id);
  }
  await proporAdr(token, sessao, {
    title: 'Módulo único com SQLite em volume persistente',
    slug: 'modulo-unico-com-sqlite',
    content: '# Módulo único com SQLite em volume persistente\n\n## Contexto\nO encurtador guarda poucos milhares de links.\n\n## Decisão\nUm só serviço, com SQLite em volume persistente.\n\n## Consequências\nSem servidor de banco para operar; escalar exige migrar.\n',
  });
}

test('adr no chat: o Arquiteto propõe o ADR', async () => {
  await semearArquitetura();
  await page.goto(`/projects/${sessao.projectId}/sessions/${sessao.sessionId}`);
  await page.locator('[data-testid="pendencias-de-outras-sessoes"]').waitFor({ timeout: 30_000 });
  await fotografar(page, 'adr-no-chat', 'ADR proposto no chat');
});

test('arquitetura: a aba com o mapa, o C4 e o ADR', async () => {
  await page.goto(`/projects/${sessao.projectId}?tab=arquitetura`);
  await page.locator('svg[id^="mermaid"], svg[aria-roledescription]').first().waitFor({ timeout: 45_000 });
  await fotografar(page, 'arquitetura', 'Aba Arquitetura', async () => {
    await page.locator('svg[id^="mermaid"], svg[aria-roledescription]').first().waitFor({ timeout: 45_000 });
  });
});

test('plano e modo automático: o plano do Dev Lead pendente', async () => {
  await proporPlanoDoDevLead(token, sessao, {
    resumo: 'A api primeiro, depois a web que a consome.',
    modulos: ['api', 'web'],
    tarefas: [
      { taskId: tarefasDoPlano[0]!, modulo: 'api' },
      { taskId: tarefasDoPlano[1]!, modulo: 'web' },
    ],
  });
  await page.goto(`/projects/${sessao.projectId}/sessions/${sessao.sessionId}`);
  await page.locator('[data-testid="pendencias-de-outras-sessoes"]').waitFor({ timeout: 30_000 });
  await fotografar(page, 'plano-e-modo-automatico', 'Plano de execução e modo automático');
});

let execucao: Awaited<ReturnType<typeof semearExecucao>>;
let tarefaDaExecucao = '';

test('dev-agent: o fio do dev agent na execução', async () => {
  test.setTimeout(240_000);
  execucao = await semearExecucao(token, {
    name: 'Encurtador de links (execução)',
    modulos: [{ name: 'api' }],
    tarefas: [{ modulo: 'api', titulo: 'Encurtar um endereço' }],
  });
  ({ taskId: tarefaDaExecucao } = await esperarGateAberto(token, execucao));
  await page.goto(`/projects/${execucao.projectId}/sessions/${execucao.execucaoId}`);
  await page.waitForLoadState('networkidle');
  await fotografar(page, 'dev-agent', 'Dev agent trabalhando na execução');
});

test('merges no chat: a PR pronta para o dono', async () => {
  await aprovarOsGates(execucao, tarefaDaExecucao); // a PR fica pronta para o dono; NÃO mergeia (RN-825)
  await page.goto(`/projects/${execucao.projectId}/sessions/${execucao.sessionId}`);
  await fotografar(page, 'merges-no-chat', 'PR pronta para o merge no chat', async () => {
    await abrirFila(page, 'prontas');
    await page.locator('[data-testid="pr-pronta"]').first().waitFor({ timeout: 45_000 });
  });
});
