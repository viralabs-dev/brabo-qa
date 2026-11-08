# E2E de navegador

A quarta camada da pirâmide. As três de baixo já rodam com `pnpm test`;
esta precisa de um **navegador de verdade** e do **compose de produção de
pé**, porque o que ela prova só existe lá.

Decisão completa: [ADR 0120](../docs/adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md).

## Como rodar

```bash
pnpm e2e:navegadores                      # uma vez: baixa o chromium
SMOKE_KEEP_UP=1 bash "${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh"      # sobe o stack e DEIXA de pé
pnpm e2e                                  # roda os specs contra ele
docker compose -f docker/docker-compose.prod.yml down -v
```

Da raiz, sempre por `pnpm e2e` / `pnpm --dir e2e ...`. **`pnpm --filter e2e`
não funciona** — e não é bug, é o desenho abaixo.

## Por que fora do workspace

`e2e/` tem `pnpm-workspace.yaml` e `pnpm-lock.yaml` próprios, instalados com
`pnpm install` de dentro desta pasta. É o mesmo desenho do `website/`
([ADR 0117](../docs/adr/0117-lockfile-proprio-para-o-website.md)), pelo mesmo
motivo: a árvore do Playwright não chega a imagem nenhuma, e deixá-la no
lockfile da raiz faria o `pnpm audit` do produto reportar ferramenta de teste
como se fosse superfície do que embarca.

Que este pacote TESTE o produto não muda o argumento — o que decide é para
onde a dependência **vai**, não sobre o que ela fala.

## O que estes testes provam, e por que só aqui

| mecanismo | por que jsdom não alcança |
|---|---|
| refresh em cookie `httpOnly` | `httpOnly` é garantia do BROWSER; em jsdom o cookie seria legível e a asserção passaria mentindo |
| CSRF + origem cruzada (`:8088` → `:3000`) | não há origem de verdade nem preflight — o `main.ts` da api registra: "teste não faz preflight" |
| sessão que sobrevive ao reload | é o único jeito de provar que o access em memória foi RECONSTRUÍDO do cookie, e não que nunca sumiu |
| ticket de uso único do socket (RN-108) | exige handshake de WebSocket real contra o engine, numa TERCEIRA origem |
| o CICLO do turno pelo canal (`turno-pelo-canal.spec.ts`, AT-338) | o `agent.status` (`working`, depois `idle`) e o `agent.error` só existem como frames do WebSocket real que a página abriu com o ticket de uso único, contra o engine numa TERCEIRA origem; a suite do web dubla o canal. O spec lê os FRAMES (`framereceived`) do tópico `session:<id>`, na ordem, e a bolha de falha pelo seletor estrutural `data-testid="falha-de-turno"` com `data-origem` |
| a aprovação INLINE (`aprovacao-inline.spec.ts`, AT-068) | a decisão sai do `ApprovalCard` do chat da sessão como POST cruzado `:8088` → `:3000`, com o `Authorization` do access que a página reconstruiu do cookie httpOnly pelo double-submit; jsdom não tem preflight nem origem, e a suite do web testa o card com a api dublada. O spec asserta a REQUISIÇÃO observada (origem, Bearer, 201 com `denied`, refresh fora dela) e a FILA pela api — nunca o card sumindo |

A medição da AT-068 corrigiu o enunciado da aprovação inline: o POST de
DECISÃO **não** leva CSRF. `X-CSRF-Token` só é exigido nas rotas de `/auth`
(`apps/api/src/interfaces/http/auth/session-cookies.ts`: o access fica fora do
cookie justamente para não exigir CSRF em toda rota autenticada). O CSRF que o
spec prova é o do `POST /auth/refresh` que dá à página o access com que ela
decide; a decisão prova o CORS cruzado com `Authorization`.

## Convenções

- **Seletor estrutural, nunca texto.** O idioma da interface é decisão do
  SERVIDOR; um teste preso a "Sign in" quebraria ao mudar o idioma da conta,
  e essa falha não fala sobre o produto.
