import { describe, expect, it } from 'vitest';
import { aguardarDigest, ImagemNaoPublicada } from './aguardar-digest.ts';

const DIGEST = `ghcr.io/viralabs-dev/brabo-api@sha256:${'a'.repeat(64)}`;

describe('aguardarDigest', () => {
  it('resolve a tag para o digest quando a imagem aparece depois de um 404', async () => {
    const respostas = [null, DIGEST];
    let dormiu = 0;
    const d = await aguardarDigest('ghcr.io/viralabs-dev/brabo-api:v1.0.0-dev.3', async () => respostas.shift() ?? null, {
      intervaloMs: 30_000,
      limiteMs: 1_800_000,
      dormir: async () => void dormiu++,
    });
    expect(d).toBe(DIGEST);
    expect(dormiu).toBe(1);
  });

  it('rejeita com ImagemNaoPublicada depois de 60 tentativas', async () => {
    let tentativas = 0;
    const p = aguardarDigest('img:tag', async () => (tentativas++, null), {
      intervaloMs: 30_000,
      limiteMs: 1_800_000,
      dormir: async () => {},
    });
    await expect(p).rejects.toBeInstanceOf(ImagemNaoPublicada);
    expect(tentativas).toBe(60);
  });
});
