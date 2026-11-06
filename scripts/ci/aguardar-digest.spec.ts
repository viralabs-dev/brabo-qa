import { describe, expect, it } from 'vitest';
import { aguardarDigest, ImagemNaoPublicada } from './aguardar-digest.ts';

describe('aguardarDigest', () => {
  it('resolve quando a imagem aparece depois de um 404', async () => {
    const respostas = [false, true];
    let dormiu = 0;
    await aguardarDigest('img:tag', async () => respostas.shift()!, {
      intervaloMs: 30_000,
      limiteMs: 1_800_000,
      dormir: async () => void dormiu++,
    });
    expect(dormiu).toBe(1);
  });

  it('rejeita com ImagemNaoPublicada depois de 60 tentativas', async () => {
    let tentativas = 0;
    const p = aguardarDigest(
      'img:tag',
      async () => (tentativas++, false),
      { intervaloMs: 30_000, limiteMs: 1_800_000, dormir: async () => {} },
    );
    await expect(p).rejects.toBeInstanceOf(ImagemNaoPublicada);
    expect(tentativas).toBe(60);
  });
});