- **Asserção sobre mecanismo, não sobre tela.** Um indicador de "conectado"
  muda de cor, rótulo e idioma sem que o socket mude nada.
- **Semeadura por HTTP** (`suporte/api.ts`), espelhando `${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh`. O
  navegador é caro, e preparo lento é preparo que fica desligado.

## Só UM spec por execução pode usar o estado do `setup`

O `brabo_refresh` gravado em `suporte/.estado-autenticado.json` vale **uma
vez**. `RefreshUseCase` rotaciona e tem **detecção de reuso**, que revoga a
FAMÍLIA inteira — então um segundo contexto de navegador carregando o app com
o mesmo cookie não apenas falha: ele derruba a sessão para todos os specs
seguintes, que passam a cair no login.

A punição é enganosa, como a do lockout: o spec vermelho é o **próximo** da
ordem alfabética, e ele acusa o mecanismo dele (um socket que não subiu),
nunca o cookie. Foi assim que apareceu, ao acrescentar
`chave-de-dispositivo.spec.ts` — o spec da chave gerada no NAVEGADOR, que saiu
junto com aquele fluxo no ADR 0203 (ver abaixo).

Regra prática: quem precisa de sessão de NAVEGADOR fica com o estado
(`socket-da-sessao.spec.ts`); quem só precisa da ORIGEM `:8088` e fala com a
api por Bearer opta por sair, com
`test.use({ storageState: { cookies: [], origins: [] } })` e um comentário
dizendo por quê — são DOIS motivos diferentes de optar por sair, e o de
`autenticacao.spec.ts` (precisa de origem limpa para provar o login) não é
este.

Há uma TERCEIRA saída, para quem precisa de sessão de navegador e não pode
ficar com o estado: `aprovacao-inline.spec.ts` roda ANTES de
`socket-da-sessao.spec.ts` na ordem alfabética, então usar o estado ali
derrubaria o socket. Ele opta por sair e injeta no contexto os cookies do
login de SEMEADURA (`cookiesDaSemeadura()` em `suporte/api.ts`) — o mesmo login
memoizado de `autenticar()`, cujo refresh a semeadura nunca usa, porque ela
fala só por Bearer. Não custa login a mais, e vale a MESMA regra: uma vez.
`cookiesDaSemeadura()` LANÇA na segunda chamada, nomeando o motivo, para que
um segundo consumidor quebre onde está, e não no spec seguinte.

A QUARTA, quando as três já têm dono: `turno-pelo-canal.spec.ts` (AT-338) roda
depois de todos e precisa de sessão de navegador. Ele opta por sair e faz um
login PRÓPRIO (`cookiesDeUmLoginProprio()`), que NÃO é memoizado — memoizar
entregaria o mesmo refresh a dois consumidores. Custa um login do balde do
lockout, contado abaixo.

## Qual ação o spec de aprovação propõe, e por quê

`write_file`, com ator `user`, e o spec **recusa** — nunca aprova. Medido no
código, não escolhido por palpite (AT-068):

- **Fica `pending`.** `decide()` (`apps/api/src/domain/actions/decide.ts`)
  parte de `require_approval` para todo tipo sem regra; o `permissions.json`
  de projeto recém-criado é vazio (`permissions-file.ts`), e com ator `user`
  nenhuma `agent_autonomy` é consultada. `proporAcaoPendente()` LANÇA se a ação
  não nascer `pending`, dizendo a política que decidiu — uma mudança que a
  auto-aprovasse deixaria o card sem botões, e o spec acusaria a tela.
- **Não tem efeito nem se aprovada.** `ApproveActionUseCase` executa só
  `terminal`, as duas PRs, os quatro de container, `instruction_patch`, os dois
  de paralelismo e o git tipado; `write_file` volta aprovada sem executor na
  api. Quem escreveria o arquivo é o agente que a propôs, ao receber o
  desfecho, e o aviso ao engine só sai para ator `agent`.
- **Nenhum teto foi tocado.** A escolha é do tipo, não da política: o teto de
  merge em branch protegida, o de efeito externo e os demais seguem
  `require_approval` incondicional, e o spec não configura autonomia nem
  `permissions.json`.

