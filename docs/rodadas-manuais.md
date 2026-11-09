# Rodadas manuais e agendadas

O que roda sob demanda ou por agenda, fora do PR. O [README](../README.md) traz só o resumo.

## E2E de navegador (manual)

Roda contra o compose de produção do `brabo-infra`. Não roda no CI.

```bash
SMOKE_KEEP_UP=1 bash "${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh" && pnpm --dir e2e install && pnpm --dir e2e navegadores && pnpm --dir e2e test
```

## Golden-sets

Os dois são `workflow_dispatch` e agendados (ADR 0138/0168). Os agendados nunca rodam em PR. Os pisos ficam em `floor.json`, e a rodada precisa passar deles.

- **Golden-set do RAG** (`golden-set-rag.yml`): agendado todo dia às 06:00 UTC desde 05/11/2026. As duas rodadas agendadas até 06/11 falharam; a rodada manual de 06/11 com `api_ref` passou.
- **Golden-set do QA** (`golden-set-qa.yml`): agendado aos sábados, 01:17 UTC; ainda não teve rodada.

Para testar uma branch do `brabo-api` ou outra imagem do Ollama:

```bash
gh workflow run golden-set-rag.yml -R viralabs-dev/brabo-qa --ref dev -f api_ref=<branch> -f ollama_image=<imagem>
```
