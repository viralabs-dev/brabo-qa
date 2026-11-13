import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, type Page } from '@playwright/test';
import { API_URL, autenticar, cookiesDeUmLoginProprio, proporAdr, type SessaoSemeada } from '../suporte/api.ts';
import { anexarEvento, eventosDaSessao } from '../suporte/eventos.ts';
import { chamarInterno, criarEpico, criarHistoria, criarMapaDeModulos, criarTarefa, ligarModulos } from '../suporte/interno.ts';
import { COR_DA_MASCARA, conferirSemDadoSensivel, fixarNaPagina, mascaras } from '../suporte/ocultar.ts';

/**
 * As 25 telas da v9 (AT-897), do produto de pé com o provider dublê (RN-1065), a 1440 px nos dois temas.
 * Estado: o projeto "Agenda da Clínica (demo)" da prévia, semeado por HTTP e por rotas internas (sem LLM pago).
 * Nome do arquivo = `<id> - <nome> (<tema>).png`, o mesmo id da prévia. Falha de uma tela não derruba as outras.
 */
const SAIDA = process.env.CAPTURAS_SAIDA ?? join(import.meta.dirname, 'saida');
const TEMAS = [['dark', 'dark'], ['light', 'light']] as const;
const falhas: string[] = [];
const feitas: string[] = [];

let token = '';
let s: SessaoSemeada;
let execucaoId = '';

const ATOR_PO = { kind: 'agent', id: 'po' } as const;

