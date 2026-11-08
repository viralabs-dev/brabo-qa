/**
 * Rotas INTERNAS da api (`/internal/sessions/:s/...`), as mesmas que o engine
 * chama, autenticadas pelo token de serviço do run (AT-815 P3, RN-1064).
 *
 * O token é `E2E_SERVICE_TOKEN`, entregue SÓ ao passo das specs por
 * `scripts/ci/com-token-de-servico.sh`: aleatório por run, mascarado com
 * `::add-mask::`, nunca impresso nem gravado em artefato. Por isso nenhuma
 * mensagem de erro daqui ecoa cabeçalho, só o corpo da resposta.
 */
import { API_URL, type SessaoSemeada } from './api.ts';

type Sessao = Pick<SessaoSemeada, 'projectId' | 'sessionId'>;

function tokenDeServico(): string {
  const token = process.env.E2E_SERVICE_TOKEN;
  if (!token) {
    throw new Error(
      'E2E_SERVICE_TOKEN ausente: as rotas internas só rodam no CI (ou com o token do .env do compose local). Ver e2e/README.md.',
    );
  }
  return token;
}

export async function chamarInterno<T = Record<string, unknown>>(
  sessao: Sessao,
  rota: string,
  corpo: Record<string, unknown>,
): Promise<T> {
  const resposta = await fetch(`${API_URL}/internal/sessions/${sessao.sessionId}/${rota}`, {
    method: 'POST',
    headers: { 'x-brabo-service-token': tokenDeServico(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: sessao.projectId, ...corpo }),
  });
  const texto = await resposta.text();
  if (!resposta.ok) throw new Error(`POST /internal/.../${rota} respondeu ${resposta.status}: ${texto.slice(0, 500)}`);
  return JSON.parse(texto) as T;
}

export interface Modulo {
  name: string;
  stack?: string;
  responsibility?: string;
  dependsOn?: string[];
}

export const criarMapaDeModulos = (s: Sessao, modulos: Modulo[]) =>
  chamarInterno(s, 'module-map', {
    modules: modulos.map((m) => ({ stack: 'Node', responsibility: m.name, dependsOn: [], ...m })),
  });

export const criarEpico = (s: Sessao, title: string) => chamarInterno<{ id: string }>(s, 'epics', { title });

export const criarHistoria = (
  s: Sessao,
  epicId: string,
  title: string,
  businessRuleIds: string[],
) =>
  chamarInterno<{ id: string; status: string }>(s, 'stories', {
    epicId,
    title,
    rf: ['o módulo entrega o combinado'],
    dod: ['testes passando'],
    dor: ['regra definida'],
    businessRuleIds,
  });

export const ligarModulos = (s: Sessao, storyId: string, moduleIds: string[]) =>
  chamarInterno(s, 'story-modules', { storyId, moduleIds });

export const criarTarefa = (s: Sessao, storyId: string, title: string) =>
  chamarInterno<{ id: string }>(s, 'tasks', { storyId, title });

export const vereditoDeGate = (
  s: Sessao,
  taskId: string,
  gate: 'qa' | 'secops',
  veredito: 'approved' | 'changes_requested' | 'needs_user_decision',
  resumo = 'veredito semeado pelo E2E',
  itens: string[] = [],
) => chamarInterno(s, 'gates/verdict', { taskId, gate, veredito, resumo, itens });

export const ofertarHandoff = (s: Sessao, fromAgent: string, toAgent: string, artifactId?: string) =>
  chamarInterno(s, 'handoffs', { fromAgent, toAgent, artifactId });