Os descartados, com o motivo: `terminal` e o git tipado têm executor (o
terminal rodaria no container do projeto, e o git falharia sem repositório —
efeito ou ruído); os de container batem no broker, que o compose de produção
sobe desligado (`sem_broker_na_instalacao`); `spend` exige `owner` e é o tipo
de gasto, que ninguém quer ver aprovado por engano num teste.

## Quanto os specs custam ao job `images`

O acréscimo da AT-068 é **um** teste, cujo trabalho é uma navegação, um
refresh, um clique e uma leitura da fila — a mesma ordem de grandeza de
`socket-da-sessao.spec.ts`. O da AT-338 também é um: uma navegação, um envio
e um turno que falha na api antes de qualquer chamada de rede ao provider —
segundos, sem modelo, sem download e sem token gasto.

> **TODO(humano):** o número medido. A AT-068 não conseguiu subir o compose
> de produção no ambiente em que foi escrita: `hex.pm`,
> `dl-cdn.alpinelinux.org` e os blobs do GHCR são recusados pela política de
> saída de rede de lá, então nem o engine se constrói nem a imagem publicada
> se baixa, e a AT-338 esbarrou na mesma política. O número sai do passo
> `pnpm e2e` do job `images` da primeira execução destes specs no CI (a linha `N passed (Xs)` do reporter `list`),
> comparado com a execução anterior da `dev`.

## Se o login começar a falhar rodando várias vezes seguidas

Não é bug de credencial, e a senha não mudou. É o **lockout progressivo por
IP** do próprio produto (`AUTH_LOCKOUT_IP_THRESHOLDS`, default
`20:30,30:120`, janela de 15 minutos), que responde com o **mesmo 401
uniforme** de senha errada — de propósito: distinguir os dois diria ao
atacante quando ele acertou o e-mail.

Cada execução gasta **16 logins** (inclui `turno-do-agente-delta`; `backlog-aceito-todas` só fala por HTTP e não gasta; R3: 11 na R2 mais 5: `aprovacoes-aprovar-inline`, `backlog-aba`, `conhecimento-c4` e 2 de `autenticacao-revogacao`, que fala só por HTTP): o `setup`, o spec de
autenticação, a semeadura por HTTP, o login próprio de
`turno-pelo-canal.spec.ts` e UM por arquivo novo que abre navegador
(`sessao-e-canal-frame`, `turno-do-agente-fio`, `execucao-parada`,
`execucao-pr-pronta`, `git-mergear-no-chat`, `backlog-perguntas-em-aberto` e
`time-e-handoffs-aceite-no-chat`). O teto é 20 em 15 minutos: spec nova com
navegador precisa caber nele, e uma retentativa que reinicia o worker custa
mais um login de semeadura. A semeadura continua custando UM por mais specs
que existam: `autenticar()` memoiza o token pela execução inteira, e com
`workers: 1` os arquivos rodam no mesmo processo. Só um spec que precise de
sessão de navegador NOVA acrescenta um login, e o diz. Uma execução por vez, como
no CI, fica muito longe do teto; iterar dez vezes em quinze minutos, não.

Saídas, em ordem de preferência:

1. esperar a janela drenar (o primeiro degrau são 30 segundos);
2. subir o compose com o teto mais permissivo só para a sessão de trabalho:
   `AUTH_LOCKOUT_IP_THRESHOLDS=200:5 SMOKE_KEEP_UP=1 bash "${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh"`.

`suporte/api.ts` já reconhece esse 401 e devolve uma mensagem dizendo isto —
sem ela, a próxima pessoa caça um bug de credencial que não existe. Foi o que
quase aconteceu ao escrever esta camada.

## Tetos da api no job (AT-840)

