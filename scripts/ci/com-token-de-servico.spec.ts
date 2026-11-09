import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'com-token-de-servico.sh');
const TOKEN = 'SEGREDO/abc+123==';

function env(conteudo: string): string {
  const arquivo = join(mkdtempSync(join(tmpdir(), 'tok-')), '.env');
  writeFileSync(arquivo, conteudo);
  return arquivo;
}

const rodar = (arquivo: string, ...cmd: string[]) =>
  spawnSync('bash', [SCRIPT, arquivo, '--', ...cmd], { encoding: 'utf8' });

describe('com-token-de-servico.sh', () => {
  it('entrega o token ao comando e só o diz ao runner pelo ::add-mask::', () => {
    const r = rodar(env(`A=1\nBRABO_SERVICE_TOKEN=${TOKEN}\nB=2\n`), 'sh', '-c', 'echo "tamanho=${#E2E_SERVICE_TOKEN}"');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`tamanho=${TOKEN.length}`);
    const log = (r.stdout + r.stderr).split('\n');
    expect(log.filter((l) => l.includes(TOKEN))).toEqual([`::add-mask::${TOKEN}`]);
  });

  it('o ambiente do chamador não ganha o token', () => {
    const r = rodar(env(`BRABO_SERVICE_TOKEN=${TOKEN}\n`), 'true');
    expect(r.status).toBe(0);
    expect(process.env.E2E_SERVICE_TOKEN).toBeUndefined();
  });

  it('sem token no .env falha sem imprimir nada do arquivo', () => {
    const r = rodar(env('OUTRO=segredo-de-outro\n'), 'true');
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain('segredo-de-outro');
  });

  it('propaga o código de saída do comando', () => {
    expect(rodar(env(`BRABO_SERVICE_TOKEN=${TOKEN}\n`), 'sh', '-c', 'exit 7').status).toBe(7);
  });
});
