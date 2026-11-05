# Browser E2E

The fourth layer of the pyramid. The three below already run with `pnpm test`;
this one needs a **real browser** and the **production compose up**,
because what it proves only exists there.

Full decision: [ADR 0120](../docs/adr/0120-e2e-de-navegador-contra-o-compose-de-producao.md).

## How to run

```bash
pnpm e2e:navegadores                      # uma vez: baixa o chromium
SMOKE_KEEP_UP=1 bash "${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh"      # sobe o stack e DEIXA de pé
pnpm e2e                                  # roda os specs contra ele
docker compose -f docker/docker-compose.prod.yml down -v
```

From the root, always via `pnpm e2e` / `pnpm --dir e2e ...`. **`pnpm --filter e2e`
does not work** — and that is not a bug, it is the design below.

## Why outside the workspace

`e2e/` has its own `pnpm-workspace.yaml` and `pnpm-lock.yaml`, installed with
`pnpm install` from inside this folder. It is the same design as `website/`
([ADR 0117](../docs/adr/0117-lockfile-proprio-para-o-website.md)), for the same
reason: the Playwright dependency tree does not reach any image, and leaving it in the root
lockfile would make the product's `pnpm audit` report a test tool as if it were the surface of what ships.

That this package TESTS the product does not change the argument — what decides is where the
dependency **goes**, not what it talks about.

## What these tests prove, and why only here

| mechanism | why jsdom does not reach it |
|---|---|
| refresh in an `httpOnly` cookie | `httpOnly` is a guarantee of the BROWSER; in jsdom the cookie would be readable and the assertion would pass while lying |
| CSRF + cross-origin (`:8088` → `:3000`) | there is no real origin and no preflight — the api's `main.ts` records: "teste não faz preflight" |
| session that survives reload | it is the only way to prove that the in-memory access token was REBUILT from the cookie, and not that it never disappeared |
| single-use socket ticket (RN-108) | requires a real WebSocket handshake against the engine, from a THIRD origin |
| the turn CYCLE through the channel (`turno-pelo-canal.spec.ts`, AT-338) | `agent.status` (`working`, then `idle`) and `agent.error` only exist as WebSocket frames from the real socket the page opened with the single-use ticket, against the engine on a THIRD origin; the web suite stubs the channel. The spec reads the FRAMES (`framereceived`) of the topic `session:<id>`, in order, and the failure bubble by the structural selector `data-testid="falha-de-turno"` with `data-origem` |
| INLINE approval (`aprovacao-inline.spec.ts`, AT-068) | the decision leaves the `ApprovalCard` of the session chat as a cross-origin POST `:8088` → `:3000`, with the `Authorization` of the access token the page rebuilt from the httpOnly cookie via double-submit; jsdom has no preflight nor origin, and the web suite tests the card with the api stubbed. The spec asserts the OBSERVED REQUEST (origin, Bearer, 201 with `denied`, refresh outside it) and the QUEUE through the api — never the card disappearing |

The AT-068 measurement corrected the statement of inline approval: the DECISION POST does **not** carry
CSRF. `X-CSRF-Token` is only required on the `/auth` routes
(`apps/api/src/interfaces/http/auth/session-cookies.ts`: the access token stays out of the cookie precisely so
CSRF is not required on every authenticated route). The CSRF that the spec proves is the one of the
`POST /auth/refresh` that gives the page the access token it decides with; the decision proves cross-origin
CORS with `Authorization`.

## Conventions

- **Structural selector, never text.** The interface language is a decision of the
  SERVER; a test tied to "Sign in" would break when the account's language changes,
  and that failure says nothing about the product.
- **Assertion about the mechanism, not the screen.** A "connected" indicator
  changes color, label and language without the socket changing anything.
- **Seeding over HTTP** (`suporte/api.ts`), mirroring `${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh`. The
  browser is expensive, and slow setup is setup that gets turned off.

## Only ONE spec per run may use the `setup` state

The `brabo_refresh` stored in `suporte/.estado-autenticado.json` is valid **once**. `RefreshUseCase` rotates it and has **reuse detection**, which revokes the
entire FAMILY — so a second browser context loading the app with the same cookie does not just fail: it knocks the session out for every
following spec, which start falling to the login.