O `e2e-pr.yml` grava no `.env` do compose `RATE_LIMIT_USER=5000`, `RATE_LIMIT_IP=10000` e `AUTH_LOCKOUT_IP_THRESHOLDS=200:5` (formato `falhas:segundos`). Com o catálogo inteiro, as specs passam do rate limit padrão (300 por usuário e 600 por IP por minuto) e a api devolve 429 (run 42506755991). O mecanismo continua provado nas suítes da api; aqui os tetos só tiram o ruído. Vale para o regressivo da `dev` e para o portão, porque os dois usam o mesmo passo. O compose de instalação precisa repassar as variáveis (brabo-infra `bugfix/repassa-limites-da-api`); sem o repasse o `.env` não tem efeito e nada quebra.

## Semeadura comum (AT-815 R1, RN-1064)

`suporte/eventos.ts` (evento pela rota pública), `suporte/interno.ts` (mapa, história, tarefa, gate e handoff pelas rotas internas) e `suporte/execucao.ts` (execução Noop, sem LLM) e `suporte/git.ts` (commit conflitante na `main` do repo local, pela PR de infra, sem Docker) são os caminhos de semeadura das specs. As rotas internas exigem `E2E_SERVICE_TOKEN`, que no CI vem do `.env` do próprio run por `scripts/ci/com-token-de-servico.sh`: mascarado, nunca impresso nem gravado em artefato. Localmente, exporte o `BRABO_SERVICE_TOKEN` do `.env` do compose como `E2E_SERVICE_TOKEN` (sem imprimi-lo). Login de navegador: um por ARQUIVO (`contextoLogado` no `beforeAll`, `describe` em modo serial). O `execucao-noop.spec.ts` e o `aprovacoes-trava-de-merge.spec.ts` não abrem navegador e não gastam login além da semeadura. `suporte/chat.ts` abre as abas do bloco de pendências do chat (`abrirFila`) e `suporte/eventos.ts` ouve os frames do canal (`ouvirCanal`). `semearExecucao` decide a imagem do projeto por padrão (libera `/code/*`); `decidirImagem: false` semeia sem ela, como `execucao-pr-pronta` e `git-mergear-no-chat`, que provam que o chat não depende dessa decisão (AT-843). O disjuntor da execução se configura no projeto (`maxConsecutiveBlocked` em `semearExecucao`), porque o `ActivateExecutionDto` ainda não o aceita. Detalhes em `docs/regressivo/como-funciona.md`.

## Provider dublê da api (AT-815 R4, RN-1065)

`turno-do-agente-delta` (`@f-turno-do-agente`, o `agent.delta` entre `working` e `idle`) e `backlog-aceito-todas` (`@f-backlog`, o Criativo lista e fecha 7 perguntas de dois autores) usam o `DubleLLMProvider` da api, que responde por roteiro e grava custo 0 e modelo `duble-llm`. O job já o liga: `suporte/compose-duble.yml` (segundo `-f` do compose, só no passo "Subir o compose") põe `LLM_DUBLE=1` e monta `suporte/llm-duble-roteiro.json` na api. **Exige api `v2.2.0-dev.14` ou mais nova** (AT-850): a api só carrega o dublê em imagem sem a marca `prd` (RN-1065), e antes dela toda imagem, `-dev` inclusive, era `prd` (o run 42515015341 logou `LLM_DUBLE=1 ignorado: imagem de produção (prd)`). Com imagem `prd` as duas specs falham. LLM real nunca entra no regressivo (P2). O roteiro é do agente `criativo` (passo 0 texto, passo 1 `list_open_questions` mais 7 `answer_open_question`, passo 2 fecho), e `semearSessaoComDuble` vincula um modelo `ollama` ao workspace da semeadura (sem binding o turno acaba em "Nenhum modelo vinculado"). O dublê não prova qualidade de modelo.

## Capturas da doc (AT-859, ADR 0286)

