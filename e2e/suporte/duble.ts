/**
 * Constantes do provider dublê da api (AT-815 R4, RN-1065): o roteiro
 * `llm-duble-roteiro.json` fala do agente `criativo` e das perguntas abaixo.
 * O dublê só existe no job do CI (`compose-duble.yml`, que o `e2e-pr.yml` passa
 * junto de `E2E_LLM_DUBLE=1`); fora dele as specs se pulam.
 */
export const DUBLE_LIGADO = process.env.E2E_LLM_DUBLE === '1';

/** `texto` do passo 0 do Criativo no roteiro. */
export const TEXTO_DO_PASSO_0 = 'Resposta do dublê em streaming: este texto chega como agent.delta antes da resposta final.';

/** Os `questionId` que o passo 1 do Criativo fecha com `answer_open_question`. */
export const PERGUNTAS_DO_ROTEIRO = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
