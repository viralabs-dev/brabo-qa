import { test } from '@playwright/test';

// fixme: o merge com conflito (RN-715) precisa de duas PRs do Noop, e o Noop nunca chega a
// dev.awaiting_gate sem a clausula action_settled (AT-839, brabo-engine).
test.fixme('o merge com conflito vira git_merge failed com a lista de arquivos', { tag: '@f-git' }, async () => {});
