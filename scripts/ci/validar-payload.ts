// Valida o payload do e2e-pr (repository_dispatch ou workflow_dispatch) ANTES de qualquer uso em shell/URL (AT-765).
// Uso: lê as variáveis RAW_* do ambiente, escreve as validadas em $GITHUB_ENV e a saída `repo`; sai 1 se inválido.
import { appendFileSync } from 'node:fs';

export const REPOS = ['brabo-api', 'brabo-engine', 'brabo-web', 'brabo-broker', 'brabo-infra', 'brabo-qa'];
export const SERVICOS = ['api', 'engine', 'web', 'broker', 'backup'];

export interface Payload {
  repo: string;
  pr: string;
  head_sha: string;
  check_run_id: string;
  compose_ref: string;
  imagens: Record<string, string>;
}

const REF_DE_VERSAO = /^v[0-9]+\.[0-9]+\.[0-9]+(-dev\.[0-9]+)?$/;

export function validarPayload(p: Payload): { ok: true; repo: string } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const repo = String(p.repo ?? '').replace(/^viralabs-dev\//, '');
  if (!REPOS.includes(repo)) erros.push(`repo fora da lista: ${JSON.stringify(p.repo)}`);
  if (!/^[0-9]+$/.test(String(p.pr))) erros.push('pr não numérico');
  if (!/^[0-9]+$/.test(String(p.check_run_id))) erros.push('check_run_id não numérico');
  if (!/^[0-9a-f]{40}$/.test(String(p.head_sha))) erros.push('head_sha não é um SHA de 40 hex');
  if (!/^[0-9a-f]{40}$/.test(String(p.compose_ref)) && !REF_DE_VERSAO.test(String(p.compose_ref)))
    erros.push('compose_ref deve ser SHA de 40 hex ou tag vX.Y.Z[-dev.N]');
  for (const k of Object.keys(p.imagens ?? {})) if (!SERVICOS.includes(k)) erros.push(`chave desconhecida em imagens: ${JSON.stringify(k)}`);
  for (const s of SERVICOS) {
    const ref = p.imagens?.[s];
    const base = `ghcr\\.io/viralabs-dev/brabo-${s}`;
    const bom = typeof ref === 'string' &&
      (new RegExp(`^${base}:v[0-9]+\\.[0-9]+\\.[0-9]+(-dev\\.[0-9]+)?$`).test(ref) || new RegExp(`^${base}:sha-[0-9a-f]{12}$`).test(ref));
    if (!bom) erros.push(`imagem inválida para ${s}`);
  }
  return erros.length ? { ok: false, erros } : { ok: true, repo };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const e = process.env;
  let imagens: Record<string, string> = {};
  try { imagens = JSON.parse(e.RAW_IMAGENS ?? '{}'); } catch { /* validarPayload reprova as imagens */ }
  const p: Payload = { repo: e.RAW_REPO ?? '', pr: e.RAW_PR ?? '', head_sha: e.RAW_HEAD_SHA ?? '', check_run_id: e.RAW_CHECK_RUN_ID ?? '', compose_ref: e.RAW_COMPOSE_REF ?? '', imagens };
  const r = validarPayload(p);
  // O repo válido sai mesmo com o resto inválido: é o que deixa fechar o check como `ambiente`.
  const repoOk = REPOS.includes(p.repo.replace(/^viralabs-dev\//, '')) && /^[0-9]+$/.test(p.check_run_id);
  appendFileSync(process.env.GITHUB_OUTPUT!, `repo=${repoOk ? p.repo.replace(/^viralabs-dev\//, '') : ''}\n`);
  if (!r.ok) {
    console.error(r.erros.map((m) => `::error::${m}`).join('\n'));
    process.exit(1);
  }
  appendFileSync(process.env.GITHUB_ENV!, [
    `REPO=${r.repo}`, `PR=${p.pr}`, `HEAD_SHA=${p.head_sha}`, `CHECK_RUN_ID=${p.check_run_id}`, `COMPOSE_REF=${p.compose_ref}`,
    `IMAGENS=${JSON.stringify(imagens)}`, `E2E_DIR=${r.repo === 'brabo-qa' ? 'e2e-da-pr/e2e' : 'e2e'}`,
  ].join('\n') + '\n');
}
