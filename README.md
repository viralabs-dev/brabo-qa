# brabo-qa

Testes que atravessam repositórios do Brabo: E2E de navegador, golden-sets, smoke das imagens de produção e os
instrumentos de medição (Jev, idioma). Extraído do monorepo `daneiel/brabo` (AT-703, ADR 0252). `#N` nos commits aponta
para `viralabs-dev/brabo-legacy`.

| Pasta | O que é |
| --- | --- |
| `e2e/` | Playwright (só chromium, ADR 0120). Lockfile próprio, **não** é membro de workspace. |
| `golden/engine/test/` | Golden-sets ExUnit (`qa_automacao_agent_golden_test.exs`, `rag_golden_test.exs`) e os `floor.json`. Rodam **dentro** do `brabo-engine` (o workflow os copia para `test/`) e chamam o seed do `brabo-api`. |
| `scripts/jev/`, `scripts/idioma/` | Instrumentos de medição. Leem e reexportam fontes de `brabo-api` e `brabo-engine` em checkout **irmão** (`../brabo-api`, `../brabo-engine`); nunca copiam. |
| `.github/workflows/golden-set-*.yml` | AGENDADOS (ADR 0138/0168), nunca em PR. Fazem checkout dos irmãos na `dev`. |

O roteiro do TP-01 mora no Vault (`personal/projetos/brabo/`), não aqui.

## CI de PR

`scripts` (typecheck + specs), `e2e` (typecheck), `actionlint` e a conferência dos caminhos dos irmãos.

## Fica para depois da AT-701 (não rodado na extração)

```bash
# E2E contra o compose de produção do brabo-infra
SMOKE_KEEP_UP=1 bash "${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh" && pnpm --dir e2e install && pnpm --dir e2e navegadores && pnpm --dir e2e test
# golden-sets (workflow_dispatch): gh workflow run golden-set-rag.yml / golden-set-qa.yml  -> exigem ≥ piso do floor.json
```
