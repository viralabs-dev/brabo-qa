# brabo-qa

Testes que atravessam repositórios do Brabo: E2E de navegador, golden-sets, smoke das imagens de produção e os
instrumentos de medição (Jev, idioma). Extraído do monorepo original, hoje
[`brabo-legacy`](https://github.com/viralabs-dev/brabo-legacy) (AT-703, ADR 0252); `#N` nos commits aponta para lá.

| Pasta | O que é |
| --- | --- |
| `e2e/` | Playwright (só chromium, ADR 0120). Lockfile próprio, **não** é membro de workspace. |
| `golden/engine/test/` | Golden-sets ExUnit (`qa_automacao_agent_golden_test.exs`, `rag_golden_test.exs`) e os `floor.json`. Rodam **dentro** do `brabo-engine` (o workflow os copia para `test/`) e chamam o seed do `brabo-api`. |
| `scripts/jev/`, `scripts/idioma/` | Instrumentos de medição. Leem e reexportam fontes de `brabo-api` e `brabo-engine` em checkout **irmão** (`../brabo-api`, `../brabo-engine`); nunca copiam. |
| `.github/workflows/golden-set-*.yml` | AGENDADOS (ADR 0138/0168), nunca em PR. Fazem checkout dos irmãos na `dev`. |

O roteiro do TP-01 mora no Vault (`personal/projetos/brabo/`), não aqui.

## CI de PR

`scripts` (typecheck + specs), `e2e` (typecheck), `actionlint` e a conferência dos caminhos dos irmãos.

## E2E como portão da main (AT-765)

As PRs para a `main` de `brabo-api`, `-engine`, `-web`, `-broker`, `-infra` e deste repo só entram com o check `E2E do brabo-qa` verde.
O `e2e-pr.yml` roda o Playwright contra o `docker-compose.install.yml` do `brabo-infra` sobre as imagens por digest (assinatura verificada,
digest em execução conferido) e fecha o check na PR de origem; o `varrer-orfaos.yml` fecha, de hora em hora, o que ficou sem resposta por 90 min.
`/qa-aceitar <justificativa>` (só o dono) aceita um vermelho por `spec`, `ambiente` ou `sem-resposta`. O `e2e-pr.yml` tem dois jobs: `e2e` executa código de PR e não tem token do App; `fechar` (checkout limpo da `dev`) revalida o payload e só então cria o token do App, com `checks: write` apenas no repo validado. Esse token mas escrita no brabo-qa equivale a poder aprovar o portão: trate o acesso de escrita aqui como o de um aprovador. Detalhes e prints: [`docs/e2e-portao/como-funciona.md`](docs/e2e-portao/como-funciona.md).

## Regressivo por funcionalidade (AT-769)

`funcionalidades.yml` lista as 14 funcionalidades do Brabo e mapeia caminhos de cada repo para elas; as specs de `e2e/testes/` se ligam por tag `@f-<id>`. O validador (`scripts/ci/funcionalidades.ts`) roda no `pnpm test` de `scripts/`: reprova id repetido, glob que não casa arquivo nos repos irmãos e tag sem funcionalidade; funcionalidade sem spec aparece como "sem cobertura" e não reprova. Detalhes: [`docs/regressivo/como-funciona.md`](docs/regressivo/como-funciona.md).

## O que já roda e o que ainda é manual

- **Golden-set do RAG** (`golden-set-rag.yml`): agendado todo dia às 06:00 UTC desde 05/11/2026. As duas
  rodadas agendadas até 06/11 falharam; a rodada manual de 06/11 com `api_ref` passou.
- **Golden-set do QA** (`golden-set-qa.yml`): agendado aos sábados, 01:17 UTC; ainda não teve rodada.
- **E2E de navegador** (`e2e/`): só manual, contra o compose de produção do `brabo-infra`; não roda no CI.

```bash
# E2E contra o compose de produção do brabo-infra
SMOKE_KEEP_UP=1 bash "${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh" && pnpm --dir e2e install && pnpm --dir e2e navegadores && pnpm --dir e2e test
# golden-sets (workflow_dispatch): gh workflow run golden-set-rag.yml / golden-set-qa.yml  -> exigem ≥ piso do floor.json
# para testar uma branch do brabo-api e/ou outra imagem do Ollama:
gh workflow run golden-set-rag.yml -R viralabs-dev/brabo-qa --ref dev -f api_ref=<branch> -f ollama_image=<imagem>
```

## Repositórios do Brabo

O Brabo é dividido em repositórios por camada (ADR 0252), e a documentação central está no
[brabo](https://github.com/viralabs-dev/brabo) e em https://viralabs-dev.github.io/brabo/prd/.

**Depende de:** [brabo-ci](https://github.com/viralabs-dev/brabo-ci), [brabo-api](https://github.com/viralabs-dev/brabo-api), [brabo-engine](https://github.com/viralabs-dev/brabo-engine), [brabo-broker](https://github.com/viralabs-dev/brabo-broker), [brabo-infra](https://github.com/viralabs-dev/brabo-infra).

**É usado por:** [brabo](https://github.com/viralabs-dev/brabo) (layout da documentação).

| Repositório | Papel |
| --- | --- |
| [brabo](https://github.com/viralabs-dev/brabo) | Porta de entrada: documentação central, instalador (`install.sh`) e release do produto. |
| [brabo-api](https://github.com/viralabs-dev/brabo-api) | API (NestJS, Drizzle, PostgreSQL com pgvector). |
| [brabo-engine](https://github.com/viralabs-dev/brabo-engine) | Engine (Elixir/OTP, Phoenix, Oban): agentes, gates, sessões e runners. |
| [brabo-web](https://github.com/viralabs-dev/brabo-web) | Interface web (React, Vite, TanStack, Tailwind). |
| [brabo-runner](https://github.com/viralabs-dev/brabo-runner) | CLI que roda na máquina do usuário e se conecta à engine. |
| [brabo-broker](https://github.com/viralabs-dev/brabo-broker) | Broker de containers: o único processo que fala com o Docker do servidor. |
| [brabo-contracts](https://github.com/viralabs-dev/brabo-contracts) | Contratos compartilhados (`shared`, `docker-port`, `contracts`). |
| [brabo-infra](https://github.com/viralabs-dev/brabo-infra) | Composes, Kubernetes, backup e restore, `docker-bake.hcl` e as aferições cruzadas. |
| [brabo-ci](https://github.com/viralabs-dev/brabo-ci) | Workflows reutilizáveis: política de PR, escada de aprovação, promoção e carimbo de versão. |
| [brabo-qa](https://github.com/viralabs-dev/brabo-qa) | Testes entre repositórios: E2E de navegador, golden-sets e instrumentos de medição. |
| [brabo-workspace](https://github.com/viralabs-dev/brabo-workspace) | Pasta-mãe que reúne os clones `brabo-*` lado a lado. |

## Apoie

Se o projeto te ajuda, você pode [pagar um café no Ko-fi](https://ko-fi.com/daneiel).
