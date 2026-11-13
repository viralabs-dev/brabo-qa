import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { deveCapturar, diferencas, LIMIAR, maiorMenor, TETO_DO_PNG, validarArtefato, validarVeredito, type Entrada } from './capturas.ts';

const PNG_FALSO = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);
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
  it('segue sem manifesto e quando a tag do web muda, PATCH incluso; para quando é a mesma (AT-878, d1)', () => {
    expect(deveCapturar('v1.2.1', null)).toBe(true);
    expect(deveCapturar('v1.3.0', [{ web: 'v1.2.9' }])).toBe(true);
    expect(deveCapturar('v1.2.4', [{ web: 'v1.2.1' }])).toBe(true);
    expect(deveCapturar('v1.2.1', [{ web: 'v1.2.1' }])).toBe(false);
  });
  it('recusa pin que não é tag', () => {
    expect(() => deveCapturar('dev', null)).toThrow(/não é uma tag/);
  });
});

describe('validarArtefato (a fronteira de confiança do publicar)', () => {
  it('aceita PNG nomeado no manifesto', () => {
    expect(validarArtefato(artefato([entrada('projetos-claro.png')], { 'projetos-claro.png': PNG_FALSO }))).toEqual([]);
  });
  it('reprova arquivo fora do manifesto (um script, um PNG de mão)', () => {
    const p = validarArtefato(artefato([entrada('projetos-claro.png')], { 'projetos-claro.png': PNG_FALSO, 'run.sh': Buffer.from('x') }));
    expect(p.join()).toMatch(/fora do manifesto: run\.sh/);
  });
  it('reprova nome com caminho, PNG falso, peso acima do teto e tag inválida', () => {
    expect(validarArtefato(artefato([entrada('../x-claro.png')], {})).join()).toMatch(/nome de arquivo inválido/);
    expect(validarArtefato(artefato([entrada('a-claro.png')], { 'a-claro.png': Buffer.from('GIF89a') })).join()).toMatch(/não é PNG/);
    expect(validarArtefato(artefato([entrada('a-claro.png')], { 'a-claro.png': Buffer.concat([PNG_FALSO, Buffer.alloc(TETO_DO_PNG)]) })).join()).toMatch(/pesa mais/);
    expect(validarArtefato(artefato([entrada('a-claro.png', { api: 'latest' })], { 'a-claro.png': PNG_FALSO })).join()).toMatch(/api não é uma tag/);
  });
  it('reprova manifesto que cita arquivo ausente e artefato sem manifesto', () => {
    expect(validarArtefato(artefato([entrada('a-claro.png')], {})).join()).toMatch(/cita a-claro\.png/);
    expect(validarArtefato(mkdtempSync(join(tmpdir(), 'capturas-')))).toEqual(['sem capturas.json']);
  });
});

/** PNG 1366×768 branco; ``n` escurece o primeiro n pixels. */
function png(pasta: string, nome: string, n = 0, largura = 1366): void {
  mkdirSync(pasta, { recursive: true });
  const p = new PNG({ width: largura, height: 768 });
  p.data.fill(255);
  for (let i = 0; i < n; i++) p.data.fill(0, i * 4, i * 4 + 3);
  writeFileSync(join(pasta, nome), PNG.sync.write(p));
}
const par = (): [string, string] => {
  const raiz = mkdtempSync(join(tmpdir(), 'dif-'));
  return [join(raiz, 'atual'), join(raiz, 'nova')];
};

describe('diferencas (o veredito versao | visual, AT-878)', () => {
  it('ruído medido (4 px) e imagem igual dão `versao`', async () => {
    const [a, n] = par();
    png(a, 'a-claro.png');
    png(n, 'a-claro.png', 4);
    expect(await diferencas(a, n)).toEqual({ veredito: 'versao', mudancas: [] });
  });
  it('uma faixa de 1% dá `visual` só com aquele PNG', async () => {
    const [a, n] = par();
    for (const d of [a, n]) png(d, 'ok-claro.png');
    png(a, 'muda-claro.png');
    png(n, 'muda-claro.png', Math.round(1366 * 768 * 0.01));
    const v = await diferencas(a, n);
    expect(v.veredito).toBe('visual');
    expect(v.mudancas.map((m) => m.arquivo)).toEqual(['muda-claro.png']);
    expect(v.mudancas[0]!.fracao).toBeGreaterThan(LIMIAR);
  });
  it('arquivo novo, removido ou de outro tamanho é mudança', async () => {
    const [a, n] = par();
    png(a, 'some-claro.png');
    png(a, 'tam-claro.png');
    png(n, 'tam-claro.png', 0, 1000);
    png(n, 'novo-claro.png');
    expect((await diferencas(a, n)).mudancas.map((m) => m.arquivo).sort()).toEqual(['novo-claro.png', 'some-claro.png', 'tam-claro.png']);
  });
});

describe('validarVeredito e o mudancas.json no artefato', () => {
  it('aceita os dois vereditos coerentes', () => {
    expect(validarVeredito({ veredito: 'versao', mudancas: [] })).toEqual([]);
    expect(validarVeredito({ veredito: 'visual', mudancas: [{ arquivo: 'a-claro.png', fracao: 0.01 }] })).toEqual([]);
  });
  it('reprova malformado, incoerente e nome com caminho', () => {
    expect(validarVeredito(null).join()).toMatch(/malformado/);
    expect(validarVeredito({ veredito: 'talvez', mudancas: [] }).join()).toMatch(/malformado/);
    expect(validarVeredito({ veredito: 'versao', mudancas: [{ arquivo: 'a-claro.png', fracao: 1 }] }).join()).toMatch(/incoerente/);
    expect(validarVeredito({ veredito: 'visual', mudancas: [] }).join()).toMatch(/incoerente/);
    expect(validarVeredito({ veredito: 'visual', mudancas: [{ arquivo: '../x-claro.png', fracao: 1 }] }).join()).toMatch(/mudança inválida/);
  });
  it('o artefato aceita mudancas.json, reprova o malformado e exige o veredito quando pedido', () => {
    const base = (v?: string) => {
      const p = artefato([entrada('a-claro.png')], { 'a-claro.png': PNG_FALSO });
      if (v !== undefined) writeFileSync(join(p, 'mudancas.json'), v);
      return p;
    };
    expect(validarArtefato(base('{"veredito":"versao","mudancas":[]}'), true)).toEqual([]);
    expect(validarArtefato(base('{"veredito":"visual","mudancas":[]}')).join()).toMatch(/incoerente/);
    expect(validarArtefato(base('nao json')).join()).toMatch(/não é JSON/);
    expect(validarArtefato(base(), true)).toEqual(['sem mudancas.json']);
    expect(validarArtefato(base())).toEqual([]);
  });
});
