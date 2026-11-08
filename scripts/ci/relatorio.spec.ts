import { describe, expect, it } from 'vitest';
import { caber, compactar, extrairSpecs, montarRelatorio, recomendar, sanitizarResumo, semAnsi, type Contexto, type SpecR } from './relatorio.ts';

const ativos = ['autenticacao', 'aprovacoes', 'projetos'];
const catalogo = ativos.map((id) => ({ id, nome: `Nome ${id}` }));
const pw = (title: string, tags: string[], status: string, extra: Record<string, unknown> = {}, file = 'testes/a.spec.ts') => ({
  title, tags, file, line: 3, ok: status !== 'unexpected',
  tests: [{ status, results: [{ status: status === 'unexpected' ? 'failed' : 'passed', duration: 1000, retry: 0, attachments: [{ name: 'trace', path: 'x.zip' }], ...extra }] }],
});
const rel = (...specs: object[]) => ({ suites: [{ suites: [{ specs }], specs: [] }] });
const ctx = (o: Partial<Contexto> = {}): Contexto => ({ catalogo, modo: 'main', ids: ativos, causa: null, ...o });
const sp = (o: Partial<SpecR> = {}): SpecR => ({ funcionalidades: ['autenticacao'], titulo: 't', arquivo: 'a.spec.ts', linha: 1, status: 'passou', tentativas: 1, duracao_ms: 1000, anexos: [], ...o });

describe('semAnsi', () => {
  it('tira os códigos de cor do erro do Playwright', () => expect(semAnsi('\u001b[2mexpect(\u001b[22m\u001b[31mx\u001b[39m)')).toBe('expect(x)'));
});

describe('extrairSpecs', () => {
  it('lê status, tags do catálogo, erro sem ANSI e anexos', () => {
    const r = extrairSpecs(rel(
      pw('ok', ['f-autenticacao'], 'expected'),
      pw('vermelha', ['@f-aprovacoes', 'f-fora-do-catalogo'], 'unexpected', { error: { message: '\u001b[31mboom\u001b[39m' }, retry: 1 }),
      pw('flaky', ['f-projetos'], 'flaky'),
      pw('pulada', [], 'skipped'),
      pw('login', [], 'expected', {}, 'testes/entrar.setup.ts'),
    ), ativos)!;
    expect(r.map((s) => s.status)).toEqual(['passou', 'falhou', 'flaky', 'pulou', 'passou']);
    expect(r[1]).toMatchObject({ funcionalidades: ['aprovacoes'], erro: 'boom', anexos: ['trace'] });
    expect(r[4]!.titulo).toBe('(preparação) login');
    expect(extrairSpecs(null, ativos)).toBeNull();
  });
});

describe('montarRelatorio', () => {
  it('conta por funcionalidade, "sem cobertura" e o balde "sem funcionalidade" (que reprova)', () => {
    const specs = extrairSpecs(rel(pw('a', ['f-autenticacao'], 'expected'), pw('b', [], 'unexpected', { error: { message: 'x' } })), ativos)!;
    const r = montarRelatorio(specs, ctx({ causa: 'spec' }));
    expect(r.funcionalidades.find((f) => f.id === 'autenticacao')).toMatchObject({ specs: 1, passou: 1, resultado: 'verde' });
    expect(r.funcionalidades.find((f) => f.id === 'projetos')!.resultado).toBe('sem cobertura');
    expect(r.semFuncionalidade).toHaveLength(1);
    expect(r.veredito).toBe('vermelho');
    const md = caber(r, 100000);
    expect(md).toContain('sem funcionalidade');
    expect(md).toContain('VERMELHO · causa spec');
    expect(md).toContain('[sem funcionalidade] b');
  });
  it('sem resultado: tudo "sem cobertura" e nada de ANSI no Markdown', () => {
    const md = caber(montarRelatorio(null, ctx({ causa: 'ambiente' })), 100000);
    expect(md).toContain('rodar de novo');
    // eslint-disable-next-line no-control-regex
    expect(md).not.toMatch(/\u001b/);
  });
});

