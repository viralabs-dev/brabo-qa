// Fecha o check `E2E do brabo-qa` na PR de origem (AT-765). Roda no job `fechar` do e2e-pr.yml (needs: e2e, if: always()),
// SEPARADO do job que executa código de PR: só aqui existe o token do App. Os desfechos do job e2e chegam por env e os
// resultados por env (JSON de job outputs, tratados como DADO: só são parseados e impressos). O resumo vem do `montarCheck` do brabo-ci
// (checkout em `.brabo-ci`, repinar no merge da AT-765 Task 10).
import { readFileSync } from 'node:fs';
import type { LinhaDigest } from './conferir-digests.ts';
import { catalogoAtivo, idsAtivos, sanitizarCobertura } from './cobertura.ts';
import type { Causa } from './relatorio.ts';
import { caber, limpar, montarRelatorio, sanitizarResumo, type Relatorio } from './relatorio.ts';

type Servico = LinhaDigest['servico'];
type Desfecho = 'success' | 'failure' | 'cancelled' | 'skipped' | '';
export interface Desfechos { validar: Desfecho; job: Desfecho; assinatura: Desfecho; digest: Desfecho; spec: Desfecho }

const lerEnv = <T>(nome: string): T | null => {
  try {
    return JSON.parse(process.env[nome] ?? '') as T;
  } catch {
    return null;
  }
};

// `job` é o `needs.e2e.result` do runner (success|failure|cancelled|skipped), que o código da PR não forja.
// Verde só com o job inteiro em success E a conferência de digest e as specs em success; qualquer outro desfecho
// sem causa reconhecida (checkout, pulo, timeout) é `ambiente`.
export function decidirFechamento(a: { cancelado: boolean; desfechos: Desfechos }): { tipo: 'cancelled' } | { tipo: 'causa'; causa: Causa | null } {
  if (a.cancelado) return { tipo: 'cancelled' };
  const d = a.desfechos;
  if (d.validar === 'success' && d.job === 'success' && d.assinatura === 'success' && d.digest === 'success' && d.spec === 'success') return { tipo: 'causa', causa: null };
  if (d.assinatura === 'failure') return { tipo: 'causa', causa: 'assinatura' };
  if (d.digest === 'failure') return { tipo: 'causa', causa: 'digest' };
  if (d.spec === 'failure') return { tipo: 'causa', causa: 'spec' };
  return { tipo: 'causa', causa: 'ambiente' };
}

// Anexa a tabela Vínculos (vinculos.md da action do brabo-ci) ao resumo; o check aceita até 65535 caracteres (AT-773).
export const anexarVinculos = (resumo: string, md?: string): string => (md?.trim() ? `${resumo}\n\n${md.trim().slice(0, 8000)}` : resumo);

const lerVinculos = (): string | undefined => {
  try {
    return process.env.VINCULOS_MD ? readFileSync(process.env.VINCULOS_MD, 'utf8') : undefined;
  } catch {
    return undefined; // os vínculos nunca impedem fechar o check
  }
};

// Formato do `RelatorioRegressivo` do brabo-ci (qa-e2e-resumo.ts): o nosso JSON v1 menos o que lá não existe.
export const deRelatorio = (r: Relatorio) => ({
  versao: 1 as const, origem: { repo: r.origem?.repo ?? '', pr: r.origem?.pr ?? '', sha: r.origem?.sha ?? '' }, ...(r.html ? { html: r.html } : {}), ...(r.tocadas ? { tocadas: r.tocadas } : {}),
  funcionalidades: r.funcionalidades.map(({ nome: _n, ...f }) => f), specs: r.specs,
});

// Comentário fixo na PR de origem (AT-791): marcado, UM por PR, editado a cada run. Só nasce quando o run é vermelho; se já existe, vira verde.
export const MARCA_DO_COMENTARIO = '<!-- relatorio-regressivo -->';
export const corpoDoComentario = (md: string): string => `${MARCA_DO_COMENTARIO}\n${md}`.slice(0, 65000);
export function comentarioExistente(comentarios: { id: number; body?: string; user?: { type?: string } }[]): number | null {
  return comentarios.find((c) => c.body?.startsWith(MARCA_DO_COMENTARIO) && c.user?.type === 'Bot')?.id ?? null;
}
async function atualizarComentario(repo: string, pr: string, md: string, vermelho: boolean, cab: Record<string, string>): Promise<void> {
  const base = `https://api.github.com/repos/viralabs-dev/${repo}/issues`;
  const lista = (await (await fetch(`${base}/${pr}/comments?per_page=100`, { headers: cab })).json()) as Parameters<typeof comentarioExistente>[0];
  const id = Array.isArray(lista) ? comentarioExistente(lista) : null;
  if (id === null && !vermelho) return;
  const res = await fetch(id === null ? `${base}/${pr}/comments` : `${base}/comments/${id}`, { method: id === null ? 'POST' : 'PATCH', headers: cab, body: JSON.stringify({ body: corpoDoComentario(md) }) });
  // Status e corpo curtos e sem quebra/controle, para o warning dizer por que a API recusou (ex.: 403 de permissão).
  if (!res.ok) throw new Error(`${res.status} ${limpar(await res.text().catch(() => ''), 200)}`);
}

