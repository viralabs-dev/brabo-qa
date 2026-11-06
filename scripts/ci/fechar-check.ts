// Fecha o check `E2E do brabo-qa` na PR de origem (AT-765). Roda com `if: always()` no fim do e2e-pr.yml.
// O resumo vem do `montarCheck` do brabo-ci (checkout em `.brabo-ci`, repinar no merge da AT-765 Task 10).
import { existsSync, readFileSync } from 'node:fs';
import type { LinhaDigest } from './conferir-digests.ts';

type Servico = LinhaDigest['servico'];
type Causa = 'spec' | 'ambiente' | 'digest' | 'assinatura' | 'sem-resposta';
type Desfecho = 'success' | 'failure' | 'cancelled' | 'skipped' | '';
export interface Desfechos { job: Desfecho; assinatura: Desfecho; digest: Desfecho; spec: Desfecho }

const lerJson = <T>(caminho: string): T | null => (existsSync(caminho) ? (JSON.parse(readFileSync(caminho, 'utf8')) as T) : null);

// Verde só com o job inteiro em success E a conferência de digest e as specs em success; qualquer outro desfecho
// sem causa reconhecida (checkout, pulo, timeout) é `ambiente`.
export function decidirFechamento(a: { cancelado: boolean; desfechos: Desfechos }): { tipo: 'cancelled' } | { tipo: 'causa'; causa: Causa | null } {
  if (a.cancelado) return { tipo: 'cancelled' };
  const d = a.desfechos;
  if (d.job === 'success' && d.assinatura === 'success' && d.digest === 'success' && d.spec === 'success') return { tipo: 'causa', causa: null };
  if (d.assinatura === 'failure') return { tipo: 'causa', causa: 'assinatura' };
  if (d.digest === 'failure') return { tipo: 'causa', causa: 'digest' };
  if (d.spec === 'failure') return { tipo: 'causa', causa: 'spec' };
  return { tipo: 'causa', causa: 'ambiente' };
}

// O check só é tocado se for o NOSSO, do head validado e ainda em andamento. Devolve o motivo da recusa.
export function checkConfere(c: { name: string; head_sha: string; status: string; app?: { id: number } | null }, headSha: string, appId: number): string | null {
  if (c.name !== 'E2E do brabo-qa') return `nome inesperado: ${c.name}`;
  if (c.head_sha !== headSha) return 'head_sha diferente do validado';
  if (c.status !== 'in_progress') return `status inesperado: ${c.status}`;
  if (c.app?.id !== appId) return 'o check não pertence ao nosso App';
  return null;
}

function specsQueFalharam(): string[] {
  type No = { file?: string; title?: string; specs?: { title: string; ok: boolean; file?: string }[]; suites?: No[] };
  const rel = lerJson<No>(`${process.env.E2E_DIR ?? 'e2e'}/resultado.json`);
  const falhas: string[] = [];
  const andar = (n: No) => {
    for (const s of n.specs ?? []) if (!s.ok) falhas.push(`${s.file ?? n.file ?? ''} › ${s.title}`);
    n.suites?.forEach(andar);
  };
  if (rel) andar(rel);
  return falhas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  // Import dinâmico: o `.brabo-ci` só existe no checkout do workflow, não no typecheck do PR.
  const { montarCheck } = await import(new URL('../../.brabo-ci/scripts/ci/qa-e2e-resumo.ts', import.meta.url).href);
  const o = (k: string) => (env[k] ?? '') as Desfecho;
  const decisao = decidirFechamento({
    cancelado: env.CANCELADO === 'true',
    desfechos: { job: o('JOB'), assinatura: o('ASSINATURA'), digest: o('DIGEST'), spec: o('SPEC') },
  });
  const causa = decisao.tipo === 'causa' ? decisao.causa : null;
  const cancelado = decisao.tipo === 'cancelled';
  const { REPOS } = await import('./validar-payload.ts');
  const repo = (env.REPO ?? env.RAW_REPO ?? '').replace(/^viralabs-dev\//, '');
  const checkId = env.CHECK_RUN_ID || env.RAW_CHECK_RUN_ID || '';
  if (!REPOS.includes(repo) || !/^[0-9]+$/.test(checkId)) throw new Error('repo/check_run_id inválidos: nada a fechar');
  const api = `https://api.github.com/repos/viralabs-dev/${repo}/check-runs/${checkId}`;
  const cab = { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' };
  const atual = (await (await fetch(api, { headers: cab })).json()) as Parameters<typeof checkConfere>[0];
  const recusa = checkConfere(atual, env.HEAD_SHA ?? env.RAW_HEAD_SHA ?? '', Number(env.APP_ID));
  if (recusa) throw new Error(`check não tocado: ${recusa}`);
  const esperado = (lerJson<Record<Servico, string>>('digests.json') ?? {}) as Record<Servico, string>;
  const imagens = JSON.parse(env.IMAGENS ?? env.RAW_IMAGENS ?? '{}') as Record<Servico, string>;
  const assinaturas = lerJson<Record<Servico, 'ok' | 'falhou'>>('assinaturas.json') ?? ({} as Record<Servico, 'ok' | 'falhou'>);
  const conferencia = lerJson<{ linhas: LinhaDigest[] }>('conferencia.json');
  const linhas: LinhaDigest[] = (Object.keys(imagens) as Servico[]).map((servico) => ({
    servico,
    esperado: esperado[servico] ?? imagens[servico]!,
    encontrado: conferencia?.linhas.find((l) => l.servico === servico)?.encontrado ?? null,
    assinatura: assinaturas[servico] ?? 'não conferida',
  }));
  const urlDoRun = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const c = cancelado
    ? { conclusion: 'cancelled', title: 'E2E cancelado', summary: `Run cancelado (nova execução para o mesmo PR ou cancelamento manual): ${urlDoRun}`, external_id: 'causa:' }
    : montarCheck({ causa, linhas, specsQueFalharam: causa === 'spec' ? specsQueFalharam() : [], urlDoRun });
  const res = await fetch(api, {
    method: 'PATCH',
    headers: cab,
    body: JSON.stringify({ status: 'completed', conclusion: c.conclusion, external_id: c.external_id, output: { title: c.title, summary: c.summary } }),
  });
  if (!res.ok) throw new Error(`falha ao fechar o check: ${res.status} ${await res.text()}`);
  console.log(`check ${checkId} fechado: ${c.conclusion} (${c.title})`);
}
