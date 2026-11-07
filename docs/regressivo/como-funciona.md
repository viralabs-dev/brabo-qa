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

## O que roda aqui: `modo` e a tabela por funcionalidade (Rodada B)

O `e2e-pr.yml` tem dois modos, escolhidos pelo payload (`modo`) ou pelo input do ensaio manual:

| Modo | Quando | O que roda | Check |
| --- | --- | --- | --- |
| `completo` (padrão) | portão da `main`; payload sem `modo` | todas as specs, sem filtro: comportamento idêntico ao de antes | `E2E do brabo-qa` |
| `funcionalidades` | PR para a `dev`; `funcionalidades` = ids do catálogo | só as specs com `@f-<id>`: `--grep "@f-(a\|b)( \|$)"` (a tag fecha em espaço ou fim, então `@f-git` não casa `@f-git-hub`) | `Regressivo do brabo-qa` |

`validar-payload.ts` valida o modo (`completo`, `funcionalidades`), os ids (kebab-case, até 50) e monta o `GREP`; modo desconhecido ou
`funcionalidades` sem id reprova o payload (vira `ambiente`). O `fechar-check.ts` fecha o check pelo nome em que o gatilho o criou.

Depois das specs, `scripts/ci/cobertura.ts` cruza `funcionalidades.yml` (da `dev`) com o `resultado.json` do Playwright (as tags aparecem
sem o `@`) e o resumo do check ganha `funcionalidade | specs | resultado`: `verde`, `vermelho` ou `sem cobertura` (funcionalidade ativa sem spec;
**não reprova**). No modo `funcionalidades` a tabela lista só os ids pedidos. Se a suíte não produziu `resultado.json`, não há tabela. O
resultado vem de PR, então o `fechar` só aceita linhas com id do catálogo e números válidos. Ensaio manual:

```bash
gh workflow run e2e-pr.yml -R viralabs-dev/brabo-qa -f modo=funcionalidades -f funcionalidades=autenticacao,aprovacoes -f repo=... 
```

## Vínculos no run (AT-773)

Cada run do `e2e-pr` mostra de onde veio: o `run-name` é `E2E ← brabo-api#48 · a1b2c3d · autor · c=<run_id>-<attempt>` (`Regressivo ← ...` na dev). A
`c=` é a correlação que o gatilho procura para achar este run. O job `anunciar` aponta o check da PR para o run do brabo-qa assim que ele começa
(o `fechar` o conclui) e nunca reprova. A action `vinculos` do `brabo-ci` escreve a tabela `## Vínculos` e o Mermaid no Summary de `e2e-pr` (jobs
`e2e`, `anunciar`, `fechar`), `golden-set-*`, `ci` e `varrer-orfaos`. No `fechar` o `vinculos.md` entra no resumo do check, e o
`alarmar-prova.sh` o anexa à issue (`VINCULOS_MD`). Uma `origem` inválida no payload é descartada com aviso, nunca reprova.
