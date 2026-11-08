import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deveCapturar, maiorMenor, TETO_DO_PNG, validarArtefato, type Entrada } from './capturas.ts';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);
const entrada = (arquivo: string, extra: Partial<Entrada> = {}): Entrada => ({
  arquivo, tela: 'Lista de projetos', tema: 'claro', web: 'v1.2.1', api: 'v2.2.0-dev.21', engine: 'v2.1.0', data: '2026-11-08', ...extra,
});
function artefato(entradas: Entrada[], arquivos: Record<string, Buffer>): string {
  const pasta = mkdtempSync(join(tmpdir(), 'capturas-'));
  writeFileSync(join(pasta, 'capturas.json'), JSON.stringify(entradas));
  for (const [n, c] of Object.entries(arquivos)) writeFileSync(join(pasta, n), c);
  return pasta;
}

describe('decidir', () => {
  it('lê MAJOR.MINOR de release e de -dev', () => {
    expect(maiorMenor('v1.2.1')).toBe('1.2');
    expect(maiorMenor('v2.2.0-dev.21')).toBe('2.2');
    expect(maiorMenor('main')).toBeNull();
  });
  it('segue sem manifesto e quando o MINOR muda; para quando só o PATCH muda', () => {
    expect(deveCapturar('v1.2.1', null)).toBe(true);
    expect(deveCapturar('v1.3.0', [{ web: 'v1.2.9' }])).toBe(true);
    expect(deveCapturar('v1.2.4', [{ web: 'v1.2.1' }])).toBe(false);
  });
  it('recusa pin que não é tag', () => {
    expect(() => deveCapturar('dev', null)).toThrow(/não é uma tag/);
  });
});

describe('validarArtefato (a fronteira de confiança do publicar)', () => {
  it('aceita PNG nomeado no manifesto', () => {
    expect(validarArtefato(artefato([entrada('projetos-claro.png')], { 'projetos-claro.png': PNG }))).toEqual([]);
  });
  it('reprova arquivo fora do manifesto (um script, um PNG de mão)', () => {
    const p = validarArtefato(artefato([entrada('projetos-claro.png')], { 'projetos-claro.png': PNG, 'run.sh': Buffer.from('x') }));
    expect(p.join()).toMatch(/fora do manifesto: run\.sh/);
  });
  it('reprova nome com caminho, PNG falso, peso acima do teto e tag inválida', () => {
    expect(validarArtefato(artefato([entrada('../x-claro.png')], {})).join()).toMatch(/nome de arquivo inválido/);
    expect(validarArtefato(artefato([entrada('a-claro.png')], { 'a-claro.png': Buffer.from('GIF89a') })).join()).toMatch(/não é PNG/);
    expect(validarArtefato(artefato([entrada('a-claro.png')], { 'a-claro.png': Buffer.concat([PNG, Buffer.alloc(TETO_DO_PNG)]) })).join()).toMatch(/pesa mais/);
    expect(validarArtefato(artefato([entrada('a-claro.png', { api: 'latest' })], { 'a-claro.png': PNG })).join()).toMatch(/api não é uma tag/);
  });
  it('reprova manifesto que cita arquivo ausente e artefato sem manifesto', () => {
    expect(validarArtefato(artefato([entrada('a-claro.png')], {})).join()).toMatch(/cita a-claro\.png/);
    expect(validarArtefato(mkdtempSync(join(tmpdir(), 'capturas-')))).toEqual(['sem capturas.json']);
  });
});
