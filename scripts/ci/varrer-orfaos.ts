// Fecha como vermelho (causa `sem-resposta`) o check `E2E do brabo-qa` em andamento há mais de 90 min (AT-765).
// Lista os checks dos PRs abertos para a `main` nos 6 repos do portão. Uso: GH_TOKEN=... node varrer-orfaos.ts
import { execFileSync } from 'node:child_process';

export function orfaos(
  checks: { id: number; status: string; startedAt: string }[],
  agora: Date,
  limiteMin = 90,
): number[] {
  return checks
    .filter((c) => c.status === 'in_progress' && agora.getTime() - Date.parse(c.startedAt) > limiteMin * 60_000)
    .map((c) => c.id);
}

const REPOS = ['brabo-api', 'brabo-engine', 'brabo-web', 'brabo-broker', 'brabo-infra', 'brabo-qa'];
const NOME_DO_CHECK = 'E2E do brabo-qa';

const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8' });
const json = <T>(...args: string[]) => JSON.parse(gh('api', ...args)) as T;

if (import.meta.url === `file://${process.argv[1]}`) {
  // O fechamento reutiliza o `montarCheck` do brabo-ci (checkout em .brabo-ci).
  const { montarCheck } = await import(new URL('../../.brabo-ci/scripts/ci/qa-e2e-resumo.ts', import.meta.url).href);
  const urlDoRun = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  for (const repo of REPOS) {
    const prs = json<{ head: { sha: string } }[]>(`repos/viralabs-dev/${repo}/pulls?state=open&base=main&per_page=100`);
    for (const pr of prs) {
      const { check_runs } = json<{ check_runs: { id: number; name: string; status: string; started_at: string }[] }>(
        `repos/viralabs-dev/${repo}/commits/${pr.head.sha}/check-runs?check_name=${encodeURIComponent(NOME_DO_CHECK)}`,
      );
      const ids = orfaos(check_runs.map((c) => ({ id: c.id, status: c.status, startedAt: c.started_at })), new Date());
      for (const id of ids) {
        const c = montarCheck({ causa: 'sem-resposta', linhas: [], specsQueFalharam: [], urlDoRun });
        gh('api', '-X', 'PATCH', `repos/viralabs-dev/${repo}/check-runs/${id}`,
          '-f', 'status=completed', '-f', `conclusion=${c.conclusion}`, '-f', `output[title]=${c.title}`,
          '-f', `output[summary]=${c.summary}`, '-f', `external_id=${c.external_id}`);
        console.log(`órfão fechado: ${repo} check ${id}`);
      }
    }
  }
}
