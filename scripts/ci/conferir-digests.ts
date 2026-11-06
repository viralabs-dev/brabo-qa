// Confere, depois do `compose up`, que o container de cada serviço roda a imagem do digest esperado (AT-765).
// Uso: node conferir-digests.ts <digests.json>  (usa `docker compose ps` e `docker inspect` do diretório corrente).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Servico = 'api' | 'engine' | 'web' | 'broker' | 'backup';

// Mesmo formato do `LinhaDigest` do brabo-ci (qa-e2e-resumo.ts).
export interface LinhaDigest {
  servico: Servico;
  esperado: string;
  encontrado: string | null;
  assinatura: 'ok' | 'falhou' | 'não conferida';
}

export interface Inspecao {
  servico: Servico;
  repoDigests: string[];
}

export function conferirDigests(
  esperado: Record<Servico, string>,
  inspecoes: Inspecao[],
): { ok: boolean; linhas: LinhaDigest[] } {
  const linhas = (Object.keys(esperado) as Servico[]).map((servico): LinhaDigest => {
    const digests = inspecoes.find((i) => i.servico === servico)?.repoDigests ?? [];
    // Imagem retagueada pode ter mais de um RepoDigest: vale se ALGUM for o esperado; lista vazia = build local.
    const encontrado = digests.includes(esperado[servico]) ? esperado[servico] : (digests[0] ?? null);
    return { servico, esperado: esperado[servico], encontrado, assinatura: 'não conferida' };
  });
  return { ok: linhas.every((l) => l.encontrado === l.esperado), linhas };
}

function inspecionar(servico: Servico): Inspecao {
  const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  const cid = sh('docker', ['compose', '-f', 'docker/docker-compose.install.yml', '--profile', 'container-broker', '--profile', 'backup', 'ps', '-a', '-q', servico]).split('\n')[0];
  if (!cid) return { servico, repoDigests: [] };
  const imagem = sh('docker', ['inspect', '--format', '{{.Image}}', cid]);
  return { servico, repoDigests: JSON.parse(sh('docker', ['inspect', '--format', '{{json .RepoDigests}}', imagem])) as string[] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arquivo = process.argv[2]!;
  const esperado = JSON.parse(readFileSync(arquivo, 'utf8')) as Record<Servico, string>;
  const r = conferirDigests(esperado, (Object.keys(esperado) as Servico[]).map(inspecionar));
  writeFileSync(join(dirname(arquivo), 'conferencia.json'), JSON.stringify(r, null, 2));
  for (const l of r.linhas) console.log(`${l.encontrado === l.esperado ? 'ok ' : 'DIVERGE'} ${l.servico} esperado=${l.esperado} encontrado=${l.encontrado}`);
  process.exit(r.ok ? 0 : 1);
}
