import { describe, expect, it } from 'vitest';
import { envDaOrigem, grepDe, validarModo, validarMotivos, validarOrigem, validarPayload } from './validar-payload.ts';

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

describe('modo e funcionalidades (AT-769)', () => {
  it('sem modo é o completo: o payload do portão da main segue válido e idêntico', () => {
    expect(validarPayload(base()).ok).toBe(true);
    for (const v of [undefined, null, '', 'null']) expect(validarModo(v, undefined)).toEqual({ modo: 'completo', ids: [], erros: [] });
  });
  it('funcionalidades vem como array, JSON ou lista com vírgula', () => {
    expect(validarModo('funcionalidades', ['a', 'b-c']).ids).toEqual(['a', 'b-c']);
    expect(validarModo('funcionalidades', '["a","b"]').ids).toEqual(['a', 'b']);
    expect(validarModo('funcionalidades', 'a, b-c').ids).toEqual(['a', 'b-c']);
    expect(validarModo('funcionalidades', ['a', 'a']).ids).toEqual(['a']);
  });
  it('recusa modo desconhecido, id fora de kebab, mais de 50 e modo funcionalidades vazio', () => {
    expect(validarModo('nenhum', undefined).erros).not.toEqual([]);
    expect(validarModo('funcionalidades', ['A']).erros).not.toEqual([]);
    expect(validarModo('funcionalidades', ['a;rm']).erros).not.toEqual([]);
    expect(validarModo('funcionalidades', ['a\nEVIL=1']).erros).not.toEqual([]);
    expect(validarModo('funcionalidades', Array.from({ length: 51 }, (_, i) => `f${i}`)).erros).not.toEqual([]);
    expect(validarModo('funcionalidades', undefined).erros).not.toEqual([]);
    expect(validarModo('funcionalidades', '[nao json').erros).not.toEqual([]);
  });
  it('validarPayload reprova pelo modo', () => {
    expect(validarPayload({ ...base(), modo: 'funcionalidades', funcionalidades: ['autenticacao'] }).ok).toBe(true);
    expect(validarPayload({ ...base(), modo: 'funcionalidades' }).ok).toBe(false);
    expect(validarPayload({ ...base(), modo: 'x' }).ok).toBe(false);
  });
  it('o grep casa a tag inteira, não o prefixo de outra', () => {
    const re = new RegExp(grepDe(['aprovacoes', 'git']));
    expect(re.test('um teste @f-aprovacoes')).toBe(true);
    expect(re.test('um teste @f-git @x')).toBe(true);
    expect(re.test('um teste @f-git-hub')).toBe(false);
    expect(re.test('um teste @f-aprovacoes-extra')).toBe(false);
  });
});

describe('validarMotivos', () => {
  it('ausente ou nulo: vazio, sem aviso (qa antigo e ci novo convivem)', () => {
    expect(validarMotivos(undefined, undefined)).toEqual({ motivos: {}, semDono: [], avisos: [] });
    expect(validarMotivos('null', 'null')).toEqual({ motivos: {}, semDono: [], avisos: [] });
  });
  it('limita: 50 ids kebab, 5 caminhos de 200 caracteres, sem controle; semDono até 20', () => {
    const m = Object.fromEntries([...Array.from({ length: 60 }, (_, i) => [`f-${i}`, ['a']]), ['Mau Id', ['x']]]);
    expect(Object.keys(validarMotivos(m, undefined).motivos)).toHaveLength(50);
    const r = validarMotivos({ autenticacao: Array.from({ length: 9 }, () => `${'x'.repeat(300)}\nEVIL=1`) }, Array.from({ length: 30 }, () => 'p'));
    expect(r.motivos.autenticacao).toHaveLength(5);
    expect(r.motivos.autenticacao![0]).toHaveLength(200);
    expect(r.motivos.autenticacao![0]).not.toContain('\n');
    expect(r.semDono).toHaveLength(20);
  });
  it('aceita JSON em texto (env do workflow) e avisa quando não é objeto', () => {
    expect(validarMotivos('{"a":["src/x.ts"]}', '["foo/bar"]')).toMatchObject({ motivos: { a: ['src/x.ts'] }, semDono: ['foo/bar'] });
    expect(validarMotivos('[1]', undefined).avisos).toHaveLength(1);
  });
  it('tocadas: só ids kebab, sem repetir; ausente continua ausente', () => {
    expect(validarMotivos(undefined, undefined, undefined).tocadas).toBeUndefined();
    expect(validarMotivos(undefined, undefined, '["a","a","Mau Id",3,"b"]').tocadas).toEqual(['a', 'b']);
  });
  it('nunca reprova o payload', () => expect(validarPayload({ ...base(), motivos: 'lixo', semDono: 7 } as never).ok).toBe(true));
  it('selecao agrupa as três chaves; as soltas continuam valendo; juntas, vale selecao', () => {
    const nova = { motivos: { a: ['x.ts'] }, semDono: ['s'], tocadas: ['a'] };
    const solta = validarMotivos({ b: ['y.ts'] }, ['t'], ['b']);
    expect(validarMotivos(undefined, undefined, undefined, nova)).toMatchObject({ motivos: { a: ['x.ts'] }, semDono: ['s'], tocadas: ['a'] });
    expect(validarMotivos(undefined, undefined, undefined, JSON.stringify(nova)).tocadas).toEqual(['a']);
    expect(solta).toMatchObject({ motivos: { b: ['y.ts'] }, semDono: ['t'], tocadas: ['b'] });
    expect(validarMotivos({ b: ['y.ts'] }, ['t'], ['b'], nova)).toMatchObject({ motivos: { a: ['x.ts'] }, semDono: ['s'], tocadas: ['a'] });
    expect(validarMotivos({ b: ['y.ts'] }, ['t'], ['b'], 'null').tocadas).toEqual(['b']);
  });
});
