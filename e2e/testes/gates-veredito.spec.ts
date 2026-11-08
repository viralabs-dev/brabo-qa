import { test } from '@playwright/test';

// fixme: o veredito de QA muda a tarefa para awaiting_user so depois de o Noop abrir o gate
// (dev.awaiting_gate), que depende da AT-839 (Noop com action_settled, brabo-engine).
test.fixme('o veredito de QA leva a tarefa a awaiting_user e a tela mostra o gate', { tag: '@f-gates' }, async () => {});
