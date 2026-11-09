// Cobertura por funcionalidade (AT-769): cruza o catálogo com o resultado.json do Playwright (tags `f-<id>` nas specs).
// Sem dependências (roda no job e2e só com o node): o catálogo é lido por linha, não por YAML.
import { appendFileSync, readFileSync } from 'node:fs';

export type LinhaDeCobertura = { funcionalidade: string; specs: number; resultado: 'verde' | 'vermelho' | 'sem cobertura' };

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Funcionalidades `ativa` do `funcionalidades.yml` (id e nome), na ordem do arquivo. */
export function catalogoAtivo(yaml: string): { id: string; nome: string }[] {
  const out: { id: string; nome: string }[] = [];
  let atual: { id: string; nome: string } | null = null;
  for (const l of yaml.split('\n')) {
    const id = /^ {2}- id: ([a-z0-9-]+)\s*$/.exec(l);
    if (id) atual = { id: id[1]!, nome: id[1]! };
    else if (atual && /^ {4}nome: (.+?)\s*$/.test(l)) atual.nome = /^ {4}nome: (.+?)\s*$/.exec(l)![1]!;
    else if (atual && /^ {4}status: ativa\s*$/.test(l)) out.push(atual);
  }
  return out;
}

/** Ids das funcionalidades `ativa` do `funcionalidades.yml`, na ordem do arquivo. */
export const idsAtivos = (yaml: string): string[] => catalogoAtivo(yaml).map((x) => x.id);

/** `null` = a suíte não produziu resultado (não se diz "sem cobertura" de quem nem rodou). `ids` = o que o run devia cobrir. */
export function coberturaDe(resultado: unknown, ids: string[]): LinhaDeCobertura[] | null {
  if (!resultado || typeof resultado !== 'object') return null;
  const specs: Record<string, { n: number; falhou: boolean }> = {};
  const visitar = (no: unknown): void => {
    if (Array.isArray(no)) return no.forEach(visitar);
    if (!no || typeof no !== 'object') return;
    const o = no as Record<string, unknown>;
    if (Array.isArray(o.specs)) {
      for (const s of o.specs as Record<string, unknown>[]) {
        const tags = Array.isArray(s.tags) ? s.tags : [];
        for (const t of new Set(tags.map((x) => String(x).replace(/^@/, '')))) {
          const m = /^f-([a-z0-9-]+)$/.exec(t);
          if (!m) continue;
          const c = (specs[m[1]!] ??= { n: 0, falhou: false });
          c.n += 1;
          if (s.ok === false) c.falhou = true;
        }
      }
    }
    Object.values(o).forEach(visitar);
  };
  visitar(resultado);
  return ids.map((id) => {
    const c = specs[id];
    return { funcionalidade: id, specs: c?.n ?? 0, resultado: !c ? 'sem cobertura' : c.falhou ? 'vermelho' : 'verde' };
  });
}

/** Linha vinda de job output (dado de PR): só passa o que bate com o catálogo e com o formato. */
export function sanitizarCobertura(raw: unknown, ativos: string[]): LinhaDeCobertura[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const linhas: LinhaDeCobertura[] = [];
  for (const l of raw.slice(0, 50) as Record<string, unknown>[]) {
    const id = String(l?.funcionalidade);
    const n = Number(l?.specs);
    if (!KEBAB.test(id) || !ativos.includes(id) || !Number.isInteger(n) || n < 0 || n > 9999) continue;
    const r = n === 0 ? 'sem cobertura' : l.resultado === 'vermelho' ? 'vermelho' : 'verde';
    linhas.push({ funcionalidade: id, specs: n, resultado: r });
  }
  return linhas.length > 0 ? linhas : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const e = process.env;
  const todos = idsAtivos(readFileSync('funcionalidades.yml', 'utf8'));
  const pedidos = (e.FUNCIONALIDADES ?? '').split(',').filter(Boolean);
  const ids = e.MODO === 'funcionalidades' ? pedidos : todos;
  let r: unknown = null;
  try { r = JSON.parse(readFileSync(`${e.E2E_DIR || 'e2e'}/resultado.json`, 'utf8')); } catch { /* sem resultado: sem tabela */ }
  appendFileSync(process.env.GITHUB_OUTPUT!, `cobertura=${JSON.stringify(coberturaDe(r, ids))}\n`);
}
