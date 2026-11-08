# Regressivo por funcionalidade

Desde a AT-769, o `brabo-qa` organiza o E2E por **funcionalidade do Brabo**, e não só por spec. O objetivo é que toda PR que mexe
numa funcionalidade ateste que ela não foi afetada, sem virar um limitante. Esta página descreve a parte que mora aqui: o catálogo,
o mapa de caminhos, a ligação com as specs e o validador. O gatilho e a seleção moram no `brabo-ci`.

## O catálogo: `funcionalidades.yml`

Um único arquivo na raiz, com as 16 funcionalidades e o mapa caminho → funcionalidade. Cada entrada tem:

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
credencial) `aprovacoes` (parcial: decisão inline) e `execucao` (a prova do Noop, AT-815 R1). As outras ainda não têm spec e aparecem como **sem cobertura**, o que não reprova.

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

## O relatório de decisão do run (AT-791)

Cada run do `e2e-pr` termina com um relatório que compõe a decisão de aprovar ou não. A fonte é **um JSON v1** (`relatorio-regressivo.json`) montado por `scripts/ci/relatorio.ts` a partir do `resultado.json` do Playwright; o Markdown (Summary, texto do check e comentário da PR) é sempre derivado dele.

- **Grafo do run:** os jobs `Funcionalidade · <id>` (um por funcionalidade com spec executada) são só de **exibição**: não sobem compose, não têm token nem checkout de PR e saem vermelhos se a funcionalidade falhou (flaky vira aviso). O portão continua no `fechar`. Funcionalidade "sem cobertura" não vira job.
- **Summary** do job `Rodar o E2E` (step `Relatório`, `if: always()`): cabeçalho com veredito e recomendação, motivos (de onde veio cada funcionalidade), tabela por funcionalidade, falhas sem ANSI (arquivo:linha, tentativas, 15 linhas do erro), flaky, `<details>` por funcionalidade, digests e Vínculos. Até 900 KB.
- **Balde "sem funcionalidade":** a spec sem tag `@f-*` (e o `setup`, marcado "(preparação)") nunca some e reprova como qualquer outra.
- **Anotações:** o reporter `github` do Playwright (`--reporter=list,github,html,json`) anota cada spec que falhou (10 `error` por step, 50 por job; o Summary é a lista completa).
- **Artefatos:** `relatorio-regressivo-<run>` (`.md` e `.json`), `relatorio-html-<run>` (o `playwright-report/`, à parte do zip `e2e-<run>`; abre com `npx playwright show-report`) e o `e2e-<run>`.
- **Check:** o `fechar` passa o JSON ao `montarCheck` do brabo-ci (que devolve `summary` e `text`, 65 535 caracteres cada, com aviso de corte) e envia o `text`. O job `e2e` entrega ao `fechar` só um resumo compacto (até 300 specs, erro até 1000 caracteres) e o `fechar` o **sanitiza**: ids do catálogo, números no intervalo, texto sem ANSI e sem `|`, crase, `<` nem `@menção`.
- **Comentário fixo na PR de origem** (decisão do dono, 07/11/2026): um só, marcado `<!-- relatorio-regressivo -->` e escrito por bot, **criado só quando o run é vermelho** e editado a cada run (vira verde se já existia). Exige `issues: write` no token do App do `fechar`. Falhar em comentar só gera aviso.
- **Recomendação** (RN-1051): verde aprova (flaky, com aviso); `digest` e `assinatura` bloqueiam; `spec` em funcionalidade que a PR toca (pelos `motivos` do payload) bloqueia; `spec` fora da mudança ou "sem funcionalidade" aceita com justificativa; `ambiente` e `sem-resposta` mandam rodar de novo. Na `dev` o texto leva "atestado (não bloqueia)". Sem `motivos` no portão da `main`, bloqueia por cautela.
- **Payload:** `motivos` (`{id: [caminhos]}`, até 50 ids, 5 caminhos de 200 caracteres) e `semDono` (até 20) são opcionais e nunca reprovam o payload (`validarMotivos`); o qa antigo os ignora.
- **Payload, forma nova:** o GitHub aceita no máximo 10 propriedades no `client_payload`, então o `brabo-ci` agrupa as três chaves em `selecao: {motivos, semDono, tocadas}`. O `e2e-pr.yml` (`RAW_SELECAO`) e o `validar-payload.ts` aceitam `selecao` e, por compatibilidade, as chaves soltas; se vierem as duas, vale `selecao`.

## Vínculos no run (AT-773)

