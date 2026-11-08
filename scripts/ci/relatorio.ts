// Relatório de decisão do regressivo (AT-791): a ÚNICA fonte é o JSON v1 montado do `resultado.json` do Playwright; Summary,
// check e comentário da PR são derivados dele. Roda no job e2e (Summary + artefatos) e no `fechar` (sobre o resumo
// compacto, sanitizado: o dado vem do job que executa código de PR). Sem dependências além do node.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import type { LinhaDigest } from './conferir-digests.ts';
import { catalogoAtivo } from './cobertura.ts';

export type Causa = 'spec' | 'ambiente' | 'digest' | 'assinatura' | 'sem-resposta';
export type StatusSpec = 'passou' | 'falhou' | 'flaky' | 'pulou';
export interface SpecR {
  funcionalidades: string[];
  titulo: string;
  arquivo: string;
  linha: number;
  status: StatusSpec;
  tentativas: number;
  duracao_ms: number;
  erro?: string;
  anexos: string[];
}
export interface Contexto {
  catalogo: { id: string; nome: string }[];
  modo: 'main' | 'dev';
  /** O que o run devia cobrir: o catálogo ativo (portão) ou as funcionalidades pedidas (regressivo). */
  ids: string[];
  causa: Causa | null;
  origem?: { repo?: string; pr?: string; sha?: string };
  run?: string;
  html?: string;
  artefato?: string;
  digests?: LinhaDigest[];
  /** id -> caminhos que puxaram a funcionalidade (payload do gatilho). */
  motivos?: Record<string, string[]>;
  semDono?: string[];
  vinculos?: string;
}
export interface Recomendacao { acao: 'aprovar' | 'bloquear' | 'aceitar com justificativa' | 'rodar de novo'; texto: string }
export interface LinhaF {
  id: string; nome: string; motivo: string[]; specs: number; passou: number; falhou: number; flaky: number; pulou: number;
  duracao_ms: number; resultado: 'verde' | 'vermelho' | 'sem cobertura';
}
export interface Relatorio {
  versao: 1; modo: 'main' | 'dev'; veredito: 'verde' | 'vermelho'; causa: Causa | null; recomendacao: Recomendacao;
  origem: Contexto['origem'] | null; run: string | null; html: string | null; artefato: string | null; duracao_ms: number;
  funcionalidades: LinhaF[]; specs: SpecR[]; semFuncionalidade: SpecR[]; digests: LinhaDigest[]; vinculos: string | null;
  motivos: Record<string, string[]>; semDono: string[]; omitidas: number;
}

// eslint-disable-next-line no-control-regex
export const semAnsi = (s: string): string => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
/** Texto de PR em linha de Markdown: sem ANSI, truncado, sem `|`, crase, `<` nem @menção ativa. */
export const limpar = (s: unknown, n: number): string =>
  semAnsi(String(s ?? '')).replace(/\s+/g, ' ').trim().slice(0, n).replace(/\|/g, '\\|').replace(/`/g, "'").replace(/</g, '&lt;').replace(/@/g, '@\u200b');
/** Texto em bloco de código: só a crase precisa sair (a cerca é de três). */
const emBloco = (s: unknown, n: number): string => semAnsi(String(s ?? '')).slice(0, n).replace(/`/g, "'");

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUS: StatusSpec[] = ['passou', 'falhou', 'flaky', 'pulou'];

