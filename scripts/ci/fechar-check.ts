// Fecha o check `E2E do brabo-qa` na PR de origem (AT-765). Roda com `if: always()` no fim do e2e-pr.yml.
// O resumo vem do `montarCheck` do brabo-ci (checkout em `.brabo-ci`, repinar no merge da AT-765 Task 10).
import { existsSync, readFileSync } from 'node:fs';
import type { LinhaDigest } from './conferir-digests.ts';

type Servico = LinhaDigest['servico'];
type Causa = 'spec' | 'ambiente' | 'digest' | 'assinatura' | 'sem-resposta';
type Desfecho = 'success' | 'failure' | 'cancelled' | 'skipped' | '';

const lerJson = <T>(caminho: string): T | null => (existsSync(caminho) ? (JSON.parse(readFileSync(caminho, 'utf8')) as T) : null);

// Cada passo que falha para o job (os seguintes são pulados), então a PRIMEIRA falha é a causa.
export function causaDaFalha(d: { aguardar: Desfecho; assinatura: Desfecho; subir: Desfecho; digest: Desfecho; spec: Desfecho }): Causa | null {
  if (d.aguardar === 'failure' || d.subir === 'failure') return 'ambiente';
  if (d.assinatura === 'failure') return 'assinatura';
  if (d.digest === 'failure') return 'digest';
  if (d.spec === 'failure') return 'spec';
  return null;
}

function specsQueFalharam(): string[] {
  type No = { file?: string; title?: string; specs?: { title: string; ok: boolean; file?: string }[]; suites?: No[] };
  const rel = lerJson<No>('e2e/resultado.json');
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
  const cancelado = env.CANCELADO === 'true';
  const causa = causaDaFalha({ aguardar: o('AGUARDAR'), assinatura: o('ASSINATURA'), subir: o('SUBIR'), digest: o('DIGEST'), spec: o('SPEC') });
  const esperado = (lerJson<Record<Servico, string>>('digests.json') ?? {}) as Record<Servico, string>;
  const imagens = JSON.parse(env.IMAGENS ?? '{}') as Record<Servico, string>;
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
  const res = await fetch(`https://api.github.com/repos/viralabs-dev/${env.REPO}/check-runs/${env.CHECK_RUN_ID}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
    body: JSON.stringify({ status: 'completed', conclusion: c.conclusion, external_id: c.external_id, output: { title: c.title, summary: c.summary } }),
  });
  if (!res.ok) throw new Error(`falha ao fechar o check: ${res.status} ${await res.text()}`);
  console.log(`check ${env.CHECK_RUN_ID} fechado: ${c.conclusion} (${c.title})`);
}
