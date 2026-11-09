import { describe, expect, it } from 'vitest';
import { achadosSensiveis, conferirSemDadoSensivel, fixarVolateis, mascaras, SELETORES_MASCARADOS } from '../../e2e/suporte/ocultar.ts';

const pagina = (corpo: string, campos = '') => ({
  locator: (s: string) => ({
    innerText: async () => (s === 'body' ? corpo : ''),
    evaluateAll: async () => campos as never,
  }),
});

describe('ocultar: a guarda de texto da captura (AT-864)', () => {
  it.each([
    ['caminho do usuário', 'Pasta: /home/fulano/projetos', 'caminho /home/'],
    ['usuário da máquina', 'dono danielsouza', 'usuário da máquina'],
    ['handle do GitHub', 'por daneiel', 'handle do GitHub'],
    ['token do GitHub', 'ghp_' + 'a'.repeat(30), 'token do GitHub'],
    ['token fine-grained', 'github_pat_' + 'A1_'.repeat(10), 'token do GitHub'],
    ['chave sk-', 'sk-' + 'x'.repeat(24), 'chave sk-'],
    ['e-mail real', 'fale com alguem@gmail.com', 'e-mail fora do domínio de teste'],
  ])('reprova %s', (_n, texto, tipo) => {
    expect(achadosSensiveis(texto)).toContain(tipo);
  });

  it('deixa passar texto limpo e e-mail de domínio de teste', () => {
    expect(achadosSensiveis('Projeto encurtador, owner@brabo.dev, dono@loja-teste.local, 12 tarefas')).toEqual([]);
    expect(achadosSensiveis('commit de dev-api@bot.brabo.local')).toEqual([]);
  });

  it('a mensagem da falha não repete o trecho achado', async () => {
    const segredo = 'ghp_' + 'Z'.repeat(30);
    await expect(conferirSemDadoSensivel(pagina(`token ${segredo}`), 'tela')).rejects.toThrow(/tela: dado sensível visível.*token do GitHub/);
    await expect(conferirSemDadoSensivel(pagina(`token ${segredo}`))).rejects.not.toThrow(new RegExp(segredo));
  });

  it('LANÇA com /home/x na página e também com /home/x no valor de um campo', async () => {
    await expect(conferirSemDadoSensivel(pagina('Caminho /home/x'))).rejects.toThrow(/caminho \/home\//);
    await expect(conferirSemDadoSensivel(pagina('limpo', '/home/x/projeto'))).rejects.toThrow(/caminho \/home\//);
  });

  it('passa quando a página está limpa', async () => {
    await expect(conferirSemDadoSensivel(pagina('Projetos', ''))).resolves.toBeUndefined();
  });

  it('mascaras devolve uma caixa por seletor', () => {
    const vistos: string[] = [];
    expect(mascaras({ locator: (s) => (vistos.push(s), s) })).toEqual([...SELETORES_MASCARADOS]);
  });
});

describe('ocultar: o que muda a cada execução vira valor fixo (AT-878)', () => {
  it('fixa hash da sessão, hash da branch, "iniciada às" e "há N min"', () => {
    const a = 'Sessão #425583c8 · #425583c8 · iniciada às 13:38:39 · feature/task-bb58781d · há 3 min';
    const b = 'Sessão #013d29ab · #013d29ab · iniciada às 09:01:02 · feature/task-d1c68acf · há 12 min';
    expect(fixarVolateis(a)).toBe(fixarVolateis(b));
    expect(fixarVolateis(a)).toBe('Sessão #00000000 · #00000000 · iniciada às 12:00:00 · feature/task-00000000 · há 3 min');
  });
  it('não toca no texto que é da tela', () => {
    const t = 'Pronta este minuto. PR #1 "dev-agent" · feature/task-curta · iniciada';
    expect(fixarVolateis(t)).toBe(t);
  });
});
