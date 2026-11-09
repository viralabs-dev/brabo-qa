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
