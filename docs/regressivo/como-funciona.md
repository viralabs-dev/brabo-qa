# Regressivo por funcionalidade

Desde a AT-769, o `brabo-qa` organiza o E2E por **funcionalidade do Brabo**, e não só por spec. O objetivo é que toda PR que mexe
numa funcionalidade ateste que ela não foi afetada, sem virar um limitante. Esta página descreve a parte que mora aqui: o catálogo,
o mapa de caminhos, a ligação com as specs e o validador. O gatilho e a seleção moram no `brabo-ci`.

## O catálogo: `funcionalidades.yml`

Um único arquivo na raiz, com as 14 funcionalidades e o mapa caminho → funcionalidade. Cada entrada tem:

| Campo | Significado |
| --- | --- |
| `id` | kebab-case, estável, **nunca renomeado**. Para aposentar, `status: aposentada`. |
| `nome`, `descricao` | texto para o resumo do check. |
| `tema` | tema do ADR (`docs/adr/temas.yml` do `brabo`). |
| `status` | `ativa` ou `aposentada`. |
| `caminhos` | globs por repo (chave = nome sem o prefixo `brabo-`), relativos à raiz do repo. |

O catálogo mora aqui, e não no `brabo-contracts`, porque o contracts é consumido por TAG (cada ajuste do mapa viraria tag e bump em
vários consumidores) e o catálogo é da QA. Regras de arquivo transversal (só docs, lockfile, arquivo sem dono) não moram aqui: ficam
no script de seleção do `brabo-ci`.

## A spec se liga por tag

O Playwright do lockfile (`@playwright/test` 1.62.1) aceita o detalhe `{ tag }` no `test` e no `test.describe`. Cada spec leva a tag
`@f-<id>` da funcionalidade que cobre, e o filtro é `--grep @f-<id>`:

```ts
test('o canal da sessão sobe com ticket na query', { tag: '@f-sessao-e-canal' }, async ({ page }) => { /* ... */ });
```

Não há lista de arquivos no catálogo. Hoje: `autenticacao`, `sessao-e-canal`, `turno-do-agente` (parcial: só o desfecho de falha por
credencial) e `aprovacoes` (parcial: decisão inline). As outras ainda não têm spec e aparecem como **sem cobertura**, o que não reprova.

## O validador

`scripts/ci/funcionalidades.ts` (spec: `funcionalidades.spec.ts`, roda no `pnpm test` do CI de PR). Reprova:

- `id` repetido ou fora de kebab-case, ou `status` inválido;
- glob que não casa nenhum arquivo do repo irmão (mapa podre);
- tag `@f-<id>` numa spec sem entrada no catálogo.

Lista, sem reprovar, as funcionalidades ativas sem spec. Os irmãos são achados ao lado do checkout: no CI, `qa/` fica ao lado de
`brabo-api/` e `brabo-engine/`; localmente, `../brabo-<repo>`. `BRABO_IRMAOS_DIR` sobrescreve a pasta. O repo `qa` é o próprio
checkout. **Repo irmão ausente não reprova: aparece em "repos não verificados"** (hoje o CI só faz checkout de api e engine, então os
globs de web, runner, broker e infra só são provados em máquina com os clones lado a lado).

```bash
BRABO_IRMAOS_DIR=~/dev/brabo node scripts/ci/funcionalidades.ts   # relatório + saída 1 se houver erro
pnpm --dir scripts exec vitest run ci/funcionalidades.spec.ts
```

## Como mudar

- **Funcionalidade nova ou caminho novo:** edite `funcionalidades.yml` e rode o validador. Id nunca muda.
- **Spec nova:** arquivo próprio em `e2e/testes/` com a tag `@f-<id>`.
- **PR de produto que toca uma funcionalidade:** ajusta o regressivo dela aqui, contra a `dev`, ou diz no card por que não precisa.
- O check `Regressivo do brabo-qa` (PR para a `dev`) só atesta e **nunca é exigido**; o `E2E do brabo-qa` na `main` roda o catálogo
  inteiro (ver `docs/e2e-portao/como-funciona.md`).
