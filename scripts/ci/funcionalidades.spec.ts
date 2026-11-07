import { describe, expect, it } from 'vitest';
import { carregar, validarCatalogo, type Funcionalidade } from './funcionalidades.ts';

const f = (id: string, caminhos: Record<string, string[]> = {}): Funcionalidade => ({
  id,
  nome: id,
  descricao: id,
  tema: 'iam',
  status: 'ativa',
  caminhos,
});
const ctx = { arquivos: { api: ['src/a/auth/x.ts'] }, tagsDasSpecs: ['@f-a'] };

describe('validarCatalogo', () => {
  it('aceita o catálogo coerente', () => {
    expect(validarCatalogo([f('a', { api: ['src/**/auth/**'] })], ctx).erros).toEqual([]);
  });
  it('reprova id repetido', () => {
    expect(validarCatalogo([f('a'), f('a')], ctx).erros).toContain('id repetido: a');
  });
  it('reprova id fora de kebab-case', () => {
    expect(validarCatalogo([f('Aa_b')], { ...ctx, tagsDasSpecs: [] }).erros[0]).toMatch(/kebab/);
  });
  it('reprova glob que não casa nenhum arquivo', () => {
    const r = validarCatalogo([f('a', { api: ['src/**/nada/**'] })], ctx);
    expect(r.erros[0]).toMatch(/não casa nenhum arquivo de api/);
  });
  it('repo ausente não reprova, mas é listado', () => {
    const r = validarCatalogo([f('a', { web: ['src/**'] })], ctx);
    expect(r.erros).toEqual([]);
    expect(r.naoVerificados).toEqual(['web']);
  });
  it('com exigirTodos (CI), repo ausente reprova', () => {
    const r = validarCatalogo([f('a', { web: ['src/**'] })], ctx, true);
    expect(r.erros[0]).toMatch(/repo web mapeado mas sem checkout/);
  });
  it('reprova tag de spec sem funcionalidade no catálogo', () => {
    expect(validarCatalogo([f('a')], { ...ctx, tagsDasSpecs: ['@f-a', '@f-zzz'] }).erros).toEqual([
      'tag @f-zzz em spec sem funcionalidade no catálogo',
    ]);
  });
  it('lista sem cobertura sem reprovar', () => {
    const r = validarCatalogo([f('a'), f('b')], ctx);
    expect(r.erros).toEqual([]);
    expect(r.semCobertura).toEqual(['b']);
  });
});

describe('funcionalidades.yml real', () => {
  it('passa no validador contra os repos irmãos achados', () => {
    const { catalogo, ctx: real } = carregar();
    expect(catalogo).toHaveLength(14);
    expect(validarCatalogo(catalogo, real, !!process.env.CI).erros).toEqual([]);
  });
});
