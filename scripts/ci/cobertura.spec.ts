import { describe, expect, it } from 'vitest';
import { coberturaDe, idsAtivos, sanitizarCobertura } from './cobertura.ts';

const spec = (tags: string[], ok = true) => ({ title: 't', ok, tags });
const rel = (...specs: object[]) => ({ suites: [{ suites: [{ specs }], specs: [] }] });

describe('idsAtivos', () => {
  it('lê só as ativas, na ordem', () => {
    const y = ['funcionalidades:', '  - id: a', '    status: ativa', '  - id: b-c', '    status: aposentada', '  - id: d', '    nome: x', '    status: ativa'].join('\n');
    expect(idsAtivos(y)).toEqual(['a', 'd']);
  });
  it('o catálogo real tem 14 ativas', async () => {
    const { readFileSync } = await import('node:fs');
    expect(idsAtivos(readFileSync(new URL('../../funcionalidades.yml', import.meta.url), 'utf8'))).toHaveLength(14);
  });
});

describe('coberturaDe', () => {
  it('conta specs por tag, marca vermelho e "sem cobertura"', () => {
    const r = coberturaDe(rel(spec(['f-a']), spec(['f-a'], false), spec(['f-b', 'x'])), ['a', 'b', 'c']);
    expect(r).toEqual([
      { funcionalidade: 'a', specs: 2, resultado: 'vermelho' },
      { funcionalidade: 'b', specs: 1, resultado: 'verde' },
      { funcionalidade: 'c', specs: 0, resultado: 'sem cobertura' },
    ]);
  });
  it('aceita a tag com @ e não confunde f-a com f-a-b', () => {
    expect(coberturaDe(rel(spec(['@f-a-b'])), ['a', 'a-b'])!.map((l) => l.specs)).toEqual([0, 1]);
  });
  it('só lista os ids pedidos (modo funcionalidades)', () => {
    expect(coberturaDe(rel(spec(['f-a']), spec(['f-b'])), ['b'])).toEqual([{ funcionalidade: 'b', specs: 1, resultado: 'verde' }]);
  });
  it('sem resultado não há tabela (a suíte nem rodou)', () => {
    expect(coberturaDe(null, ['a'])).toBeNull();
    expect(coberturaDe('x', ['a'])).toBeNull();
  });
});

describe('sanitizarCobertura', () => {
  const ativos = ['a', 'b'];
  it('descarta o que não está no catálogo ou está malformado', () => {
    const r = sanitizarCobertura([{ funcionalidade: 'a', specs: 2, resultado: 'verde' }, { funcionalidade: 'x', specs: 1, resultado: 'verde' }, { funcionalidade: 'b', specs: -1 }, { funcionalidade: 'b\n| evil', specs: 1 }, null], ativos);
    expect(r).toEqual([{ funcionalidade: 'a', specs: 2, resultado: 'verde' }]);
  });
  it('zero specs sempre vira "sem cobertura" e resultado desconhecido vira verde só com specs', () => {
    expect(sanitizarCobertura([{ funcionalidade: 'a', specs: 0, resultado: 'verde' }], ativos)![0]!.resultado).toBe('sem cobertura');
    expect(sanitizarCobertura([{ funcionalidade: 'a', specs: 1, resultado: '<b>' }], ativos)![0]!.resultado).toBe('verde');
  });
  it('não-array ou vazio vira undefined', () => {
    expect(sanitizarCobertura(null, ativos)).toBeUndefined();
    expect(sanitizarCobertura([], ativos)).toBeUndefined();
  });
});