Cada run do `e2e-pr` mostra de onde veio: o `run-name` é `E2E ← brabo-api#48 · a1b2c3d · autor · c=<run_id>-<attempt>` (`Regressivo ← ...` na dev). A
`c=` é a correlação que o gatilho procura para achar este run. O job `anunciar` aponta o check da PR para o run do brabo-qa assim que ele começa
(o `fechar` o conclui) e nunca reprova. A action `vinculos` do `brabo-ci` escreve a tabela `## Vínculos` e o Mermaid no Summary de `e2e-pr` (jobs
`e2e`, `anunciar`, `fechar`), `golden-set-*`, `ci` e `varrer-orfaos`. No `fechar` o `vinculos.md` entra no resumo do check, e o
`alarmar-prova.sh` o anexa à issue (`VINCULOS_MD`). Uma `origem` inválida no payload é descartada com aviso, nunca reprova.

## Infraestrutura comum das specs (AT-815 R1, RN-1064)

**RN-1064.** As specs do E2E semeiam estado só por estes caminhos, sem LLM e sem tocar o banco:

1. **Evento pela rota pública.** `e2e/suporte/eventos.ts` (`anexarEvento`, `eventosDaSessao`, `esperarEvento`): `POST .../sessions/:s/events` com o Bearer do login de semeadura. Semeia o que o log guarda (`agent.response`, `question.opened`, `dev.idle_tripped`...).
2. **Rotas internas pelo token de serviço.** `e2e/suporte/interno.ts`: mapa de módulos, épico, história, tarefa, veredito de gate e handoff, pelas mesmas rotas e use cases que o engine usa (cabeçalho `x-brabo-service-token`). O token é o `BRABO_SERVICE_TOKEN` que o PRÓPRIO job gerou no `.env` do compose (aleatório por run). O `scripts/ci/com-token-de-servico.sh` o lê, o mascara com `::add-mask::` e o entrega como `E2E_SERVICE_TOKEN` só ao processo do Playwright. Ele nunca é impresso nem gravado em artefato (decisão P3 do dono, 08/11/2026), e `com-token-de-servico.spec.ts` prova que só o comando de máscara o contém no log. Sem a variável, o helper lança, e a spec que o usa só roda no CI.
3. **Execução sem LLM.** `e2e/suporte/execucao.ts` (`semearExecucao`): repo local, mapa, regra de negócio, história `ready` ligada ao módulo, tarefa e ativação com `devAgentImpl: 'noop'`. O `execucao-noop.spec.ts` (`@f-execucao`) é a prova: `dev.working` e `dev.awaiting_gate` (emitido só depois de a PR abrir) chegam no log da sessão de execução.
4. **Um login de navegador por arquivo.** `contextoLogado(browser)` em `e2e/suporte/navegador.ts`, no `beforeAll` de um `describe.configure({ mode: 'serial' })`; cada chamada custa um login do balde do lockout por IP.
5. **Pendência (AT-833).** O `execucao-noop.spec.ts` está em `test.fixme`: o Noop cai na guarda de container da RN-502 (`dev.blocked_by_container`, sem container `running` no compose de instalação). Volta quando o engine dispensar a guarda para o Noop.

**Catálogo (decisão P4).** Os ids `execucao` (dev agents, disjuntor, Rearmar, execução parada, aba Executores) e `chat-e-pendencias` (fio, pendências, perguntas em aberto) cobrem arquivos que antes só rodavam o smoke. `projetos` perdeu o glob `lib/engine/dev`, agora de `execucao`. `AvisoDePrPronta` e `DestravarExecucao` entram no glob quando chegarem à `dev`.

## Rodar de novo (AT-790, RN-1067)
**RN-1067.** O "Fechar o check" aceita reexecução. Se o check do `check_run_id` já está `completed` (rodar de novo os jobs que falharam no mesmo run), o `fechar-check.ts` não o reabre: cria um check run NOVO com o mesmo nome e o mesmo `head_sha` e o fecha com o resultado novo; o GitHub mostra o mais recente e a PR fica com o resultado atual. O Summary diz que houve reexecução e cita o check anterior, que não é alterado. As defesas valem igual para `in_progress` e `completed`: nome esperado (`E2E do brabo-qa` ou `Regressivo do brabo-qa`), `head_sha` validado e check do nosso App. O token do App já leva `checks: write` no repo de origem (o POST usa o mesmo). Antes disso, a reexecução passava o E2E e falhava com `check não tocado: status inesperado: completed`.
