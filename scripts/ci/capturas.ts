// As duas decisões do workflow `capturas-da-doc.yml` que não podem ser frouxas (AT-859, ADR 0286):
//  - `decidir`:  `node capturas.ts decidir <componentes.json> <capturas.json|->`: imprime `seguir=true|false`.
//  - `publicar`: `node capturas.ts validar <pasta-do-artefato>`: o artefato vem de um job que roda navegador, então na
//    fronteira de confiança só passa o que o manifesto nomeia, em PNG, dentro do teto; qualquer outra coisa reprova.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const TETO_DO_PNG = 400 * 1024;
const TAG = /^v\d+\.\d+\.\d+(-dev\.\d+)?$/;
const ARQUIVO = /^[a-z0-9-]+-(claro|escuro)\.png$/;

/** MAJOR.MINOR de uma tag `vX.Y.Z[-dev.N]`; null se não for uma. */
export function maiorMenor(tag: string): string | null {
  const m = /^v(\d+)\.(\d+)\./.exec(tag);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Segue (captura) quando não há manifesto ou o MAJOR.MINOR do `web` mudou desde a última captura. */
export function deveCapturar(pinDoWeb: string, manifesto: Array<{ web?: string }> | null): boolean {
  const atual = maiorMenor(pinDoWeb);
  if (atual === null) throw new Error(`a pin do web não é uma tag vX.Y.Z: ${pinDoWeb}`);
  const ultima = manifesto?.[0]?.web ? maiorMenor(manifesto[0].web) : null;
  return ultima !== atual;
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
export function validarArtefato(pasta: string): string[] {
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
  for (const nome of readdirSync(pasta)) {
    if (nome === 'capturas.json') continue;
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
  } else if (cmd === 'validar') {
    const problemas = validarArtefato(a!);
    for (const p of problemas) console.error(`::error::${p}`);
    process.exit(problemas.length === 0 ? 0 : 1);
  } else {
    console.error('uso: capturas.ts decidir <componentes.json> <capturas.json|-> | validar <pasta>');
    process.exit(2);
  }
}
