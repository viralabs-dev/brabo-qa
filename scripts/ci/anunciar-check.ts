// Anuncia o run do brabo-qa no check da PR assim que ele começa (AT-773): `details_url` e resumo passam a apontar para cá,
// em vez de ficar no run do gatilho até o `fechar`. Mesmo molde e mesmas recusas do `fechar-check.ts`; o check segue `in_progress`.
// Nunca reprova: o job é `continue-on-error` e qualquer recusa só avisa.
import { readFileSync } from 'node:fs';
import { NOME_DO_REGRESSIVO, anexarVinculos, checkConfere } from './fechar-check.ts';

export function montarAnuncio(nomeDoCheck: string, urlDoRun: string, vinculos?: string): { title: string; summary: string } {
  return {
    title: nomeDoCheck === NOME_DO_REGRESSIVO ? 'Regressivo rodando no brabo-qa' : 'E2E rodando no brabo-qa',
    summary: anexarVinculos(`Rodando no brabo-qa: ${urlDoRun}`, vinculos),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  const { REPOS } = await import('./validar-payload.ts');
  const repo = (env.RAW_REPO ?? '').replace(/^viralabs-dev\//, '');
  const checkId = env.RAW_CHECK_RUN_ID ?? '';
  const headSha = env.RAW_HEAD_SHA ?? '';
  if (!REPOS.includes(repo) || !/^[0-9]+$/.test(checkId) || !/^[0-9a-f]{40}$/.test(headSha) || !env.GH_TOKEN) {
    console.log('::warning::anunciar: payload ou token inválidos, o check não foi tocado');
    process.exit(0);
  }
  const api = `https://api.github.com/repos/viralabs-dev/${repo}/check-runs/${checkId}`;
  const cab = { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' };
  const atual = (await (await fetch(api, { headers: cab })).json()) as Parameters<typeof checkConfere>[0];
  const recusa = checkConfere(atual, headSha, Number(env.APP_ID));
  if (recusa) {
    console.log(`::warning::anunciar: check não tocado: ${recusa}`);
    process.exit(0);
  }
  let vinculos: string | undefined;
  try { vinculos = env.VINCULOS_MD ? readFileSync(env.VINCULOS_MD, 'utf8') : undefined; } catch { /* os vínculos nunca impedem o anúncio */ }
  const urlDoRun = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const res = await fetch(api, { method: 'PATCH', headers: cab, body: JSON.stringify({ details_url: urlDoRun, output: montarAnuncio(atual.name, urlDoRun, vinculos) }) });
  console.log(res.ok ? `check ${checkId} aponta para ${urlDoRun}` : `::warning::anunciar: PATCH recusado (${res.status})`);
}
