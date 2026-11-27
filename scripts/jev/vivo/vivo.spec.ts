import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerFerramentas, lerOpcoes, ordemDosBracos, relatorio, sistemaDoDev } from './vivo.ts';
import { TAREFAS, tarefaPorId } from './tarefas.ts';

const RAIZ = join(import.meta.dirname, '..', '..', '..');

describe('ferramentas-dev.json (gerado do engine por ferramentas-dev.exs)', () => {
  it('é igual à saída do .exs contra o engine — regenere se divergir', () => {
    const gerado = JSON.parse(execFileSync('elixir', ['scripts/jev/vivo/ferramentas-dev.exs'], { cwd: RAIZ, encoding: 'utf8' })) as { ferramentas: { name: string }[] };
    const arquivo = JSON.parse(readFileSync(join(import.meta.dirname, 'ferramentas-dev.json'), 'utf8')) as { ferramentas: { name: string }[] };
    expect(arquivo, 'regenere: elixir scripts/jev/vivo/ferramentas-dev.exs > scripts/jev/vivo/ferramentas-dev.json').toEqual(gerado);
  });
});

describe('lerOpcoes', () => {
  const env = { XDG_CACHE_HOME: '/tmp/cache-jev' };

  it('padrões, --preco e --tarefas', () => {
    const o = lerOpcoes(['--', '--preco', 'a/b=0.3/1.2', '--tarefas', 'T1-media,T3-limite', '--rodadas', '3'], env);
    expect(o).toMatchObject({ saida: '/tmp/cache-jev/brabo/jev-vivo', tetoUsd: 4.5, rodadas: 3, tarefas: ['T1-media', 'T3-limite'], precos: { 'a/b': { entrada: 0.3, saida: 1.2 } } });
  });

  it('recusa saída dentro do checkout, opção desconhecida, tarefa desconhecida e preço malformado', () => {
    expect(() => lerOpcoes(['--saida', join(RAIZ, 'tmp-saida')], env)).toThrow(/FORA do checkout/);
    expect(() => lerOpcoes(['--chave', 'x'], env)).toThrow(/opção desconhecida/);
    expect(() => lerOpcoes(['--tarefas', 'T9'], env)).toThrow(/tarefa desconhecida/);
    expect(() => lerOpcoes(['--preco', 'a=1'], env)).toThrow(/modelo=entrada\/saida/);
  });
});

describe('o ensaio', () => {
  it('a ordem dos braços alterna, e cada braço vai primeiro metade das vezes', () => {
    const primeiros = TAREFAS.flatMap((t) => [0, 1].map((r) => ordemDosBracos(t.id, r)[0]));
    expect(primeiros.filter((b) => b === 'ligado')).toHaveLength(primeiros.length / 2);
    expect(ordemDosBracos('T1-media', 0)).not.toEqual(ordemDosBracos('T1-media', 1));
  });

  it('o sistema é a identidade do dev do engine com o módulo da tarefa', () => {
    expect(sistemaDoDev(tarefaPorId('T3-limite'))).toMatch(/^Você é o agente dev-carrinho\./);
  });

  it('relatório de saída vazia não inventa veredito', () => {
    expect(relatorio([])).toContain('**amostra_insuficiente**');
  });
});
