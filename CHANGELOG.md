# Changelog

## Unreleased

- Extração de `e2e/`, `docker/smoke.sh`, `scripts/jev/`, `scripts/idioma/`, dos workflows `golden-set-qa.yml` e `golden-set-rag.yml` e dos golden-sets ExUnit (com os `floor.json`) do monorepo `daneiel/brabo` (AT-703, ADR 0252), com o histórico dos caminhos.
- Golden-sets agora fazem checkout de `brabo-api`, `brabo-engine` e `brabo-broker` (`dev`) e copiam os testes para o engine; os `mix golden_set.*` viraram `mix test --only golden_set_*`. Imagens `pgvector`/`ollama` por digest literal (o compose é do `brabo-infra`).
- `scripts/idioma` e `scripts/jev` leem os irmãos em `../brabo-api` e `../brabo-engine`.
- `docker/smoke.sh` lê o compose de `BRABO_INFRA_DIR`.
- Lacunas: E2E contra o compose do `brabo-infra` e golden-set ≥ piso não foram rodados (dependem da AT-701); sem Dockerfile, o Dependabot `docker` não se aplica.
