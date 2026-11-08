import { expect, test } from '@playwright/test';
import { autenticar } from '../suporte/api.ts';
import { esperarGateAberto, semearExecucao, sessaoDaExecucao } from '../suporte/execucao.ts';
import { vereditoDeGate } from '../suporte/interno.ts';

/**
 * Veredito de QA e SecOps (RN-825): com o gate aberto pelo Noop, o parecer de
 * QA avança para o SecOps e o de SecOps libera a tarefa para o dono
 * (`awaiting_user`). Pelas rotas internas, as mesmas do engine; sem LLM.
 */
test('o veredito de QA leva a tarefa a awaiting_user e a tela mostra o gate', { tag: '@f-gates' }, async () => {
  test.setTimeout(240_000);
  const token = await autenticar();
  const exec = await semearExecucao(token, {
    modulos: [{ name: 'api' }],
    tarefas: [{ modulo: 'api', titulo: 'Veredito de gate' }],
  });
  const { taskId } = await esperarGateAberto(token, exec);

  const qa = (await vereditoDeGate(sessaoDaExecucao(exec), taskId, 'qa', 'approved')) as { nextAction?: string };
  expect(qa.nextAction, 'o QA aprovado devia avançar para o SecOps').toBe('run_secops');
  const secops = (await vereditoDeGate(sessaoDaExecucao(exec), taskId, 'secops', 'approved')) as {
    nextAction?: string;
    task?: { gateStatus?: string };
  };
  expect(secops.nextAction, 'o SecOps aprovado devia liberar ao dono').toBe('done');
  expect(secops.task?.gateStatus).toBe('awaiting_user');
});
