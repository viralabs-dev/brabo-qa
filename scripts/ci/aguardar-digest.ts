// Espera cada TAG existir no GHCR (a tag -dev.N pode ainda estar sendo carimbada quando a PR abre) e a
// resolve, uma vez, para `repo@sha256:...`. Uso: IMAGENS='{"api":"ghcr.io/...:tag",...}' node aguardar-digest.ts digests.json (AT-765).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export class ImagemNaoPublicada extends Error {
  constructor(ref: string) {
    super(`imagem ainda não publicada: ${ref}`);
    this.name = 'ImagemNaoPublicada';
  }
}

// `resolver` devolve `repo@sha256:...` quando a tag existe e null quando ainda não (404).
export async function aguardarDigest(
  ref: string,
  resolver: (ref: string) => Promise<string | null>,
  opcoes: { intervaloMs: number; limiteMs: number; dormir: (ms: number) => Promise<void> } = {
    intervaloMs: 30_000,
    limiteMs: 1_800_000,
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
): Promise<string> {
  const tentativas = Math.floor(opcoes.limiteMs / opcoes.intervaloMs);
  for (let i = 0; i < tentativas; i++) {
    const digest = await resolver(ref);
    if (digest) return digest;
    if (i < tentativas - 1) await opcoes.dormir(opcoes.intervaloMs);
  }
  throw new ImagemNaoPublicada(ref);
}

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
// Resolve a tag UMA vez: dali em diante (cosign, .env, conferência) só o digest vale.
const resolverNoGhcr = async (ref: string): Promise<string | null> => {
  try {
    const digest = docker('buildx', 'imagetools', 'inspect', ref, '--format', '{{.Manifest.Digest}}');
    return /^sha256:[0-9a-f]{64}$/.test(digest) ? `${ref.replace(/:[^/:]+$/, '')}@${digest}` : null;
  } catch {
    return null;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const imagens = JSON.parse(process.env.IMAGENS ?? '{}') as Record<string, string>;
  const digests: Record<string, string> = {};
  try {
    await Promise.all(
      Object.entries(imagens).map(async ([servico, ref]) => {
        digests[servico] = await aguardarDigest(ref, resolverNoGhcr);
      }),
    );
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
  writeFileSync(process.argv[2]!, JSON.stringify(digests, null, 2));
}
