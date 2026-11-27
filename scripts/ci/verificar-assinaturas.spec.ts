import { describe, expect, it } from 'vitest';
import { SERVICOS, verificarAssinaturas, type Cosign } from './verificar-assinaturas.ts';

const digests = Object.fromEntries(SERVICOS.map((s) => [s, `ghcr.io/x/${s}@sha256:${'a'.repeat(64)}`]));
const SEM = { ok: false, saida: 'Error: no signatures found' };
const OK = { ok: true, saida: '' };

const rodar = (cosign: Cosign) => {
  let dormiu = 0;
  const p = verificarAssinaturas(digests, cosign, { intervaloMs: 15_000, limiteMs: 600_000, dormir: async () => void dormiu++ });
  return p.then((r) => ({ r, dormiu }));
};

describe('verificarAssinaturas', () => {
  it('espera o `no signatures found` e passa quando a assinatura aparece', async () => {
    const vezes: Record<string, number> = {};
    const { r, dormiu } = await rodar((ref) => ((vezes[ref] = (vezes[ref] ?? 0) + 1) <= 2 ? SEM : OK));
    expect(Object.values(r)).toEqual(SERVICOS.map(() => 'ok'));
    expect(dormiu).toBe(SERVICOS.length * 2);
  });

  it('identidade errada reprova na primeira tentativa, sem dormir', async () => {
    let chamadas = 0;
    const { r, dormiu } = await rodar(() => (chamadas++, { ok: false, saida: 'Error: none of the expected identities matched what was in the certificate' }));
    expect(Object.values(r)).toEqual(SERVICOS.map(() => 'falhou'));
    expect(chamadas).toBe(SERVICOS.length);
    expect(dormiu).toBe(0);
  });

  it('sem assinatura até o teto: falhou depois de 40 tentativas', async () => {
    let chamadas = 0;
    const { r } = await rodar(() => (chamadas++, SEM));
    expect(Object.values(r)).toEqual(SERVICOS.map(() => 'falhou'));
    expect(chamadas).toBe(SERVICOS.length * 40);
  });

  it('um serviço falho não esconde os outros', async () => {
    const { r } = await rodar((ref) => (ref.includes('/web@') ? { ok: false, saida: 'Error: outro' } : OK));
    expect(r).toMatchObject({ api: 'ok', web: 'falhou', backup: 'ok' });
  });
});
