// As duas decisões do workflow `capturas-da-doc.yml` que não podem ser frouxas (AT-859, ADR 0286):
//  - `decidir`:  `node capturas.ts decidir <componentes.json> <capturas.json|->`: imprime `seguir=true|false`.
//  - `diferenca`: `node capturas.ts diferenca <pasta-atual> <pasta-nova> <mudancas.json>`: o veredito `versao` | `visual` (AT-878).
//  - `publicar`: `node capturas.ts validar <pasta-do-artefato> [veredito]`: o artefato vem de um job que roda navegador, então na
//    fronteira de confiança só passa o que o manifesto nomeia, em PNG, dentro do teto; qualquer outra coisa reprova.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TETO_DO_PNG = 400 * 1024;
const TAG = /^v\d+\.\d+\.\d+(-dev\.\d+)?$/;
const ARQUIVO = /^[a-z0-9-]+-(claro|escuro)\.png$/;
/** 0,02% dos pixels (≈210 em 1366×768): acima do ruído já normalizado, abaixo de um rótulo trocado (AT-878). */
export const LIMIAR = 0.0002;

/** MAJOR.MINOR de uma tag `vX.Y.Z[-dev.N]`; null se não for uma. */
export function maiorMenor(tag: string): string | null {
  const m = /^v(\d+)\.(\d+)\./.exec(tag);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Segue (captura) quando não há manifesto ou a tag do `web` mudou desde a última captura, PATCH incluso (AT-878, d1). */
export function deveCapturar(pinDoWeb: string, manifesto: Array<{ web?: string }> | null): boolean {
  if (maiorMenor(pinDoWeb) === null) throw new Error(`a pin do web não é uma tag vX.Y.Z: ${pinDoWeb}`);
  return manifesto?.[0]?.web !== pinDoWeb;
}

export interface Mudanca {
  arquivo: string;
  /** Fração dos pixels que mudou (1 = arquivo novo, removido ou de outro tamanho). */
  fracao: number;
}
export interface Veredito {
  veredito: 'versao' | 'visual';
  mudancas: Mudanca[];
}

/** Compara cada PNG de `nova` com o de mesmo nome em `atual`; devolve os que passam do `LIMIAR` (ou são novos/de outro tamanho). */
export async function diferencas(atual: string, nova: string): Promise<Veredito> {
  // import tardio: `decidir` e `publicar` rodam sem `pnpm install`, só o `capturar` instala o pixelmatch.
  const [{ default: pixelmatch }, { PNG }] = await Promise.all([import('pixelmatch'), import('pngjs')]);
  const mudancas: Mudanca[] = [];
  for (const arquivo of readdirSync(nova).filter((n) => ARQUIVO.test(n)).sort()) {
    if (!existsSync(join(atual, arquivo))) {
      mudancas.push({ arquivo, fracao: 1 });
      continue;
    }
    const a = PNG.sync.read(readFileSync(join(atual, arquivo)));
    const b = PNG.sync.read(readFileSync(join(nova, arquivo)));
    if (a.width !== b.width || a.height !== b.height) {
      mudancas.push({ arquivo, fracao: 1 });
      continue;
    }
    const fracao = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 }) / (a.width * a.height);
    if (fracao > LIMIAR) mudancas.push({ arquivo, fracao });
  }
  // PNG que sumiu da captura nova também é mudança visual (o `publicar` o apaga da doc).
  for (const arquivo of readdirSync(atual).filter((n) => ARQUIVO.test(n) && !existsSync(join(nova, n)))) mudancas.push({ arquivo, fracao: 1 });
  return { veredito: mudancas.length === 0 ? 'versao' : 'visual', mudancas };
}

/** Problemas do `mudancas.json`; lista vazia = veredito bem formado e coerente. */
export function validarVeredito(v: unknown): string[] {
  const x = v as Partial<Veredito> | null;
  if (!x || (x.veredito !== 'versao' && x.veredito !== 'visual') || !Array.isArray(x.mudancas)) return ['mudancas.json malformado'];
  const problemas: string[] = [];
  if ((x.veredito === 'versao') !== (x.mudancas.length === 0)) problemas.push('veredito incoerente com a lista de mudanças');
  for (const m of x.mudancas) {
    if (typeof m?.arquivo !== 'string' || !ARQUIVO.test(m.arquivo) || typeof m.fracao !== 'number' || !(m.fracao > 0 && m.fracao <= 1)) problemas.push(`mudança inválida: ${String(m?.arquivo).slice(0, 60)}`);
  }
  return problemas;
}

