import { describe, expect, it } from 'vitest';
import { montarAnuncio } from './anunciar-check.ts';

describe('montarAnuncio', () => {
  it('o resumo aponta para o run do brabo-qa e anexa os vínculos', () => {
    const a = montarAnuncio('E2E do brabo-qa', 'https://github.com/viralabs-dev/brabo-qa/actions/runs/9', '## Vínculos');
    expect(a.title).toBe('E2E rodando no brabo-qa');
    expect(a.summary).toBe('Rodando no brabo-qa: https://github.com/viralabs-dev/brabo-qa/actions/runs/9\n\n## Vínculos');
  });
  it('o regressivo da dev tem título próprio e sem vínculos o resumo é só o link', () => {
    const a = montarAnuncio('Regressivo do brabo-qa', 'https://x');
    expect(a.title).toBe('Regressivo rodando no brabo-qa');
    expect(a.summary).toBe('Rodando no brabo-qa: https://x');
  });
});