The punishment is misleading, like the lockout's: the red spec is the **next** one in
alphabetical order, and it blames its own mechanism (a socket that did not come up),
never the cookie. That is how it appeared, when `chave-de-dispositivo.spec.ts` was added — the spec for the key generated in the BROWSER, which left
together with that flow in ADR 0203 (see below).

Practical rule: whoever needs a BROWSER session keeps the state
(`socket-da-sessao.spec.ts`); whoever only needs the `:8088` ORIGIN and talks to the
api by Bearer opts out, with
`test.use({ storageState: { cookies: [], origins: [] } })` and a comment
saying why — these are TWO different reasons to opt out, and the one in
`autenticacao.spec.ts` (needs a clean origin to prove the login) is not this one.

There is a THIRD way out, for whoever needs a browser session and cannot keep the state:
`aprovacao-inline.spec.ts` runs BEFORE `socket-da-sessao.spec.ts` in alphabetical order, so using the state there
would knock out the socket. It opts out and injects into the context the cookies of the SEEDING login
(`cookiesDaSemeadura()` in `suporte/api.ts`) — the same login memoized by `autenticar()`, whose refresh the seeding never
uses, because it talks only by Bearer. It costs no extra login, and the SAME rule applies: once.
`cookiesDaSemeadura()` THROWS on the second call, naming the reason, so that a second
consumer breaks where it stands, and not in the next spec.

The FOURTH, when the three already have an owner: `turno-pelo-canal.spec.ts` (AT-338) runs after all of them and needs a browser session. It opts out and does its
OWN login (`cookiesDeUmLoginProprio()`), which is NOT memoized — memoizing would hand the same refresh to two consumers. It costs one login from the lockout bucket, counted below.

## Which action the approval spec proposes, and why

`write_file`, with actor `user`, and the spec **refuses** — it never approves. Measured in the code, not chosen by guess (AT-068):

- **It stays `pending`.** `decide()` (`apps/api/src/domain/actions/decide.ts`)
  starts from `require_approval` for every type without a rule; the `permissions.json`
  of a newly created project is empty (`permissions-file.ts`), and with actor `user`
  no `agent_autonomy` is consulted. `proporAcaoPendente()` THROWS if the action does not come out
  `pending`, naming the policy that decided — a change that auto-approved it would leave the card without buttons, and the spec would blame the screen.
- **It has no effect even if approved.** `ApproveActionUseCase` executes only
  `terminal`, the two PRs, the four container ones, `instruction_patch`, the two parallelism ones and the typed git; `write_file` comes back approved with no executor in the
  api. Whoever would write the file is the agent that proposed it, on receiving the
  outcome, and the notice to the engine only goes out for actor `agent`.
- **No ceiling was touched.** The choice is of the type, not of the policy: the merge ceiling on a protected branch, the one for external effect and the others
  remain `require_approval` unconditionally, and the spec configures no autonomy nor `permissions.json`.

