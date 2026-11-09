import { expect, test } from '@playwright/test';
import { API_URL, cookiesDeUmLoginProprio, type CookieDaSemeadura } from '../suporte/api.ts';

/**
 * Revogação do refresh no SERVIDOR (P2), só por HTTP: logout derruba a
 * família, e o refresh reusado derruba a família inteira (detecção de reuso).
 * Cada teste faz um login próprio (2 do balde, sem navegador).
 */
test.use({ storageState: { cookies: [], origins: [] } });

// O login pode emitir o mesmo nome mais de uma vez (paths diferentes): vale o último, na jarra e no cabeçalho.
const unicos = (cookies: CookieDaSemeadura[]) => [...new Map(cookies.map((c) => [c.name, c])).values()];
const jarra = (cookies: CookieDaSemeadura[]) => unicos(cookies).map((c) => `${c.name}=${c.value}`).join('; ');
const csrf = (cookies: CookieDaSemeadura[]) => unicos(cookies).find((c) => c.name === 'brabo_csrf')?.value ?? '';

function post(rota: string, cookies: CookieDaSemeadura[]) {
  return fetch(`${API_URL}${rota}`, {
    method: 'POST',
    headers: { Cookie: jarra(cookies), 'X-CSRF-Token': csrf(cookies), 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function dosCabecalhos(r: Response): CookieDaSemeadura[] {
  return r.headers.getSetCookie().map((linha) => {
    const [par = ''] = linha.split(';');
    const i = par.indexOf('=');
    return { name: par.slice(0, i), value: par.slice(i + 1) } as CookieDaSemeadura;
  });
}

test.describe('revogação do refresh', { tag: '@f-autenticacao' }, () => {
  test('o logout revoga o refresh no servidor', async () => {
    const cookies = await cookiesDeUmLoginProprio();
    expect((await post('/auth/logout', cookies)).status).toBe(204);
    expect((await post('/auth/refresh', cookies)).status, 'o refresh sobreviveu ao logout').toBe(401);
  });

  test('o refresh reusado revoga a família', async () => {
    const cookies = await cookiesDeUmLoginProprio();
    const primeiro = await post('/auth/refresh', cookies);
    expect(primeiro.status).toBe(200);
    const novos = [...cookies, ...dosCabecalhos(primeiro)];
    expect((await post('/auth/refresh', cookies)).status, 'o refresh velho foi aceito').toBe(401);
    expect((await post('/auth/refresh', novos)).status, 'a família não foi revogada').toBe(401);
  });
});
