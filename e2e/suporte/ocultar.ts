/**
 * Ocultação de dado sensível nas capturas da doc (AT-864, AT-859, ADR 0286).
 *
 * Duas camadas, e a segunda existe porque a primeira pode falhar em silêncio:
 *
 * 1. `mascaras(page)`: caixas que o `page.screenshot({ mask })` cobre com cor chapada ANTES de a
 *    imagem ser gerada (e-mail e nome do usuário, avatar, senha, chave de provider, caminho de pasta).
 * 2. `conferirSemDadoSensivel(page)`: LANÇA se o texto visível, ou o valor de um campo, casar com
 *    um padrão proibido. Uma captura que falha é melhor que uma imagem pública com o usuário da máquina.
 *
 * Sem import de `@playwright/test` de propósito: o módulo é lógica pura, e o spec dele roda no
 * Vitest de `scripts/` (`pnpm --dir scripts test`), que não instala o Playwright. `Page` do Playwright
 * satisfaz as interfaces abaixo por estrutura.
 */

/** Domínios de e-mail que são de teste/fictícios (`bot.brabo.local` é o do commit dos dev agents, fictício do produto). Qualquer outro e-mail visível reprova a captura. */
export const DOMINIOS_DE_TESTE = ['brabo.dev', 'brabo.test', 'loja-teste.local', 'exemplo.com', 'bot.brabo.local'];

/**
 * Padrões proibidos no que a imagem mostra. `tipo` entra na mensagem; o TRECHO achado nunca entra
 * (a mensagem iria para log público do Actions): só o tipo e o tamanho.
 */
const PROIBIDOS: ReadonlyArray<{ tipo: string; re: RegExp }> = [
  { tipo: 'caminho /home/', re: /\/home\//i },
  { tipo: 'usuário da máquina', re: /danielsouza/i },
  { tipo: 'handle do GitHub', re: /daneiel/i },
  { tipo: 'token do GitHub', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { tipo: 'chave sk-', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { tipo: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { tipo: 'chave AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
];

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

/** Tipos de achado em `texto`; vazio quando está limpo. */
export function achadosSensiveis(texto: string): string[] {
  const achados = PROIBIDOS.filter((p) => p.re.test(texto)).map((p) => p.tipo);
  for (const m of texto.matchAll(EMAIL)) {
    const dominio = (m[1] ?? '').toLowerCase();
    if (!DOMINIOS_DE_TESTE.includes(dominio)) achados.push('e-mail fora do domínio de teste');
  }
  return [...new Set(achados)];
}

/** O que a guarda lê da página: o texto visível e o valor dos campos (que `innerText` não traz). */
export interface PaginaLegivel {
  locator(seletor: string): {
    innerText(): Promise<string>;
    // `any` de propósito: os elementos são do DOM do navegador, que este módulo não importa.
    evaluateAll(fn: (els: any[]) => unknown): Promise<unknown>;
  };
}

/** Lança se a página mostra dado sensível. Chame ANTES de cada `screenshot`. */
export async function conferirSemDadoSensivel(page: PaginaLegivel, nome = 'captura'): Promise<void> {
  const visivel = await page.locator('body').innerText();
  const valores = await page.locator('input:not([type="password"]), textarea').evaluateAll((els) => els.map((e) => e.value ?? '').join('\n'));
  const achados = achadosSensiveis(`${visivel}\n${String(valores)}`);
  if (achados.length > 0) throw new Error(`${nome}: dado sensível visível na página (${achados.join(', ')}); a captura foi recusada`);
}

/** Seletores cobertos pelo `mask`. Estruturais: o idioma é decisão do servidor, então nada de texto. */
export const SELETORES_MASCARADOS = [
  'input[type="password"]',
  'input[type="email"]',
  // O cartão do usuário (e-mail, nome, avatar) é o botão do menu da barra lateral; o `aria-label` dele é o e-mail.
  'button[data-slot="dropdown-menu-trigger"][aria-label*="@"]',
  '[data-testid="menu-do-usuario"]',
  '[data-testid="avatar"]',
  '[data-testid="caminho-da-pasta"]',
  'input[name*="key" i]',
  'input[name*="token" i]',
  'input[name*="path" i]',
  'img[alt*="avatar" i]',
] as const;

/** As caixas para `page.screenshot({ mask })`. Seletor que não casa nada é inofensivo. */
export function mascaras<L>(page: { locator(seletor: string): L }): L[] {
  return SELETORES_MASCARADOS.map((s) => page.locator(s));
}

/** Cor chapada do `mask`: contrasta nos dois temas sem parecer um erro de renderização. */
export const COR_DA_MASCARA = '#6b7280';

/**
 * O que muda a cada execução e não é a tela (AT-878): o hash curto da sessão e da branch da tarefa, o "iniciada às"
 * e o "há N min". Vira valor fixo ANTES do screenshot; sem isso o diff de pixels da `capturas.ts` leria ruído (até 0,15%
 * dos pixels) como mudança visual e pediria o dono a cada recaptura.
 */
export const VOLATEIS: ReadonlyArray<{ re: RegExp; por: string }> = [
  { re: /#[0-9a-f]{8}\b/g, por: '#00000000' },
  { re: /\btask-[0-9a-f]{8}\b/g, por: 'task-00000000' },
  { re: /iniciada às \d{2}:\d{2}:\d{2}/g, por: 'iniciada às 12:00:00' },
  { re: /\bhá \d+ (?:s|seg|min|h|d|dias?)\b/g, por: 'há 3 min' },
];

/** `texto` com os valores voláteis trocados pelos fixos. */
export function fixarVolateis(texto: string): string {
  return VOLATEIS.reduce((t, v) => t.replace(v.re, v.por), texto);
}

/** O que `fixarNaPagina` usa: `Page` do Playwright satisfaz por estrutura. */
export interface PaginaEditavel {
  // `any` de propósito: a função roda no navegador, que este módulo não importa.
  evaluate(fn: (regras: any) => unknown, arg: unknown): Promise<unknown>;
}

/** Troca os voláteis nos nós de texto da página e espera as rolagens assentarem. Chame ANTES de cada `screenshot`. */
export async function fixarNaPagina(page: PaginaEditavel): Promise<void> {
  const regras = VOLATEIS.map((v) => ({ fonte: v.re.source, flags: v.re.flags, por: v.por }));
  await page.evaluate(async (rs: Array<{ fonte: string; flags: string; por: string }>) => {
    const doc = (globalThis as any).document;
    const caminhada = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = caminhada.nextNode(); n; n = caminhada.nextNode()) {
      const antes: string = n.nodeValue ?? '';
      const depois = rs.reduce((t, r) => t.replace(new RegExp(r.fonte, r.flags), r.por), antes);
      if (depois !== antes) n.nodeValue = depois;
    }
    // O feed rola e mede linhas depois do carregamento (merges-no-chat saía com linhas diferentes por trás do cartão):
    // espera três leituras iguais do texto visível e das posições de rolagem.
    const estado = (): string => doc.body.innerText + [...doc.querySelectorAll('*')].filter((e: any) => e.scrollHeight > e.clientHeight).map((e: any) => e.scrollTop).join();
    let ultima = estado();
    for (let i = 0, iguais = 0; i < 40 && iguais < 3; i++) {
      await new Promise((ok) => setTimeout(ok, 200));
      const atual = estado();
      iguais = atual === ultima ? iguais + 1 : 0;
      ultima = atual;
    }
  }, regras);
}