describe('recomendar', () => {
  const falha = (f: string[]) => [sp({ status: 'falhou', funcionalidades: f })];
  it('verde aprova; verde com flaky aprova com aviso', () => {
    expect(recomendar(ctx(), [sp()]).acao).toBe('aprovar');
    expect(recomendar(ctx(), [sp({ status: 'flaky' })]).texto).toContain('flaky');
  });
  it('digest e assinatura bloqueiam', () => {
    expect(recomendar(ctx({ causa: 'digest' }), []).acao).toBe('bloquear');
    expect(recomendar(ctx({ causa: 'assinatura' }), []).acao).toBe('bloquear');
  });
  it('spec em funcionalidade que a PR toca bloqueia; fora da mudança aceita com justificativa', () => {
    const c = ctx({ causa: 'spec', tocadas: ['autenticacao'] });
    expect(recomendar(c, falha(['autenticacao'])).acao).toBe('bloquear');
    expect(recomendar(c, falha(['projetos'])).acao).toBe('aceitar com justificativa');
    expect(recomendar(c, falha([])).acao).toBe('aceitar com justificativa');
  });
  it('sem o mapa informado no portão, bloqueia por cautela; no dev tudo o que roda é tocado', () => {
    expect(recomendar(ctx({ causa: 'spec' }), falha(['projetos'])).acao).toBe('bloquear');
    expect(recomendar(ctx({ causa: 'spec', modo: 'dev', ids: ['projetos'] }), falha(['projetos'])).texto).toMatch(/^atestado \(não bloqueia\): bloquear/);
  });
  it('ambiente manda rodar de novo', () => expect(recomendar(ctx({ causa: 'ambiente' }), []).acao).toBe('rodar de novo'));
});

describe('caber', () => {
  const muitas = Array.from({ length: 500 }, (_, i) => sp({ titulo: `spec ${i}`, funcionalidades: [ativos[i % 3]!], status: i % 10 === 0 ? 'falhou' : 'passou', erro: Array.from({ length: 40 }, (_, k) => `linha ${k} do erro ${'x'.repeat(100)}`).join('\n') }));
  const r = montarRelatorio(muitas, ctx({ causa: 'spec', run: 'https://github.com/x/y/actions/runs/1' }));
  it('500 specs falsas cabem em 65535 com aviso de corte', () => {
    const md = caber(r, 60000);
    expect(md.length).toBeLessThanOrEqual(60000);
    expect(md).toContain('a mais no artefato');
    expect(md).toContain('Regressivo do brabo-qa: VERMELHO');
  });
  it('com folga mostra o detalhe por funcionalidade; no comentário nunca', () => {
    const pequeno = montarRelatorio([sp()], ctx());
    expect(caber(pequeno, 100000)).toContain('<details><summary>autenticacao');
    expect(caber(pequeno, 100000, { comentario: true, detalhe: false })).not.toContain('<details>');
  });
});

describe('compactar e sanitizarResumo', () => {
  it('põe o que não passou primeiro, trunca o erro e conta as omitidas', () => {
    const c = compactar([sp(), ...Array.from({ length: 400 }, () => sp({ status: 'falhou', erro: 'e'.repeat(5000) }))]);
    expect(c.specs).toHaveLength(300);
    expect(c.omitidas).toBe(101);
    expect(c.specs[0]!.erro).toHaveLength(1000);
    expect(JSON.stringify(c).length).toBeLessThan(400_000);
  });
  it('só passa id do catálogo, status válido e texto sem ANSI; escapa o que vai a linha de tabela', () => {
    const r = sanitizarResumo({ specs: [{ funcionalidades: ['autenticacao', 'x;rm', 'nao-existe'], titulo: 'a|b`c<d \u001b[31m@alguem', arquivo: 'f', linha: '7', status: 'hack', tentativas: 99999, duracao_ms: -4, erro: '\u001b[2mx' }], omitidas: 'abc' }, ativos)!;
    expect(r.specs[0]).toMatchObject({ funcionalidades: ['autenticacao'], status: 'falhou', linha: 7, tentativas: 20, duracao_ms: 0, erro: 'x' });
    expect(r.omitidas).toBe(0);
    const md = caber(montarRelatorio(r.specs, ctx({ causa: 'spec' })), 100000);
    expect(md).toContain("a\\|b'c&lt;d @​alguem");
    expect(sanitizarResumo('lixo', ativos)).toBeNull();
  });
});