`capturas/doc.captura.ts` fotografa as telas que a doc do `brabo` usa, nos temas claro e escuro, em 1366×768. Não é spec: sem `@f-`, fora de `testes/`, com config própria (`playwright.capturas.config.ts`), então o `pnpm test` e o portão da `main` não a rodam. Roda com `pnpm exec playwright test -c playwright.capturas.config.ts`, contra o compose de teste com o dublê (`suporte/compose-duble.yml`) apontando para `capturas/roteiro.json` (o roteiro didático do encurtador de links, diferente do `suporte/llm-duble-roteiro.json` das specs). A conta é o `owner@brabo.dev` do seed, nunca o acesso rápido. A saída (`capturas/saida/`, ignorada pelo git, ou `CAPTURAS_SAIDA`) leva os PNG e o `capturas.json`. `suporte/ocultar.ts` cobre dado pessoal com `mask` e FAZ A CAPTURA FALHAR se o texto visível tiver `/home/`, o usuário da máquina, um token ou um e-mail fora do domínio de teste. Detalhes em `docs/capturas/como-funciona.md`.

## O que NÃO está coberto

Declarado, não esquecido (ver as Consequências do ADR 0120): diferenças
entre navegadores (só chromium roda) e o **streaming do turno** — o
`agent.delta` (coberto desde a AT-815 R4, ver "Provider dublê da api"). A aprovação inline saiu desta lista na AT-068, e o CICLO do
turno pelo canal (`working` → `agent.error` → `idle`) saiu na AT-338; o delta
continua.

O streaming ficou de fora por MEDIÇÃO, não por esquecimento. O que o faria
ser streaming — o `agent.delta` chegando pelo canal numa terceira origem — só
é emitido pelo `on_delta` que os servidores conversacionais passam ao
`llm_turn_stream` (`criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`
e irmãos), ou seja, por chunk de um provider de LLM de verdade. E não há
provider de mentira: `apps/api/src/infrastructure/llm/` tem os nove
providers reais e nenhum dublê, o compose de produção não tem serviço de LLM
fora do profile `llm` (Ollama, ~2 GB de modelos), e `scripts/dev/` não tem
stub de engine. As saídas conhecidas são decisão de custo, do dono:

1. ligar o profile `llm` no job `images` (download de modelo, curadoria e
   binding de um modelo com tool calling para o agente) — streaming de
   verdade, custo de minutos e de disco no job;
2. um provider DUBLÊ na api, só para teste — contradiz a regra de que
   capability se prova contra o provider real (ADRs 0041/0042), e precisaria de
   ADR próprio;
3. o turno que FALHA sem credencial: `agent.status: working`, `agent.error` e
   `idle` chegam pelo canal sem gastar nada — prova o ciclo do turno na
   terceira origem, mas NÃO o `agent.delta`, e por isso não foi chamado de
   streaming aqui.

O dono escolheu a terceira (AT-338), e ela é o `turno-pelo-canal.spec.ts`. O
que ele usa foi lido no código: sem credencial do DONO do workspace para o
provider do modelo vinculado (RN-058), `StreamLlmTurnUseCase` fecha o turno com
o frame final `Nenhuma credencial cadastrada para <provider>`, e
`Engine.Agents.FalhaDeTurno` classifica `credencial` como origem `politica`
(RN-059). O workspace da semeadura ganha um modelo de NUVEM com tool calling
de um provider sem credencial (`semearSessaoSemCredencial`): sem binding o
texto seria outro (`Nenhum modelo vinculado`), e o workspace do seed vincula o
`ollama`, que não pede credencial e cairia em `infra`. As saídas 1 e 2 seguem
de pé para o delta, com o mesmo custo.

Houve outro spec, `chave-de-dispositivo.spec.ts`, que gerava num Chromium
de verdade o par Ed25519 do fluxo do navegador (ADR 0118) e provava o `kid` da
RN-475 contra o `PatAuthGuard`. Ele saiu no ADR 0203 (RN-687), junto com o
fluxo e com a rota `POST .../runner-device-keys` de que dependia: a chave nasce
agora NA MÁQUINA (`brabo-runner device-key create`, RN-551), em Node, onde
`crypto` gera Ed25519 sem dublê — e a cadeia `kid` → JWT → `PatAuthGuard`, com
chave real, é coberta por `apps/api/test/interfaces/pat-auth.guard.spec.ts` e
`apps/runner/src/criar-chave-de-dispositivo.spec.ts`. Nada do que restou é
mecanismo de NAVEGADOR, que é a única pergunta desta camada.