The discarded ones, with the reason: `terminal` and the typed git have an executor (the terminal would run in the project's container, and git would fail without a repository — effect or noise);
the container ones hit the broker, which the production compose starts disabled (`sem_broker_na_instalacao`); `spend` requires `owner` and is the kind of spending nobody wants approved by mistake in a test.

## How much the specs cost the `images` job

AT-068's addition is **one** test, whose work is a navigation, a refresh, a click and a read of the queue — the same order of magnitude as
`socket-da-sessao.spec.ts`. AT-338's is also one: a navigation, a send and a turn that fails in the api before any network call to the provider —
seconds, no model, no download and no token spent.

> **TODO(humano):** the measured number. AT-068 could not bring up the production compose in the environment where it was written:
> `hex.pm`,
> `dl-cdn.alpinelinux.org` and the GHCR blobs are refused by that environment's network egress policy, so neither the engine builds nor the published image is downloaded, and AT-338 hit
> the same policy. The number comes from the `pnpm e2e` step of the `images` job on the first run of these specs in CI (the `N passed (Xs)` line of the `list` reporter),
> compared with the previous run on `dev`.

## If the login starts failing after running several times in a row

It is not a credential bug, and the password has not changed. It is the product's own **progressive lockout per IP**
(`AUTH_LOCKOUT_IP_THRESHOLDS`, default
`20:30,30:120`, 15-minute window), which answers with the **same uniform 401** as a wrong password — on purpose:
telling the two apart would tell the attacker when they got the email right.

Each run spends exactly **4 logins** (the `setup`, the authentication spec, the seeding over HTTP and the
own login of `turno-pelo-canal.spec.ts`). The seeding keeps costing ONE no matter how many specs there are: `autenticar()` memoizes the token for the whole run, and with `workers: 1` the files run in the same process. Only a spec that needs a NEW browser session adds a login, and says so. One run at a time, as in
CI, stays very far from the ceiling; iterating ten times in fifteen minutes does not.

Ways out, in order of preference:

1. wait for the window to drain (the first step is 30 seconds);
2. bring up the compose with a more permissive ceiling just for the working session:
   `AUTH_LOCKOUT_IP_THRESHOLDS=200:5 SMOKE_KEEP_UP=1 bash "${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh"`.

`suporte/api.ts` already recognizes this 401 and returns a message saying this —
without it, the next person hunts a credential bug that does not exist. That is what almost happened while writing this layer.

## What is NOT covered

Declared, not forgotten (see the Consequences of ADR 0120): differences
between browsers (only chromium runs) and the **turn streaming** — the `agent.delta`. The inline approval left this list in AT-068, and the turn CYCLE
through the channel (`working` → `agent.error` → `idle`) left it in AT-338; the delta remains.

Streaming was left out by MEASUREMENT, not by oversight. What would make it streaming — the `agent.delta` arriving through the channel from a third origin — is only
emitted by the `on_delta` that the conversational servers pass to `llm_turn_stream` (`criativo_server.ex`, `po_server.ex`, `arquiteto_server.ex`
and siblings), that is, per chunk from a real LLM provider. And there is no fake provider: `apps/api/src/infrastructure/llm/` has the nine
real providers and no double, the production compose has no LLM service outside the `llm` profile (Ollama, ~2 GB of models), and `scripts/dev/` has no
engine stub. The known ways out are a cost decision, the owner's:

1. turn on the `llm` profile in the `images` job (model download, curation and
   binding of a model with tool calling for the agent) — real streaming, minutes of cost and disk in the job;
2. a DOUBLE provider in the api, just for testing — contradicts the rule that a capability is proven against the real provider (ADRs 0041/0042), and would need its own ADR;
3. the turn that FAILS without a credential: `agent.status: working`, `agent.error` and
   `idle` arrive through the channel without spending anything — proves the turn cycle on the third origin, but NOT the `agent.delta`, and so it was not called streaming here.

The owner chose the third (AT-338), and it is `turno-pelo-canal.spec.ts`. What it uses was read in the code: without a credential of the workspace OWNER for the provider of the bound model (RN-058), `StreamLlmTurnUseCase` closes the turn with
the final frame `Nenhuma credencial cadastrada para <provider>`, and
`Engine.Agents.FalhaDeTurno` classifies `credencial` as origin `politica`
(RN-059). The seeding workspace gets a CLOUD model with tool calling from a provider without a credential (`semearSessaoSemCredencial`): without a binding the text would be different (`Nenhum modelo vinculado`), and the seed workspace binds
`ollama`, which asks for no credential and would fall into `infra`. Ways out 1 and 2 remain in place for the delta, at the same cost.

There was another spec, `chave-de-dispositivo.spec.ts`, which generated in a real Chromium
the Ed25519 pair of the browser flow (ADR 0118) and proved the `kid` of RN-475 against the `PatAuthGuard`. It left in ADR 0203 (RN-687), together with the flow and with the route `POST .../runner-device-keys` it depended on: the key is now born ON THE MACHINE (`brabo-runner device-key create`, RN-551), in Node, where
`crypto` generates Ed25519 without a double — and the `kid` → JWT → `PatAuthGuard` chain, with a real key, is covered by `apps/api/test/interfaces/pat-auth.guard.spec.ts` and
`apps/runner/src/criar-chave-de-dispositivo.spec.ts`. Nothing that remains is a BROWSER mechanism, which is the only question of this layer.
