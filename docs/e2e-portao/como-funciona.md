# O E2E do brabo-qa como portão da main

Desde a AT-765, toda PR para a `main` do `brabo-api`, `brabo-engine`, `brabo-web`, `brabo-broker`, `brabo-infra` e `brabo-qa`
só entra com o check **`E2E do brabo-qa`** verde (ruleset "main exige E2E"). O `brabo-contracts` não participa.

## O fluxo

1. A PR para a `main` abre (ou recebe um push). O reutilizável `qa-e2e-gatilho.yml` do `brabo-ci` escolhe as tags `-dev.N`
   do head, resolve o digest das cinco imagens (`api`, `engine`, `web`, `broker`, `backup`), cria o check `E2E do brabo-qa`
   em andamento e dispara o evento `e2e-pr` neste repositório.
   Sem tag `-dev` apontando para o head, o check nasce vermelho por `ambiente`, com a mensagem dizendo qual tag falta.

   <!-- print P1 -->

2. O `e2e-pr.yml` espera as imagens existirem no GHCR (até 30 min, consultando a cada 30 s: a tag pode ainda estar sendo carimbada)
   e verifica a assinatura de cada digest com `cosign`.

   <!-- print P2 -->

3. Sobe o `docker/docker-compose.install.yml` do `brabo-infra` com `BRABO_*_IMAGE` igual aos digests e segredos novos por run,
   e confere que cada container roda o digest esperado. Divergência é vermelho por `digest` e o run para ali.

   <!-- print P3 -->

4. Roda as specs do Playwright (`e2e/`) contra o compose. Na PR do próprio `brabo-qa` valem as specs do `head_sha`;
   nas demais, as da `dev`.

   <!-- print P4 -->

5. O `fechar-check` fecha o check na PR de origem com a tabela `serviço | digest esperado | digest em execução | assinatura`.
   Os relatórios do Playwright, `digests.json` e os logs dos containers ficam como artefato do run.

   <!-- print P5 -->

## Causas de vermelho

| causa | significado | aceitável com justificativa? |
|---|---|---|
| `spec` | uma spec do E2E falhou | sim |
| `ambiente` | imagem ausente, compose que não subiu, head sem tag `-dev` | sim |
| `digest` | um container roda outra imagem que a verificada | nunca |
| `assinatura` | o `cosign verify` falhou | nunca |
| `sem-resposta` | o check ficou em andamento por mais de 90 min (fechado por `varrer-orfaos.yml`, de hora em hora) | não: rode de novo |

## Aceitar com justificativa

Só o `OWNER_HANDLE` comenta na PR `/qa-aceitar <justificativa>` (mínimo de 20 caracteres), e só com o check do head atual
vermelho por `spec` ou `ambiente`. O check vira verde com o título `Aceito com justificativa`, a PR ganha a label
`qa-aceito-com-justificativa` e o resumo registra a justificativa, quem aceitou, quando e o link do run vermelho.
Comentário editado, comentário de review e segundo `/qa-aceitar` no mesmo head são ignorados ou recusados.

<!-- print P6 -->

## Ensaio manual

`workflow_dispatch` do `e2e-pr.yml` com os mesmos campos do payload (`repo`, `pr`, `head_sha`, `check_run_id`, `compose_ref`, `imagens`).
