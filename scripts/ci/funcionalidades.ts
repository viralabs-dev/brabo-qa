// Validador do catálogo `funcionalidades.yml` (AT-769, RN-1031). Função pura: quem lê disco é `carregar`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export type Funcionalidade = {
  id: string;
  nome: string;
  descricao: string;
  tema: string;
  status: 'ativa' | 'aposentada';
  caminhos: Record<string, string[]>;
};

export type Contexto = {
  /** Arquivos (relativos à raiz) de cada repo achado. Repo ausente = não verificado, não é erro. */
  arquivos: Record<string, string[]>;
  /** Tags `@f-<id>` encontradas nas specs. */
  tagsDasSpecs: string[];
};

export type Resultado = { erros: string[]; semCobertura: string[]; naoVerificados: string[] };

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validarCatalogo(catalogo: Funcionalidade[], ctx: Contexto): Resultado {
  const erros: string[] = [];
  const naoVerificados = new Set<string>();
  const vistos = new Set<string>();
  for (const f of catalogo) {
    if (!KEBAB.test(f.id)) erros.push(`id fora de kebab-case: ${f.id}`);
    if (vistos.has(f.id)) erros.push(`id repetido: ${f.id}`);
    vistos.add(f.id);
    if (f.status !== 'ativa' && f.status !== 'aposentada') erros.push(`${f.id}: status inválido (${String(f.status)})`);
    for (const [repo, globs] of Object.entries(f.caminhos ?? {})) {
      const arquivos = ctx.arquivos[repo];
      if (!arquivos) {
        naoVerificados.add(repo);
        continue;
      }
      for (const g of globs) {
        if (!arquivos.some((a) => matchesGlob(a, g))) erros.push(`${f.id}: o glob "${g}" não casa nenhum arquivo de ${repo}`);
      }
    }
  }
  for (const t of new Set(ctx.tagsDasSpecs)) {
    if (!vistos.has(t.slice('@f-'.length))) erros.push(`tag ${t} em spec sem funcionalidade no catálogo`);
  }
  const comSpec = new Set(ctx.tagsDasSpecs.map((t) => t.slice('@f-'.length)));
  const semCobertura = catalogo.filter((f) => f.status === 'ativa' && !comSpec.has(f.id)).map((f) => f.id);
  return { erros, semCobertura, naoVerificados: [...naoVerificados].sort() };
}

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Irmãos ao lado do checkout (no CI: `qa/` ao lado de `brabo-api/`); `BRABO_IRMAOS_DIR` sobrescreve. O `qa` é este repo. */
export function carregar(raiz = RAIZ, irmaos = process.env.BRABO_IRMAOS_DIR ?? dirname(raiz)): { catalogo: Funcionalidade[]; ctx: Contexto } {
  const catalogo = (parse(readFileSync(join(raiz, 'funcionalidades.yml'), 'utf8')) as { funcionalidades: Funcionalidade[] }).funcionalidades;
  const arquivos: Record<string, string[]> = {};
  const repos = new Set(catalogo.flatMap((f) => Object.keys(f.caminhos ?? {})));
  for (const repo of repos) {
    const dir = repo === 'qa' ? raiz : join(irmaos, `brabo-${repo}`);
    if (!existsSync(dir)) continue;
    arquivos[repo] = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean);
  }
  const testes = join(raiz, 'e2e/testes');
  const tagsDasSpecs = readdirSync(testes)
    .filter((n) => n.endsWith('.spec.ts'))
    .flatMap((n) => readFileSync(join(testes, n), 'utf8').match(/@f-[a-z0-9-]+/g) ?? []);
  return { catalogo, ctx: { arquivos, tagsDasSpecs } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { catalogo, ctx } = carregar();
  const r = validarCatalogo(catalogo, ctx);
  console.log(`sem cobertura: ${r.semCobertura.join(', ') || '-'}\nrepos não verificados: ${r.naoVerificados.join(', ') || '-'}`);
  if (r.erros.length) {
    console.error(r.erros.join('\n'));
    process.exit(1);
  }
}
