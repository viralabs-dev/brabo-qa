import { describe, expect, it } from 'vitest';
import { envDaOrigem, validarOrigem, validarPayload } from './validar-payload.ts';

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
    // Saída REAL do montarPayload da ci#16 (brabo-ci, feature/vinculos-na-origem), com e sem PR.
    const sha = 'a'.repeat(40);
    const real = {
      repo: 'brabo-api', pr: 12, sha, sha_curto: sha.slice(0, 7), ator: 'daneiel', run_id: '123', run_attempt: '2',
      run_url: 'https://github.com/viralabs-dev/brabo-api/actions/runs/123', correlacao: '123-2',
    };
    const semPr = (() => { const { pr: _pr, ...r } = real; return r; })();
    const origem = () => ({ ...real, pr: '12' });

    it('payload sem origem continua válido e não exporta nada', () => {
      expect(validarPayload(base()).ok).toBe(true);
      expect(validarOrigem(undefined)).toEqual({ origem: null, avisos: [] });
      expect(envDaOrigem('brabo-api', base(), null)).toEqual([]);
    });
    it('aceita a saída real do montarPayload com PR', () => {
      const r = validarOrigem(real);
      expect(r.avisos).toEqual([]);
      const l = envDaOrigem('brabo-api', base(), r.origem);
      expect(l).toContain('ORIGEM_CORRELACAO=123-2');
      expect(JSON.parse(l.find((x) => x.startsWith('ORIGEM_JSON='))!.slice(12))).toEqual({
        repo: 'viralabs-dev/brabo-api', pr: '12', sha, ator: 'daneiel', evento: 'pull_request', run_url: real.run_url,
      });
    });
    it('aceita sem PR (pr ausente ou nulo) e o JSON não leva pr', () => {
      for (const o of [semPr, { ...semPr, pr: null }]) {
        const r = validarOrigem(o);
        expect(r.origem).not.toBeNull();
        const l = envDaOrigem('brabo-api', base(), r.origem);
        expect(JSON.parse(l.find((x) => x.startsWith('ORIGEM_JSON='))!.slice(12))).not.toHaveProperty('pr');
      }
    });
    it('aceita campo extra e ator bot', () => {
      expect(validarOrigem({ ...real, novo: 'x', ator: 'dependabot[bot]' }).origem).not.toBeNull();
    });
    it('origem inválida NÃO reprova o payload: é descartada com aviso e nada é exportado', () => {
      for (const ruim of [{ run_id: 'x' }, { run_attempt: '1;x' }, { ator: 'a\nB=1' }, { ator: 'a b' }, { sha_curto: 'XYZ' }, { correlacao: '123' }, { correlacao: '1-2\nX=1' }, { run_url: 'https://evil.com/x' }, { pr: '1;x' }, { run_id: undefined }]) {
        const r = validarOrigem({ ...origem(), ...ruim });
        expect(r.origem, JSON.stringify(ruim)).toBeNull();
        expect(r.avisos.length).toBeGreaterThan(0);
        expect(envDaOrigem('brabo-api', base(), r.origem)).toEqual([]);
        expect(validarPayload({ ...base(), origem: { ...origem(), ...ruim } }).ok).toBe(true);
      }
      for (const naoObjeto of [null, 'x', 5, []]) expect(validarOrigem(naoObjeto).origem).toBeNull();
    });
    it('nenhuma linha exportada tem quebra de linha', () => {
      expect(envDaOrigem('brabo-api', base(), validarOrigem(real).origem).every((x) => !x.includes('\n'))).toBe(true);
    });
  });
});