/** O projeto nasce no workspace do seed (`acme-corp`), o que a sidebar lista; o dublê ocupa o modelo `ollama` dele. */
async function semearNoWorkspaceDoSeed(): Promise<SessaoSemeada> {
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const chamar = async (url: string, init?: RequestInit): Promise<any> => {
    const r = await fetch(`${API_URL}${url}`, { ...init, headers: h });
    const x = await r.text();
    if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url}: ${r.status} ${x.slice(0, 300)}`);
    return JSON.parse(x);
  };
  const ws = (await chamar('/workspaces')) as any;
  const lista: any[] = Array.isArray(ws) ? ws : ws.items;
  const w = (lista.find((x) => x.workspace?.slug === 'acme-corp') ?? lista[0]).workspace;
  const projeto = await chamar(`/workspaces/${w.id}/projects`, { method: 'POST', body: JSON.stringify({ name: 'Agenda da Clínica (demo)', slug: `agenda-${Date.now()}` }) });
  const sessao = await chamar(`/projects/${projeto.id}/sessions`, { method: 'POST', body: JSON.stringify({ kind: 'criativa' }) });
  await chamar(`/projects/${projeto.id}/sessions/${sessao.id}/transition`, { method: 'POST', body: JSON.stringify({ status: 'active' }) });
  return { workspaceId: w.id, projectId: projeto.id, sessionId: sessao.id };
}

async function semear(): Promise<void> {
  token = await autenticar();
  s = await semearNoWorkspaceDoSeed();
  const falar = async (text: string, n: number) => {
    const r = await fetch(`${API_URL}/projects/${s.projectId}/sessions/${s.sessionId}/agents/criativo/message`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error(`mensagem recusada: ${r.status}`);
    const limite = Date.now() + 60_000;
    while ((await eventosDaSessao(token, s)).filter((e) => e.type === 'agent.response').length < n) {
      if (Date.now() > limite) throw new Error('faltam respostas do Criativo');
      await new Promise((ok) => setTimeout(ok, 500));
    }
  };
  await falar('Quero uma agenda online para uma clínica pequena: o paciente marca sozinho, a recepção acompanha o dia.', 1);
  for (const [t, x] of [
    ['Paciente marca online com conta única', 'O paciente cria uma conta única com nome, telefone e e-mail.'],
    ['A recepção cancela em nome do paciente', 'A recepção gerencia e cancela consultas em nome do paciente.'],
    ['Cancelamento até 24 h antes', 'O cancelamento é permitido até 24 h antes da consulta.'],
    ['Consultas de 30 min fixos', 'Toda consulta dura 30 minutos.'],
    ['Sem dupla marcação', 'Um profissional não tem duas consultas no mesmo horário.'],
    ['Confirmação por e-mail', 'Toda marcação gera um e-mail de confirmação.'],
  ] as const) await anexarEvento(token, s, 'artifact.business_rule', ATOR_PO, { title: t, text: x });
  const regra = (await anexarEvento(token, s, 'artifact.business_rule', ATOR_PO, { title: 'Só horários livres', text: 'Só se marca em horário livre.' }));
  await anexarEvento(token, s, 'agent.activated', { kind: 'agent', id: 'arquiteto' }, { agent: 'arquiteto' });
  const nomes = ['persistence', 'schedule', 'booking', 'notifications', 'app-shell', 'web-ui'];
  await criarMapaDeModulos(s, nomes.map((name) => ({ name, responsibility: name })));
  await chamarInterno(s, 'c4-diagram', { systemName: 'Agenda da Clínica', actors: [{ name: 'Paciente' }, { name: 'Recepção' }] });
  const ep = [await criarEpico(s, 'Agendamento online'), await criarEpico(s, 'Gestão da recepção'), await criarEpico(s, 'Notificações')];
  const hist = [0, 0, 0, 0, 1, 1, 1, 2, 2];
  const tarefas = [0, 1, 2, 3, 4, 5, 6, 7];
  const ids: string[] = [];
  for (const [i, e] of hist.entries()) {
    const h = await criarHistoria(s, ep[e]!.id, `História ${i + 1}`, [regra.id]);
    await ligarModulos(s, h.id, [nomes[i % nomes.length]!]);
    if (tarefas.includes(i)) ids.push((await criarTarefa(s, h.id, `Tarefa ${i + 1}`)).id);
  }
  for (const [autor, pergunta] of [['po', 'Quantos profissionais a clínica tem?'], ['po', 'Há feriados?'], ['arquiteto', 'Quantos acessos por dia?'], ['po', 'Quem cancela depois das 24 h?']] as const) {
    await anexarEvento(token, s, 'artifact.open_question', { kind: 'agent', id: autor }, {
      questionId: randomUUID(), pergunta, afeta: { regras: [], historias: [], tarefas: [] }, autor, sessionId: s.sessionId,
    });
  }
  await proporAdr(token, s, {
    title: 'Monólito modular com SQLite em arquivo e processo HTTP único',
    slug: 'banco-sqlite-monolito-modular',
    content: '# Monólito modular com SQLite\n\n## Contexto\nClínica pequena.\n\n## Decisão\nSQLite em arquivo.\n\n## Consequências\nSem servidor de banco.\n',
  });
}

async function tema(page: Page, t: 'dark' | 'light'): Promise<void> {
  await page.evaluate((x) => localStorage.setItem('brabo.theme', x), t);
}

interface Tela { id: string; nome: string; rota: () => string; antes?: (p: Page) => Promise<void>; deslogada?: boolean }

const P = () => `/projects/${s.projectId}`;
const telas: Tela[] = [
  { id: 'S00', nome: 'login', rota: () => '/login', deslogada: true },
  { id: 'S01', nome: 'inicio', rota: () => '/' },
  { id: 'S07', nome: 'caixa', rota: () => '/decisions' },
  { id: 'S02', nome: 'containers', rota: () => '/containers' },
  { id: 'S03', nome: 'providers', rota: () => '/providers' },
  { id: 'H01', nome: 'providers-ajuda', rota: () => '/providers', antes: async (p) => { await p.getByRole('button', { name: /^(Ajuda|Help):/ }).first().click(); await p.waitForTimeout(700); } },
  { id: 'S04', nome: 'conta', rota: () => '/account' },
  { id: 'S05', nome: 'status', rota: () => '/status' },
  { id: 'S06', nome: 'gastos', rota: () => '/spend' },
  { id: 'P10', nome: 'visao-geral', rota: () => P() },
  { id: 'P13', nome: 'sessoes', rota: () => `${P()}?tab=todas` },
  { id: 'P23', nome: 'criativo', rota: () => `${P()}?tab=criativo` },
  { id: 'P12', nome: 'historias', rota: () => `${P()}?tab=backlog` },
  { id: 'P11', nome: 'executores', rota: () => `${P()}?tab=executores` },
  { id: 'P22', nome: 'codigo', rota: () => `${P()}?tab=code` },
  { id: 'P15', nome: 'prs', rota: () => `${P()}?tab=prs` },
  { id: 'P14', nome: 'aprovacoes', rota: () => `${P()}?tab=approvals` },
  { id: 'P17', nome: 'percepcoes', rota: () => `${P()}?tab=insights` },
  { id: 'P16', nome: 'arquitetura', rota: () => `${P()}?tab=arquitetura` },
  { id: 'P21', nome: 'gastos', rota: () => `${P()}?tab=spend` },
  { id: 'P18', nome: 'config-projeto', rota: () => `${P()}?tab=settings&group=projeto` },
  { id: 'P19', nome: 'config-pessoas', rota: () => `${P()}?tab=settings&group=pessoas` },
  { id: 'P20', nome: 'config-avancado', rota: () => `${P()}?tab=settings&group=avancado` },
  { id: 'C30', nome: 'sessao-fio', rota: () => `${P()}/sessions/${s.sessionId}` },
  { id: 'C31', nome: 'sessao-passos', rota: () => `${P()}/sessions/${s.sessionId}`, antes: async (p) => {
    for (const b of await p.getByRole('button', { name: /Passos|steps/i }).all()) await b.click().catch(() => {});
    await p.waitForTimeout(800);
  } },
];

async function fotografar(page: Page, t: Tela, th: 'dark' | 'light'): Promise<void> {
  const nome = `${t.id} - ${t.nome} (${th})`;
  try {
    await page.goto(t.rota());
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
    await t.antes?.(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const extra = await page.evaluate(() => Math.max(0, ...[...Array.from(document.querySelectorAll("*"))].map((e) => e.scrollHeight - e.clientHeight)));
    if (extra > 0) { await page.setViewportSize({ width: 1440, height: Math.min(900 + extra, 4000) }); await page.waitForTimeout(500); }
    await fixarNaPagina(page);
    await conferirSemDadoSensivel(page, nome);
    mkdirSync(SAIDA, { recursive: true });
    await page.screenshot({ path: join(SAIDA, `${nome}.png`), mask: mascaras(page), maskColor: COR_DA_MASCARA, animations: 'disabled', caret: 'hide' });
    feitas.push(nome);
  } catch (e) {
    falhas.push(`${nome}: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

test('as 25 telas da v9', async ({ browser }) => {
  await semear();
  const logada = await browser.newContext({ baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:8088', viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  await logada.addCookies(await cookiesDeUmLoginProprio());
  const page = await logada.newPage();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const so = process.env.SO;
  for (const th of ['dark', 'light'] as const) {
    await tema(page, th);
    for (const t of telas.filter((x) => !x.deslogada && (!so || so.split(',').includes(x.id)))) await fotografar(page, t, th);
  }
  await logada.close();
  for (const th of ['dark', 'light'] as const) {
    const c = await browser.newContext({ baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:8088', viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
    await c.addInitScript((x) => localStorage.setItem('brabo.theme', x), th);
    const p = await c.newPage();
    for (const t of telas.filter((x) => x.deslogada && (!so || so.split(',').includes(x.id)))) await fotografar(p, t, th);
    await c.close();
  }
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(join(SAIDA, 'resultado.json'), JSON.stringify({ feitas, falhas, projeto: s.projectId }, null, 2));
  console.log(`capturadas ${feitas.length}, falhas ${falhas.length}`);
  for (const f of falhas) console.log('FALHA', f);
});