// Só `cancelled` do job e2e é cancelamento; o timeout dele chega como `failure` e vira `ambiente`.
export const foiCancelado = (resultadoDoJob: string): boolean => resultadoDoJob === 'cancelled';

// Os dois checks do brabo-qa: o portão da main e o regressivo da dev (AT-769, nunca exigido). O nome decide o modo do resumo.
export const NOME_DO_PORTAO = 'E2E do brabo-qa';
export const NOME_DO_REGRESSIVO = 'Regressivo do brabo-qa';

// O check só é tocado se for o NOSSO, do head validado e em andamento (ou já fechado: reexecução, RN-1067). Devolve o motivo da recusa.
export function checkConfere(c: { name: string; head_sha: string; status: string; app?: { id: number } | null }, headSha: string, appId: number): string | null {
  if (c.name !== NOME_DO_PORTAO && c.name !== NOME_DO_REGRESSIVO) return `nome inesperado: ${c.name}`;
  if (c.head_sha !== headSha) return 'head_sha diferente do validado';
  if (c.status !== 'in_progress' && c.status !== 'completed') return `status inesperado: ${c.status}`;
  if (c.app?.id !== appId) return 'o check não pertence ao nosso App';
  return null;
}

// Reexecução (RN-1067): o check já fechado não reabre. Nasce um check novo, mesmo nome e mesmo head, e o resumo cita o anterior.
export const avisoDeReexecucao = (id: string, url?: string): string => `Reexecução: este resultado substitui o do check anterior (${url ?? `check-run ${id}`}), que não foi alterado.\n\n`;

