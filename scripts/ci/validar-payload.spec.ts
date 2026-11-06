import { describe, expect, it } from 'vitest';
import { validarPayload } from './validar-payload.ts';

const img = (s: string, tag = 'v1.2.3-dev.4') => `ghcr.io/viralabs-dev/brabo-${s}:${tag}`;
const base = () => ({
  repo: 'viralabs-dev/brabo-api',
  pr: '12',
  head_sha: 'a'.repeat(40),
  check_run_id: '99',
  compose_ref: 'v1.0.0',
  imagens: Object.fromEntries(['api', 'engine', 'web', 'broker', 'backup'].map((s) => [s, img(s)])) as Record<string, string>,
});

describe('validarPayload', () => {
  it('aceita o payload válido e tira o prefixo do repo', () => {
    const r = validarPayload(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repo).toBe('brabo-api');
  });
  it('aceita repo sem prefixo, tag sha-, tag estável e compose_ref hex', () => {
    const p = { ...base(), repo: 'brabo-qa', compose_ref: 'b'.repeat(40) };
    p.imagens.web = img('web', 'sha-0123456789ab');
    p.imagens.api = img('api', 'v1.2.3');
    expect(validarPayload(p).ok).toBe(true);
  });
  it('recusa repo fora da lista', () => {
    expect(validarPayload({ ...base(), repo: 'viralabs-dev/brabo-contracts' }).ok).toBe(false);
    expect(validarPayload({ ...base(), repo: 'outro/brabo-api' }).ok).toBe(false);
  });
  it('recusa quebra de linha em imagens', () => {
    const p = base();
    p.imagens.api = `${img('api')}\nEVIL=1`;
    expect(validarPayload(p).ok).toBe(false);
    p.imagens.api = `${img('api')}\n`;
    expect(validarPayload(p).ok).toBe(false);
  });
  it('recusa ref começando com hífen e imagem de outro serviço', () => {
    const p = base();
    p.imagens.api = `-${img('api')}`;
    expect(validarPayload(p).ok).toBe(false);
    p.imagens.api = img('web');
    expect(validarPayload(p).ok).toBe(false);
  });
  it('recusa serviço faltando, pr/check_run_id não numéricos, sha curto e compose_ref solto', () => {
    const p = base();
    delete p.imagens.backup;
    expect(validarPayload(p).ok).toBe(false);
    expect(validarPayload({ ...base(), pr: '1;x' }).ok).toBe(false);
    expect(validarPayload({ ...base(), check_run_id: 'abc' }).ok).toBe(false);
    expect(validarPayload({ ...base(), head_sha: 'abc' }).ok).toBe(false);
    expect(validarPayload({ ...base(), compose_ref: 'dev' }).ok).toBe(false);
  });
  it('recusa chaves desconhecidas em imagens', () => {
    const p = base();
    p.imagens.extra = img('api');
    expect(validarPayload(p).ok).toBe(false);
  });
});