export interface Entrada {
  arquivo: string;
  tela: string;
  tema: string;
  web: string;
  api: string;
  engine: string;
  data: string;
}

/** Problemas do artefato; lista vazia = pode copiar para `docs/assets/capturas/`. */
export function validarArtefato(pasta: string, exigirVeredito = false): string[] {
  const problemas: string[] = [];
  const caminhoManifesto = join(pasta, 'capturas.json');
  if (!existsSync(caminhoManifesto)) return ['sem capturas.json'];
  let manifesto: Entrada[];
  try {
    manifesto = JSON.parse(readFileSync(caminhoManifesto, 'utf8')) as Entrada[];
  } catch {
    return ['capturas.json não é JSON'];
  }
  if (!Array.isArray(manifesto) || manifesto.length === 0) return ['capturas.json vazio'];
  const nomeados = new Set<string>();
  for (const e of manifesto) {
    const texto = (k: keyof Entrada) => typeof e?.[k] === 'string' && e[k].length > 0 && e[k].length <= 200;
    if (!texto('arquivo') || !ARQUIVO.test(e.arquivo)) problemas.push(`nome de arquivo inválido no manifesto: ${String(e?.arquivo).slice(0, 60)}`);
    else nomeados.add(e.arquivo);
    for (const k of ['tela', 'tema', 'data'] as const) if (!texto(k)) problemas.push(`${e?.arquivo}: campo ${k} ausente`);
    for (const k of ['web', 'api', 'engine'] as const) if (!texto(k) || !TAG.test(e[k])) problemas.push(`${e?.arquivo}: ${k} não é uma tag (${String(e?.[k]).slice(0, 30)})`);
    if (e?.data && !/^\d{4}-\d{2}-\d{2}$/.test(e.data)) problemas.push(`${e.arquivo}: data inválida`);
  }
  const caminhoVeredito = join(pasta, 'mudancas.json');
  if (existsSync(caminhoVeredito)) {
    try {
      problemas.push(...validarVeredito(JSON.parse(readFileSync(caminhoVeredito, 'utf8'))));
    } catch {
      problemas.push('mudancas.json não é JSON');
    }
  } else if (exigirVeredito) problemas.push('sem mudancas.json');
  for (const nome of readdirSync(pasta)) {
    if (nome === 'capturas.json' || nome === 'mudancas.json') continue;
    const caminho = join(pasta, nome);
    if (!nomeados.has(nome)) problemas.push(`arquivo fora do manifesto: ${nome.slice(0, 60)}`);
    else if (!statSync(caminho).isFile()) problemas.push(`${nome} não é arquivo`);
    else if (statSync(caminho).size > TETO_DO_PNG) problemas.push(`${nome} pesa mais de ${TETO_DO_PNG} bytes`);
    else if (readFileSync(caminho).subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') problemas.push(`${nome} não é PNG`);
  }
  for (const nome of nomeados) if (!existsSync(join(pasta, nome))) problemas.push(`manifesto cita ${nome}, que não está no artefato`);
  return problemas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'decidir') {
    const pin = (JSON.parse(readFileSync(a!, 'utf8')) as { imagens: { web: { tag: string } } }).imagens.web.tag;
    const manifesto = b && b !== '-' ? (JSON.parse(readFileSync(b, 'utf8')) as Array<{ web?: string }>) : null;
    console.log(`seguir=${deveCapturar(pin, manifesto)}`);
  } else if (cmd === 'diferenca') {
    const v = await diferencas(a!, b!);
    writeFileSync(process.argv[5]!, `${JSON.stringify(v, null, 2)}\n`);
    console.log(`veredito=${v.veredito}`);
    for (const m of v.mudancas) console.log(`  ${m.arquivo} ${(m.fracao * 100).toFixed(3)}%`);
  } else if (cmd === 'validar') {
    const problemas = validarArtefato(a!, b === 'veredito');
    for (const p of problemas) console.error(`::error::${p}`);
    process.exit(problemas.length === 0 ? 0 : 1);
  } else {
    console.error('uso: capturas.ts decidir <componentes.json> <capturas.json|-> | diferenca <atual> <nova> <saida.json> | validar <pasta> [veredito]');
    process.exit(2);
  }
}
