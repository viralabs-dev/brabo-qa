# brabo-qa — testes que atravessam repositórios

Parte da separação do monorepo em repositórios (ADR 0252). Aqui moram o E2E de navegador, os golden-sets, o smoke das imagens
e os instrumentos de medição. Os repos de app (`brabo-api`, `-engine`, `-web`, `-runner`, `-broker`) guardam os testes
próprios; aqui só entra o que precisa de MAIS DE UM repositório ou do sistema de pé. Regras abaixo partidas de
`.claude/contexto/` da fonte; regra nova entra aqui, na parte do assunto.

## Pirâmide de testes
- Vitest (api/web/scripts), ExUnit (engine). Nenhuma feature sem teste do caminho feliz + 1 caso de falha. Providers de git e de LLM
  validados por suas suítes de contrato únicas.
- A quarta camada é o E2E de navegador (`e2e/`, ADR 0120) e responde o que as outras três não: "um navegador de verdade, em outra
  origem, entra e fica dentro?". Não substitui nenhuma: comportamento continua coberto embaixo, e teste que caberia na suíte do
  web não sobe para cá.
- Capability só é declarada quando provada pela suíte; sem prova, declara-se `false` e degrada.

## E2E (`e2e/`)
- Playwright, só chromium. Roda contra o compose de PRODUÇÃO (`${BRABO_INFRA_DIR:-../brabo-infra}/docker/smoke.sh` com `SMOKE_KEEP_UP=1`), nunca contra o `vite dev`:
  refresh em cookie `httpOnly`, CSRF em origem cruzada `:8088`→`:3000` e ticket de uso único do socket (RN-108) contra o engine
  numa terceira origem só existem com as três origens distintas, e jsdom não alcança nenhuma.
- NÃO é membro de workspace: lockfile próprio, `pnpm --dir e2e`, nunca `pnpm --filter`.
- Seletor é ESTRUTURAL, nunca texto (o idioma é decisão do servidor); a asserção é sobre MECANISMO, nunca sobre tela.
- O compose vem do `brabo-infra` (`BRABO_INFRA_DIR`, padrão `../brabo-infra`).

## Golden-sets (ADR 0123, 0132, 0138, 0168)
- São AGENDADOS (RAG diário, QA semanal) ou sob `workflow_dispatch`, NUNCA em PR. Não os ponha em PR para "provar" o YAML:
  o CI de PR só roda `actionlint` e confere os caminhos dos irmãos.
- Rodam DENTRO do `brabo-engine`: o workflow copia `golden/engine/test/` para o `test/` dele e o teste chama o seed do
  `brabo-api` (`pnpm run golden-set:{qa,rag}-seed`, `BRABO_API_DIR`).
- O teste PULA por desenho quando a api ou o embedding faltam; o workflow tem a guarda do falso-verde (a linha de resultado
  precisa existir). Não a afrouxe.
- `floor.json` (chaveado por MODELO) é o ratchet e SÓ HUMANO o escreve. Não afrouxe o piso nem o teste para passar; se a gravação
  não separa os casos, reveja os casos.
- RAG: chunking (1200/150) e pesos da busca (0.6/0.4, limiar 0.2) são PONTO DE PARTIDA não calibrado (ADR 0080); o corpus é CURADO
  (22 arquivos). Não mexa nos números sem medição acumulada. O limiar da duplicata semântica (0,80, RN-681) idem.
- QA: o veredito vem do `passRate` do `floor.json`; recusa da RN-502 no event log invalida a medição.

## Métricas e instrumentos
- Métrica de execução de agentes é extraída do event log/`token_usage` por script, nunca anotada à mão.
- `scripts/jev/`: instrumento do Jev (`typesafe/jev-1.13`, critério de 80%); `scripts/idioma/`: mede a heurística de idioma, que
  MORA no `brabo-api` (`src/domain/iam/heuristica-de-idioma.ts`) e aqui só é reexportada de `../brabo-api` — nunca a copie.
  Os limiares (`PARAMETROS_PROVISORIOS`) são provisórios.
- Os dois leem fontes dos irmãos em checkout ao lado (`../brabo-api`, `../brabo-engine`); não vendorizam.
- Arquivo que outro programa vai parsear se prova contra o PARSER dele, não contra asserção de string.

## Convenções do repositório
- Branches permanentes `dev` e `main`; trabalho nasce de `dev` com `funcao/descritivo` (`^.{0,30}/\S{0,32}$`); commits conventional em pt-BR;
  toda mudança por PR; merge em permanente é manual do dono. Política e escada vêm do `brabo-ci` (`politica.yml`).
- `uses:` preso a SHA com `# vX`; imagem de terceiro por digest com a tag inline. Dependabot: linguagem só segurança.
- Documentação: atualize `README.md` e `CHANGELOG.md` na mesma mudança. Nunca inventar conteúdo de doc: use `TODO(humano)`.
- O roteiro do TP-01 mora no Vault; não o copie para cá.
