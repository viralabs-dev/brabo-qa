// Verifica com `cosign verify` a assinatura de cada digest do `digests.json` e grava `assinaturas.json` (ok|falhou por serviço).
// Só a AUSÊNCIA de assinatura (`no signatures found`) espera: o irmão pode ainda estar assinando a -dev.N recém-publicada (AT-1036,
// RN-1066). Identidade/emissor errado ou qualquer outra recusa reprova na hora: a verificação continua estrita (RN-524).
// Uso: node verificar-assinaturas.ts digests.json
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { aguardarDigest } from './aguardar-digest.ts';

export const SERVICOS = ['api', 'engine', 'web', 'broker', 'backup'];
const IDENTIDADE = '^https://github.com/viralabs-dev/brabo-(api|engine|web|broker|infra)/\\.github/workflows/(release|ci)\\.yml@';
const EMISSOR = 'https://token.actions.githubusercontent.com';

export type Cosign = (ref: string) => { ok: boolean; saida: string };

const cosignReal: Cosign = (ref) => {
  const r = spawnSync('cosign', ['verify', ref, '--certificate-identity-regexp', IDENTIDADE, '--certificate-oidc-issuer', EMISSOR], { encoding: 'utf8' });
  return { ok: r.status === 0, saida: `${r.stdout}${r.stderr}${r.error ?? ''}` };
};

export async function verificarAssinaturas(
  digests: Record<string, string>,
  cosign: Cosign,
  opcoes: { intervaloMs: number; limiteMs: number; dormir: (ms: number) => Promise<void> },
  log: (m: string) => void = () => {},
): Promise<Record<string, 'ok' | 'falhou'>> {
  const resultado: Record<string, 'ok' | 'falhou'> = {};
  await Promise.all(
    SERVICOS.map(async (s) => {
      const ref = digests[s]!;
      let esperou = false;
      const t0 = Date.now();
      const resolver = async (r: string): Promise<string | null> => {
        const { ok, saida } = cosign(r);
        if (ok) return r;
        if (!/no signatures found/.test(saida)) throw new Error(saida.trim()); // não é transitório: reprova na hora
        if (!esperou) log(`${s}: sem assinatura ainda, esperando (até ${opcoes.limiteMs / 60_000} min)`);
        esperou = true;
        return null;
      };
      try {
        await aguardarDigest(ref, resolver, opcoes);
        if (esperou) log(`${s}: assinatura apareceu em ${Math.round((Date.now() - t0) / 1000)} s`);
        resultado[s] = 'ok';
      } catch (e) {
        log(`${s}: ${String(e).split('\n')[0]}`);
        resultado[s] = 'falhou';
      }
    }),
  );
  return resultado;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const digests = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Record<string, string>;
  // Teto de 10 min a cada 15 s: os mesmos números de `brabo-ci:scripts/ci/qa-e2e-espera.ts` (RN-1066).
  const r = await verificarAssinaturas(digests, cosignReal, { intervaloMs: 15_000, limiteMs: 600_000, dormir: (ms) => new Promise((x) => setTimeout(x, ms)) }, console.log);
  writeFileSync('assinaturas.json', JSON.stringify(r, null, 2));
  process.exit(Object.values(r).includes('falhou') ? 1 : 0);
}