/** Achata o `resultado.json`. Spec com 2 projetos: o pior status vale. `null` = a suíte não produziu resultado. */
export function extrairSpecs(resultado: unknown, ativos: string[]): SpecR[] | null {
  if (!resultado || typeof resultado !== 'object') return null;
  const out: SpecR[] = [];
  const visitar = (no: unknown): void => {
    if (Array.isArray(no)) return no.forEach(visitar);
    if (!no || typeof no !== 'object') return;
    const o = no as Record<string, unknown>;
    if (Array.isArray(o.specs)) {
      for (const s of o.specs as Record<string, any>[]) {
        const tests: Record<string, any>[] = Array.isArray(s.tests) ? s.tests : [];
        const sts = tests.map((t) => String(t.status));
        const status: StatusSpec = sts.includes('unexpected') || s.ok === false ? 'falhou' : sts.includes('flaky') ? 'flaky'
          : sts.length > 0 && sts.every((x) => x === 'skipped') ? 'pulou' : 'passou';
        const results: Record<string, any>[] = tests.flatMap((t) => (Array.isArray(t.results) ? t.results : []));
        const ruins = results.filter((r) => r.status === 'failed' || r.status === 'timedOut' || r.status === 'interrupted');
        const ref = ruins.at(-1) ?? results.at(-1);
        const msg = status === 'falhou' || status === 'flaky' ? ref?.error?.message ?? ref?.errors?.[0]?.message : undefined;
        const tags = (Array.isArray(s.tags) ? s.tags : []).map((x: unknown) => String(x).replace(/^@/, ''));
        const fs = [...new Set(tags.map((t: string) => /^f-([a-z0-9-]+)$/.exec(t)?.[1]).filter((i: string | undefined): i is string => !!i && ativos.includes(i)))];
        const arquivo = String(s.file ?? '');
        out.push({
          funcionalidades: fs, titulo: (/\.setup\.ts$/.test(arquivo) ? '(preparação) ' : '') + String(s.title ?? ''), arquivo, linha: Number(s.line) || 0, status,
          tentativas: Math.max(1, ...tests.map((t) => (Array.isArray(t.results) ? t.results.length : 1))),
          duracao_ms: results.reduce((a, r) => a + (Number(r.duration) || 0), 0),
          ...(msg ? { erro: semAnsi(String(msg)) } : {}),
          anexos: [...new Set((ref?.attachments ?? []).map((a: any) => String(a?.name ?? '')).filter(Boolean))] as string[],
        });
      }
    }
    Object.values(o).forEach(visitar);
  };
  visitar(resultado);
  return out;
}

const somar = (xs: SpecR[], st: StatusSpec) => xs.filter((s) => s.status === st).length;

/** Tabela de recomendação (RN-1051). `tocadas` = funcionalidades que a PR toca pelo mapa. */
export function recomendar(c: Pick<Contexto, 'modo' | 'ids' | 'causa' | 'motivos'>, specs: SpecR[]): Recomendacao {
  const pre = c.modo === 'dev' ? 'atestado (não bloqueia): ' : '';
  const r = (acao: Recomendacao['acao'], texto: string): Recomendacao => ({ acao, texto: pre + texto });
  if (c.causa === 'digest' || c.causa === 'assinatura') return r('bloquear', 'bloquear: digest e assinatura nunca se aceitam; rode o E2E de novo');
  if (c.causa === 'ambiente' || c.causa === 'sem-resposta') return r('rodar de novo', 'rodar de novo; se repetir, aceitar com justificativa');
  if (c.causa === 'spec') {
    const motivos = c.motivos ?? {};
    const tocadas = new Set([...Object.keys(motivos), ...(c.modo === 'dev' ? c.ids : [])]);
    const falhas = specs.filter((s) => s.status === 'falhou');
    // Portão da main sem o mapa informado: não dá para dizer que a falha está fora da mudança.
    if (tocadas.size === 0 || falhas.some((s) => s.funcionalidades.some((f) => tocadas.has(f)))) return r('bloquear', 'bloquear: há spec vermelha em funcionalidade que a PR toca; corrigir antes');
    return r('aceitar com justificativa', 'aceitar com justificativa (/qa-aceitar): a falha está fora das funcionalidades que a PR toca');
  }
  return r('aprovar', somar(specs, 'flaky') > 0 ? 'aprovar, com aviso: há spec flaky (passou só na nova tentativa)' : 'aprovar');
}

export function montarRelatorio(specsTodas: SpecR[] | null, c: Contexto, omitidas = 0): Relatorio {
  const specs = specsTodas ?? [];
  const motivos = c.motivos ?? {};
  const funcionalidades: LinhaF[] = c.ids.map((id) => {
    const mine = specs.filter((s) => s.funcionalidades.includes(id));
    const falhou = somar(mine, 'falhou');
    return {
      id, nome: c.catalogo.find((x) => x.id === id)?.nome ?? id, motivo: motivos[id] ?? [], specs: mine.length, passou: somar(mine, 'passou'), falhou,
      flaky: somar(mine, 'flaky'), pulou: somar(mine, 'pulou'), duracao_ms: mine.reduce((a, s) => a + s.duracao_ms, 0),
      resultado: mine.length === 0 ? 'sem cobertura' : falhou > 0 ? 'vermelho' : 'verde',
    };
  });
  return {
    versao: 1, modo: c.modo, veredito: c.causa ? 'vermelho' : 'verde', causa: c.causa, recomendacao: recomendar(c, specs),
    origem: c.origem ?? null, run: c.run ?? null, html: c.html ?? null, artefato: c.artefato ?? null, duracao_ms: specs.reduce((a, s) => a + s.duracao_ms, 0),
    funcionalidades, specs, semFuncionalidade: specs.filter((s) => s.funcionalidades.length === 0), digests: c.digests ?? [], vinculos: c.vinculos ?? null,
    motivos, semDono: c.semDono ?? [], omitidas,
  };
}