// Até 50 títulos, de até 200 caracteres, vindos do job e2e (o conteúdo é de PR: só texto no resumo).
const specsQueFalharam = (): string[] => (lerEnv<unknown[]>('SPECS_FALHAS') ?? []).filter((t): t is string => typeof t === 'string').slice(0, 50).map((t) => t.slice(0, 200));

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  const { validarPayload, REPOS } = await import('./validar-payload.ts');
  let imagens: Record<string, string> = {};
  try { imagens = JSON.parse(env.RAW_IMAGENS ?? '{}'); } catch { /* validarPayload reprova */ }
  const p = { repo: env.RAW_REPO ?? '', pr: env.RAW_PR ?? '', head_sha: env.RAW_HEAD_SHA ?? '', check_run_id: env.RAW_CHECK_RUN_ID ?? '', compose_ref: env.RAW_COMPOSE_REF ?? '', imagens, modo: env.RAW_MODO, funcionalidades: env.RAW_FUNCIONALIDADES };
  const v = validarPayload(p);
  const repo = p.repo.replace(/^viralabs-dev\//, '');
  // Sem repo da lista e check_run_id numérico não há alvo confiável: não se fecha nada.
  if (!REPOS.includes(repo) || !/^[0-9]+$/.test(p.check_run_id)) {
    console.error('::error::repo ou check_run_id inválidos: não há check confiável para fechar');
    process.exit(1);
  }
  if (!env.GH_TOKEN) {
    console.error('::error::App sem acesso ou chave inválida: o token do App não foi criado, o check não foi fechado');
    process.exit(1);
  }
  const o = (k: string) => (env[k] ?? '') as Desfecho;
  const decisao = decidirFechamento({
    cancelado: foiCancelado(env.E2E_RESULT ?? ''),
    desfechos: { validar: o('VALIDAR'), job: o('JOB'), assinatura: o('ASSINATURA'), digest: o('DIGEST'), spec: o('SPEC') },
  });
  const api = `https://api.github.com/repos/viralabs-dev/${repo}/check-runs/${p.check_run_id}`;
  const cab = { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' };
  const atual = (await (await fetch(api, { headers: cab })).json()) as Parameters<typeof checkConfere>[0] & { html_url?: string };
  // head_sha inválido: não há o que comparar, mas nome, status e App continuam exigidos.
  const recusa = checkConfere(atual, v.ok ? p.head_sha : atual.head_sha, Number(env.APP_ID));
  if (recusa) {
    console.error(`::error::check não tocado: ${recusa}`);
    process.exit(1);
  }
  const urlDoRun = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const vinculos = lerVinculos();
  let c: { conclusion: string; title: string; summary: string; text?: string; external_id: string };
  let comentario: { md: string; vermelho: boolean } | null = null;
  if (decisao.tipo === 'cancelled') {
    c = { conclusion: 'cancelled', title: 'E2E cancelado', summary: anexarVinculos(`Run cancelado (nova execução para o mesmo PR ou cancelamento manual): ${urlDoRun}`, vinculos), external_id: 'causa:' };
  } else if (!v.ok) {
    c = { conclusion: 'failure', title: 'E2E: payload inválido (ambiente)', summary: anexarVinculos(`O payload do dispatch foi recusado:\n\n${v.erros.map((e) => `- ${e}`).join('\n')}\n\nRun: ${urlDoRun}`, vinculos), external_id: 'causa:ambiente' };
  } else {
    // Import só aqui: o caminho do cancelado e do payload inválido não carrega código do `.brabo-ci`.
    let montarCheck: (r: unknown) => typeof c;
    try {
      ({ montarCheck } = await import(new URL('../../.brabo-ci/scripts/ci/qa-e2e-resumo.ts', import.meta.url).href));
    } catch {
      console.error('::error::.brabo-ci ausente: não dá para montar o resumo; o check fica para a varredura de órfãos');
      process.exit(1);
    }
    const esperado = (lerEnv<Record<Servico, string>>('DIGESTS') ?? {}) as Record<Servico, string>;
    const assinaturas = lerEnv<Record<Servico, 'ok' | 'falhou'>>('ASSINATURAS') ?? ({} as Record<Servico, 'ok' | 'falhou'>);
    const conferencia = lerEnv<{ linhas: LinhaDigest[] }>('CONFERENCIA');
    const linhas: LinhaDigest[] = (Object.keys(imagens) as Servico[]).map((servico) => ({
      servico,
      esperado: esperado[servico] ?? imagens[servico]!,
      encontrado: conferencia?.linhas.find((l) => l.servico === servico)?.encontrado ?? null,
      assinatura: assinaturas[servico] ?? 'não conferida',
    }));
    const causa = decisao.causa;
    // Tabela por funcionalidade (AT-769); o catálogo vem do checkout limpo da `dev`, o resultado é dado de PR.
    let cobertura: ReturnType<typeof sanitizarCobertura>;
    try { cobertura = sanitizarCobertura(lerEnv<unknown>('COBERTURA'), idsAtivos(readFileSync('funcionalidades.yml', 'utf8'))); } catch { /* sem tabela, o check segue */ }
    // Relatório de decisão (AT-791): o JSON v1 sai do resumo sanitizado; o `montarCheck` do brabo-ci (repin da L1) o usa e devolve `text`.
    const modo = atual.name === NOME_DO_REGRESSIVO ? 'dev' : 'main';
    let relatorio: Relatorio | undefined;
    try {
      const yaml = readFileSync('funcionalidades.yml', 'utf8');
      const catalogo = catalogoAtivo(yaml);
      const resumo = sanitizarResumo(lerEnv<unknown>('RELATORIO'), catalogo.map((x) => x.id));
      const { motivos, semDono, tocadas } = (await import('./validar-payload.ts')).validarMotivos(env.RAW_MOTIVOS, env.RAW_SEMDONO, env.RAW_TOCADAS, env.RAW_SELECAO);
      const pedidos = (await import('./validar-payload.ts')).validarModo(p.modo, p.funcionalidades).ids;
      if (resumo) relatorio = montarRelatorio(resumo.specs, { catalogo, modo, ids: modo === 'dev' ? pedidos : catalogo.map((x) => x.id), causa, digests: linhas, run: urlDoRun, html: env.HTML_URL || undefined, motivos, semDono, tocadas, origem: { repo, pr: p.pr, sha: p.head_sha } }, resumo.omitidas);
    } catch { /* sem relatório, o check segue com o resumo de sempre */ }
    c = montarCheck({ modo, cobertura, causa, linhas, specsQueFalharam: causa === 'spec' ? specsQueFalharam() : [], urlDoRun, vinculos, semDono: relatorio?.semDono, relatorio: relatorio && deRelatorio(relatorio) });
    if (relatorio) comentario = { md: caber(relatorio, 60000, { comentario: true, detalhe: false }), vermelho: c.conclusion === 'failure' };
  }
  const reexecucao = atual.status === 'completed';
  const summary = reexecucao ? avisoDeReexecucao(p.check_run_id, atual.html_url) + c.summary : c.summary;
  const resultado = { status: 'completed', conclusion: c.conclusion, external_id: c.external_id, details_url: urlDoRun, output: { title: c.title, summary: summary.slice(0, 65000), ...(c.text ? { text: c.text.slice(0, 65000) } : {}) } };
  const res = await fetch(reexecucao ? `https://api.github.com/repos/viralabs-dev/${repo}/check-runs` : api, {
    method: reexecucao ? 'POST' : 'PATCH',
    headers: cab,
    body: JSON.stringify(reexecucao ? { name: atual.name, head_sha: atual.head_sha, ...resultado } : resultado),
  });
  if (!res.ok) throw new Error(`falha ao fechar o check: ${res.status} ${await res.text()}`);
  // O comentário nunca impede o fechamento (o token do App pode não ter `issues: write`).
  if (comentario) await atualizarComentario(repo, p.pr, comentario.md, comentario.vermelho, cab).catch((err) => console.error(`::warning::comentário fixo não atualizado: ${err}`));
  console.log(`check ${p.check_run_id} ${reexecucao ? 'reexecutado em check novo' : 'fechado'}: ${c.conclusion} (${c.title})`);
}
