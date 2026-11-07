import { describe, expect, it } from 'vitest';
import { envDaOrigem, validarPayload } from './validar-payload.ts';

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

  describe('origem (AT-773)', () => {
    const origem = () => ({ run_id: '123', run_attempt: '2', ator: 'daneiel', sha_curto: 'a1b2c3d', correlacao: '123-2' });
    it('payload sem origem continua válido', () => expect(validarPayload(base()).ok).toBe(true));
    it('aceita a origem completa, inclusive ator bot', () => {
      expect(validarPayload({ ...base(), origem: origem() }).ok).toBe(true);
      expect(validarPayload({ ...base(), origem: { ...origem(), ator: 'dependabot[bot]' } }).ok).toBe(true);
    });
    it('recusa cada campo malformado e origem nula', () => {
      for (const ruim of [{ run_id: 'x' }, { run_attempt: '1;x' }, { ator: 'a\nB=1' }, { ator: 'a b' }, { sha_curto: 'XYZ' }, { sha_curto: 'abc' }, { correlacao: '123' }, { correlacao: '1-2\nX=1' }])
        expect(validarPayload({ ...base(), origem: { ...origem(), ...ruim } }).ok, JSON.stringify(ruim)).toBe(false);
      expect(validarPayload({ ...base(), origem: null as never }).ok).toBe(false);
    });
    it('envDaOrigem vazio sem origem; com origem gera o JSON da action', () => {
      expect(envDaOrigem('brabo-api', base())).toEqual([]);
      const l = envDaOrigem('brabo-api', { ...base(), origem: origem() });
      expect(l).toContain('ORIGEM_CORRELACAO=123-2');
      const json = JSON.parse(l.find((x) => x.startsWith('ORIGEM_JSON='))!.slice(12));
      expect(json).toMatchObject({ repo: 'viralabs-dev/brabo-api', pr: '12', ator: 'daneiel', run_url: 'https://github.com/viralabs-dev/brabo-api/actions/runs/123' });
      expect(l.every((x) => !x.slice(x.indexOf('=')).includes('\n'))).toBe(true);
    });
  });
});
