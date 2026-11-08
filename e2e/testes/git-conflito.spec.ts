import { test } from '@playwright/test';

// fixme: o merge com conflito (RN-715) precisa de duas PRs que mexam no MESMO arquivo, e o Noop
// grava um arquivo por tarefa (`NOOP-task-<id>.md`), então duas PRs dele nunca conflitam. O
// engine#64 (AT-839) já deixa o Noop chegar a dev.awaiting_gate; falta um jeito de a spec empurrar
// um commit conflitante no repositório local do projeto.
test.fixme('o merge com conflito vira git_merge failed com a lista de arquivos', { tag: '@f-git' }, async () => {});
