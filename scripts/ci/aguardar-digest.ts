// Espera cada imagem existir no GHCR (a tag -dev.N pode ainda estar sendo carimbada quando a PR abre) e a
// resolve para `repo@sha256:...`. Uso: IMAGENS='{"api":"ghcr.io/...:tag",...}' node aguardar-digest.ts digests.json (AT-765).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export class ImagemNaoPublicada extends Error {
  constructor(ref: string) {
    super(`imagem ainda não publicada: ${ref}`);
    this.name = 'ImagemNaoPublicada';
  }
}

export async function aguardarDigest(
  ref: string,
  existe: (ref: string) => Promise<boolean>,
  opcoes: { intervaloMs: number; limiteMs: number; dormir: (ms: number) => Promise<void> } = {
    intervaloMs: 30_000,
    limiteMs: 1_800_000,
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
  },
): Promise<void> {
  const tentativas = Math.floor(opcoes.limiteMs / opcoes.intervaloMs);
  for (let i = 0; i < tentativas; i++) {
    if (await existe(ref)) return;
    if (i < tentativas - 1) await opcoes.dormir(opcoes.intervaloMs);
  }
  throw new ImagemNaoPublicada(ref);
}

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const existeNoGhcr = async (ref: string) => {
  try {
    docker('buildx', 'imagetools', 'inspect', ref);
    return true;
  } catch {
    return false;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const imagens = JSON.parse(process.env.IMAGENS ?? '{}') as Record<string, string>;
  const digests: Record<string, string> = {};
  try {
    await Promise.all(
      Object.entries(imagens).map(async ([servico, ref]) => {
        await aguardarDigest(ref, existeNoGhcr);
        const nome = ref.split('@')[0]!.replace(/:[^/:]+$/, '');
        const digest = ref.includes('@') ? ref.split('@')[1]! : docker('buildx', 'imagetools', 'inspect', ref, '--format', '{{.Manifest.Digest}}');
        digests[servico] = `${nome}@${digest}`;
      }),
    );
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
  writeFileSync(process.argv[2]!, JSON.stringify(digests, null, 2));
}
