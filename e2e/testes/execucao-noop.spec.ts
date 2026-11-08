import { expect, test } from '@playwright/test';
import { autenticar } from '../suporte/api.ts';
import { aprovarAcoesAte, semearExecucao } from '../suporte/execucao.ts';

/**
 * Prova da infraestrutura comum da AT-815 R1: o Noop (dev agent sem LLM) roda
 * no compose de instalação com repo local, e a tarefa semeada pelas rotas
 * internas vira PR. `dev.awaiting_gate` é o evento que o Noop emite DEPOIS de
 * a PR abrir (`noop_dev_agent_server.ex`), então prova repo, worktree, commit,
 * push e PR de uma vez. O push e a PR são ações de efeito externo (RN-689), que o usuário aprova: `aprovarAcoesAte` faz esse gesto. Sem navegador: não gasta login do balde do lockout.
 */
test('a execução Noop pega a tarefa e abre a PR, sem LLM', { tag: '@f-execucao' }, async () => {
  test.setTimeout(180_000);
  const token = await autenticar();
  const exec = await semearExecucao(token, {
    modulos: [{ name: 'api' }],
    tarefas: [{ modulo: 'api', titulo: 'Endpoint de cadastro' }],
  });

  const trabalhando = await aprovarAcoesAte(token, exec, 'dev.working', 90_000);
  expect(trabalhando.payload.taskId).toBe(exec.tarefaIds[0]);
  const aguardando = await aprovarAcoesAte(token, exec, 'dev.awaiting_gate', 120_000);
  expect(aguardando.payload.taskId).toBe(exec.tarefaIds[0]);
});
