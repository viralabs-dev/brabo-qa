import { API_URL, semearSessao, type SessaoSemeada } from './api.ts';
/**
 * Constantes do provider dublê da api (AT-815 R4, RN-1065): o roteiro
 * `llm-duble-roteiro.json` fala do agente `criativo` e das perguntas abaixo.
 * O job liga o dublê com `compose-duble.yml` (`e2e-pr.yml`), mas a api só o
 * carrega em imagem sem a marca `prd`: hoje toda imagem publicada é `prd`, e as
 * duas specs estão em `test.fixme` por isso.
 */

/** `texto` do passo 0 do Criativo no roteiro. */
export const TEXTO_DO_PASSO_0 = 'Resposta do dublê em streaming: este texto chega como agent.delta antes da resposta final.';

/** Os `questionId` que o passo 1 do Criativo fecha com `answer_open_question`. */
export const PERGUNTAS_DO_ROTEIRO = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);

/**
 * Sessão CRIATIVA num workspace cujo modelo vinculado é um `ollama` (o provider
 * que o dublê ocupa no registry, sem credencial). Sem binding o turno acaba em
 * "Nenhum modelo vinculado", antes de chegar ao dublê. O seed só vincula o
 * workspace dele (`acme-corp`), não os que a semeadura cria.
 */
export async function semearSessaoComDuble(token: string): Promise<SessaoSemeada> {
  const sessao = await semearSessao(token, 'criativa');
  const cabecalhos = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const chamar = async (url: string, init?: RequestInit): Promise<unknown> => {
    const r = await fetch(`${API_URL}${url}`, { ...init, headers: cabecalhos });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url} respondeu ${r.status}: ${texto.slice(0, 500)}`);
    return JSON.parse(texto);
  };
  const catalogo = (await chamar(`/workspaces/${sessao.workspaceId}/models/catalog`)) as {
    local?: Record<string, Array<{ id: string; provider: string; supportsToolCalling: boolean }>>;
    cloud?: Record<string, Array<{ id: string; provider: string; supportsToolCalling: boolean }>>;
  };
  const ollama = [...Object.values(catalogo.local ?? {}), ...Object.values(catalogo.cloud ?? {})]
    .flat()
    .filter((m) => m.provider === 'ollama');
  const modelo = ollama.find((m) => m.supportsToolCalling) ?? ollama[0];
  if (!modelo) throw new Error('o catálogo não tem modelo ollama para o dublê ocupar');
  await chamar(`/workspaces/${sessao.workspaceId}/models/activate`, {
    method: 'POST',
    body: JSON.stringify({ modelIds: [modelo.id], isActive: true }),
  });
  await chamar(`/workspaces/${sessao.workspaceId}/model-binding`, {
    method: 'PUT',
    body: JSON.stringify({ modelId: modelo.id }),
  });
  return sessao;
}
