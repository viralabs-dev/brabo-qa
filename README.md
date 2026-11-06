# brabo-qa

Tests that cross repositories of Brabo: browser E2E, golden-sets, smoke of the production images and the
measurement instruments (Jev, language). Extracted from the `daneiel/brabo` monorepo (AT-703, ADR 0252). `#N` in the commits points
to `viralabs-dev/brabo-legacy`.

| Folder | What it is |
| --- | --- |
| `e2e/` | Playwright (chromium only, ADR 0120). Its own lockfile, **not** a workspace member. |
| `golden/engine/test/` | ExUnit golden-sets (`qa_automacao_agent_golden_test.exs`, `rag_golden_test.exs`) and the `floor.json` files. They run **inside** `brabo-engine` (the workflow copies them to `test/`) and call the seed of `brabo-api`. |
| `scripts/jev/`, `scripts/idioma/` | Measurement instruments. They read and re-export sources from `brabo-api` and `brabo-engine` in a **sibling** checkout (`../brabo-api`, `../brabo-engine`); they never copy. |
| `.github/workflows/golden-set-*.yml` | SCHEDULED (ADR 0138/0168), never on PR. They check out the siblings on `dev`. |

The TP-01 script lives in the Vault (`personal/projetos/brabo/`), not here.

## PR CI

`scripts` (typecheck + specs), `e2e` (typecheck), `actionlint` and the check of the sibling paths.

## Left for after AT-701 (not run during the extraction)

```bash
# E2E contra o compose de produção do brabo-infra
SMOKE_KEEP_UP=1 bash "${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh" && pnpm --dir e2e install && pnpm --dir e2e navegadores && pnpm --dir e2e test
# golden-sets (workflow_dispatch): gh workflow run golden-set-rag.yml / golden-set-qa.yml  -> exigem ≥ piso do floor.json
# para testar uma branch do brabo-api e/ou outra imagem do Ollama:
gh workflow run golden-set-rag.yml -R viralabs-dev/brabo-qa --ref dev -f api_ref=<branch> -f ollama_image=<imagem>
```