const seg = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s` : `${(ms / 1000).toFixed(1)}s`);
const icone = (s: StatusSpec) => ({ passou: '✅', falhou: '❌', flaky: '⚠️', pulou: '⏭️' })[s];
const rotulo = (r: Relatorio) => r.veredito.toUpperCase() + (r.causa ? ` · causa ${r.causa}` : '');

export interface Opcoes { detalhe: boolean; linhasErro: number; maxFalhas: number; comentario?: boolean }

function montar(r: Relatorio, o: Opcoes): { md: string; cortes: string[] } {
  const cortes: string[] = [];
  const lim = (s: string, n: number) => limpar(s, n);
  const t = r.specs;
  const origem = r.origem?.repo ? `${r.origem.repo}${r.origem.pr ? `#${r.origem.pr}` : ''}${r.origem.sha ? ` (${r.origem.sha.slice(0, 7)})` : ''}` : null;
  const L: string[] = [
    `## Regressivo do brabo-qa: ${rotulo(r)}`, '',
    `**Recomendação: ${r.recomendacao.texto}**`, '',
    `Modo: ${r.modo === 'main' ? 'portão da main' : 'atestado da dev'}${origem ? ` · origem ${lim(origem, 80)}` : ''} · ${seg(r.duracao_ms)} · ` +
    `${t.length + r.omitidas} specs · ${somar(t, 'passou')} passaram · ${somar(t, 'falhou')} falharam · ${somar(t, 'flaky')} flaky`,
  ];
  const motivos = r.funcionalidades.filter((f) => f.motivo.length > 0);
  if (motivos.length > 0 || r.semDono.length > 0) {
    L.push('', '### Por que estas funcionalidades', '');
    for (const f of motivos) L.push(`- ${f.id}: ${f.motivo.slice(0, 5).map((m) => `\`${emBloco(m, 200).replace(/\s+/g, ' ')}\``).join(', ')}`);
    if (r.semDono.length > 0) L.push(`- arquivos sem dono: ${r.semDono.slice(0, 5).map((m) => `\`${emBloco(m, 200).replace(/\s+/g, ' ')}\``).join(', ')}`);
  }
  const cobertas = r.funcionalidades.filter((f) => f.specs > 0);
  const vazias = r.funcionalidades.filter((f) => f.specs === 0);
  L.push('', '### Por funcionalidade', '', '| funcionalidade | specs | ✅ | ❌ | flaky | tempo | resultado |', '|---|---|---|---|---|---|---|');
  for (const f of [...cobertas, ...vazias]) L.push(`| ${lim(f.id, 60)} | ${f.specs} | ${f.passou} | ${f.falhou} | ${f.flaky} | ${f.specs ? seg(f.duracao_ms) : '-'} | ${f.resultado === 'sem cobertura' ? 'sem cobertura (não reprova)' : f.resultado} |`);
  if (r.semFuncionalidade.length > 0) {
    const s = r.semFuncionalidade;
    L.push(`| sem funcionalidade | ${s.length} | ${somar(s, 'passou')} | ${somar(s, 'falhou')} | ${somar(s, 'flaky')} | ${seg(s.reduce((a, x) => a + x.duracao_ms, 0))} | ${somar(s, 'falhou') ? 'vermelho' : 'verde'} |`);
  }
  const falhas = t.filter((s) => s.status === 'falhou');
  if (falhas.length > 0) {
    L.push('', '### Falhas', '');
    for (const s of falhas.slice(0, o.maxFalhas)) {
      L.push(`**${s.funcionalidades.length ? s.funcionalidades.map((f) => `[f-${f}]`).join(' ') : '[sem funcionalidade]'} ${lim(s.titulo, 200)}**`,
        `${lim(s.arquivo, 200)}:${s.linha} · ${s.tentativas} tentativa(s)${s.anexos.length ? ` · anexos no artefato: ${s.anexos.map((a) => lim(a, 40)).join(', ')}` : ''}`);
      if (s.erro) L.push('```', emBloco(s.erro.split('\n').slice(0, o.linhasErro).join('\n'), 3000), '```');
      L.push('');
    }
    if (falhas.length > o.maxFalhas) cortes.push(`${falhas.length - o.maxFalhas} falhas`);
  }
  if (r.causa && r.causa !== 'spec') {
    L.push('', `### Causa: ${r.causa}`, '', r.causa === 'ambiente' || r.causa === 'sem-resposta' ? 'O ambiente falhou antes de as specs concluírem; veja o log do run.' : 'Falha na conferência das imagens; veja a tabela de digests.');
  }
  const flaky = t.filter((s) => s.status === 'flaky');
  if (flaky.length > 0) {
    L.push('', '### Flaky', '', ...flaky.map((s) => `- ${lim(s.titulo, 200)} (${lim(s.arquivo, 120)}:${s.linha}): passou só na tentativa ${s.tentativas}, ${seg(s.duracao_ms)} no total`));
  }
  if (o.detalhe) {
    L.push('', '### Detalhe por funcionalidade', '');
    const baldes = [...cobertas.map((f) => ({ id: f.id, xs: t.filter((s) => s.funcionalidades.includes(f.id)) })), ...(r.semFuncionalidade.length ? [{ id: 'sem funcionalidade', xs: r.semFuncionalidade }] : [])];
    for (const b of baldes) {
      L.push(`<details><summary>${lim(b.id, 60)} · ${somar(b.xs, 'passou')} ✅${somar(b.xs, 'falhou') ? ` · ${somar(b.xs, 'falhou')} ❌` : ''}</summary>`, '', ...b.xs.map((s) => `- ${icone(s.status)} ${lim(s.titulo, 160)} (${seg(s.duracao_ms)})`), '', '</details>', '');
    }
  } else if (!o.comentario) cortes.push('o detalhe por spec');
  if (r.omitidas > 0) cortes.push(`${r.omitidas} specs fora do resumo`);
  if (!o.comentario) {
    if (r.digests.length > 0) {
      L.push('', '### Digests e assinatura', '', '| serviço | esperado | encontrado | assinatura |', '|---|---|---|---|');
      for (const d of r.digests) L.push(`| ${lim(d.servico, 20)} | \`${emBloco(d.esperado, 120)}\` | ${d.encontrado ? `\`${emBloco(d.encontrado, 120)}\`` : '-'} | ${lim(d.assinatura, 20)} |`);
    }
    L.push('', '### Vínculos', '');
    if (r.run) L.push(`- Run: ${r.run}`);
    if (r.html) L.push(`- Relatório HTML do Playwright: ${r.html}`);
    if (r.artefato) L.push(`- Relatório (md e json): ${r.artefato}`);
    if (r.vinculos) L.push('', r.vinculos.trim().slice(0, 8000));
  } else if (r.run) L.push(`Detalhes no run: ${r.run}`);
  return { md: L.join('\n'), cortes };
}

/** Cabe em `limite` caracteres: degrada o detalhe, depois o erro (15 -> 3 linhas), depois as falhas (20) e deixa o aviso de corte. */
export function caber(r: Relatorio, limite: number, base: Partial<Opcoes> = {}): string {
  const passos: Opcoes[] = [
    { detalhe: true, linhasErro: 15, maxFalhas: 1e9 }, { detalhe: false, linhasErro: 15, maxFalhas: 1e9 },
    { detalhe: false, linhasErro: 3, maxFalhas: 1e9 }, { detalhe: false, linhasErro: 3, maxFalhas: 20 },
  ].map((p) => ({ ...p, ...base, detalhe: p.detalhe && (base.detalhe ?? true) }));
  let ultimo = '';
  for (const p of passos) {
    const { md, cortes } = montar(r, p);
    ultimo = cortes.length > 0 ? `${md}\n\n… ${cortes.join(', ')} a mais no artefato relatorio-regressivo-<run>` : md;
    if (ultimo.length <= limite) return ultimo;
  }
  return `${ultimo.slice(0, limite - 120)}\n\n… cortado: veja o artefato relatorio-regressivo-<run>`;
}

/** Resumo compacto para o job output (<= 60 KB): o que não passou vem primeiro; erro até 1000 caracteres. */
export function compactar(specs: SpecR[], max = 300): { specs: SpecR[]; omitidas: number } {
  const ordem = [...specs.filter((s) => s.status === 'falhou'), ...specs.filter((s) => s.status === 'flaky'), ...specs.filter((s) => s.status !== 'falhou' && s.status !== 'flaky')];
  return {
    specs: ordem.slice(0, max).map((s) => ({ ...s, titulo: s.titulo.slice(0, 200), arquivo: s.arquivo.slice(0, 200), ...(s.erro ? { erro: s.erro.slice(0, 1000) } : {}), anexos: s.anexos.slice(0, 5) })),
    omitidas: Math.max(0, specs.length - max),
  };
}

/** No `fechar`: o resumo vem de job que roda código de PR. Só passa id do catálogo, número no intervalo e texto truncado. */
export function sanitizarResumo(raw: unknown, ativos: string[]): { specs: SpecR[]; omitidas: number } | null {
  const o = raw as { specs?: unknown; omitidas?: unknown } | null;
  if (!o || !Array.isArray(o.specs)) return null;
  const num = (v: unknown, max: number) => (Number.isFinite(Number(v)) ? Math.min(Math.max(Math.trunc(Number(v)), 0), max) : 0);
  const specs = (o.specs as Record<string, unknown>[]).slice(0, 300).map((s): SpecR => ({
    funcionalidades: (Array.isArray(s.funcionalidades) ? s.funcionalidades : []).filter((f): f is string => typeof f === 'string' && KEBAB.test(f) && ativos.includes(f)).slice(0, 10),
    titulo: semAnsi(String(s.titulo ?? '')).slice(0, 200), arquivo: semAnsi(String(s.arquivo ?? '')).slice(0, 200), linha: num(s.linha, 1e6),
    status: STATUS.includes(s.status as StatusSpec) ? (s.status as StatusSpec) : 'falhou', tentativas: Math.max(1, num(s.tentativas, 20)), duracao_ms: num(s.duracao_ms, 1e8),
    ...(typeof s.erro === 'string' ? { erro: semAnsi(s.erro).slice(0, 1000) } : {}),
    anexos: (Array.isArray(s.anexos) ? s.anexos : []).filter((a): a is string => typeof a === 'string').slice(0, 5).map((a) => semAnsi(a).slice(0, 40)),
  }));
  return { specs, omitidas: num(o.omitidas, 1e6) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const e = process.env;
  const lerJson = (f: string): any => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
  const catalogo = catalogoAtivo(readFileSync('funcionalidades.yml', 'utf8'));
  const ativos = catalogo.map((x) => x.id);
  const pedidos = (e.FUNCIONALIDADES ?? '').split(',').filter(Boolean);
  const specs = extrairSpecs(lerJson(`${e.E2E_DIR || 'e2e'}/resultado.json`), ativos);
  // Mesma ordem do `decidirFechamento` (fechar-check.ts); não se importa de lá: o `fechar-check` importa este arquivo (ciclo com await).
  const causa: Causa | null = e.ASSINATURA === 'failure' ? 'assinatura' : e.DIGEST === 'failure' ? 'digest' : e.SPEC === 'failure' ? 'spec'
    : e.ASSINATURA === 'success' && e.DIGEST === 'success' && e.SPEC === 'success' ? null : 'ambiente';
  const digests: Record<string, string> = lerJson('digests.json') ?? {};
  const ass: Record<string, 'ok' | 'falhou'> = lerJson('assinaturas.json') ?? {};
  const conf: { linhas?: LinhaDigest[] } | null = lerJson('conferencia.json');
  const linhas = Object.keys(digests).map((servico) => ({ servico, esperado: digests[servico]!, encontrado: conf?.linhas?.find((l) => l.servico === servico)?.encontrado ?? null, assinatura: ass[servico] ?? 'não conferida' })) as LinhaDigest[];
  const url = `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}`;
  const rel = montarRelatorio(specs, {
    catalogo, modo: e.MODO === 'funcionalidades' ? 'dev' : 'main', ids: e.MODO === 'funcionalidades' ? pedidos : ativos, causa, digests: linhas,
    origem: { repo: e.REPO, pr: e.PR, sha: e.HEAD_SHA }, run: url, html: e.HTML_URL || undefined, artefato: e.ARTEFATO_URL || undefined,
    motivos: (() => { try { return JSON.parse(e.MOTIVOS || '{}'); } catch { return {}; } })(), semDono: (() => { try { return JSON.parse(e.SEMDONO || '[]'); } catch { return []; } })(),
  });
  writeFileSync('relatorio-regressivo.json', JSON.stringify(rel, null, 2));
  const md = caber(rel, 900_000);
  writeFileSync('relatorio-regressivo.md', md);
  if (e.GITHUB_STEP_SUMMARY) appendFileSync(e.GITHUB_STEP_SUMMARY, `${md}\n`);
  const comp = compactar(specs ?? []);
  // Ids do catálogo com spec executada: viram os jobs `Funcionalidade · <id>` (só exibição).
  const ids = rel.funcionalidades.filter((f) => f.specs > 0).map((f) => f.id);
  appendFileSync(e.GITHUB_OUTPUT!, `funcionalidades=${JSON.stringify(ids)}\nresumo=${JSON.stringify(comp)}\n`);
}
