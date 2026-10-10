# Revisão: os três documentos do ciclo entram sem tocar no núcleo, e o portão abre o artefato do botão

## O que foi revisado

A mudança da branch que declara os documentos de requisitos, protótipo e manual do usuário e ensina a fase e o portão a lê-los, contra `1_SPEC.md`, `2_PLAN.md` e `3_IMPLEMENTATION.md`. O diff tem 72 arquivos (sem a pasta do ciclo), 918 linhas acrescentadas e 220 removidas.

Leitura feita nesta etapa: a declaração de documento (`src/shared/plugins/declaration.ts`), a junção pura da fase (`src/shared/plugins/phase.ts`), o leitor da fase (`src/main/cards.ts`), o portão (`src/main/gate.ts`), a tela (`src/renderer/src/screens/Gate.tsx`), o par de tipos do canal (`src/shared/types.ts`, `src/main/index.ts`), a leitura dos plugins (`src/main/plugins/read.ts`, `src/main/plugins/module.ts`), a declaração embutida (`plugins/cycle-artifacts/`), a pasta do aplicativo (`src/main/paths.ts`, `electron-builder.yml`), a produção (`src/shared/cycles/templates/agentFlow.ts`), a migração (`src/shared/config/migrations.ts`, `src/shared/config/types.ts`), os catálogos (`src/shared/i18n/en.json`, `pt-BR.json`) e a documentação (`CHANGELOG.md`, `docs/cycles.md`, `docs/plugins/README.md`).

As fronteiras de segurança foram lidas junto: o guarda de caminho (`src/main/engine/guard.ts`), o registrador de canais (`src/main/rpc.ts`), a política de acesso do navegador pareado (`src/main/webPolicy.ts`), a escrita de documento de plugin (`src/main/plugins/runtime.ts`), o executor (`src/main/runner/executor.ts`), a publicação (`src/main/runner/publish.ts`), as transições do run (`src/shared/runs/transitions.ts`) e a regra de arquivo secreto (`src/main/agents.ts`).

Cada critério de aceite (1 a 10) foi conferido contra o código. O que nenhum teste cobre está dito como não verificado.

## O que passou nos portões (executado nesta etapa)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | sem erros |
| `npx vitest run` (suíte completa) | 416 arquivos verdes, 1 pulado; 6948 testes verdes, 3 pulados |
| `node scripts/theme-audit.mjs` | verde |
| `npm run i18n:lint` | 5482 chaves nos dois idiomas, 12 catálogos, nenhum problema |
| `node scripts/public-audit.mjs` | verde em 1590 arquivos, 0 achados em todas as regras |
| `npx electron-vite build` | construído, exit 0 |
| os 8 arquivos do núcleo da mudança | 239 testes verdes |
| `test/config-schema.test.ts` + `test/runner-golden.test.ts` | 29 testes verdes |

A suíte completa fecha verde nesta tentativa, o que encerra a dúvida que a implementação deixou em aberto sobre timeouts por carga da máquina.

## O que a mudança faz, e por que aprova

- A declaração aceita `flow` e recusa o que não presta: `gate` só 1 ou 2, `before` só um nome de arquivo simples, `flow` presente precisa trazer um dos dois, e a recusa tem motivo próprio (`src/shared/plugins/declaration.ts:219-234`). Sem `flow` nada muda: o tipo continua colateral.
- A junção da fase é pura e não muta a lista recebida; âncora que a lista não tem deixa o documento fora, e a lista sem documentos é a de hoje (`src/shared/plugins/phase.ts:10-18`).
- A fase lê os tipos novos com o registro ligado e é exatamente a de hoje com o registro vazio (`src/main/cards.ts:49`), o que preserva o comportamento atual de um espaço sem plugins.
- O portão calcula o número de cada tipo pelo `flow` (2 quando o tipo nada diz, como era; nenhum quando o `flow` não traz portão) e a fonte do ciclo continua primeira (`src/main/gate.ts:122-129`).
- O artefato que a tela nomeia só é usado quando casa com uma opção calculada para aquele cartão; qualquer outro caminho cai na primeira opção do portão, e o valor sem tipo vindo do canal é descartado antes (`src/main/gate.ts:136-139`, `src/main/index.ts:212`).
- O embutido é filtrado por capacidade — sem script, eventos, rede, escrita, configuração ou nota —, vem ligado por padrão só no que é declaração pura, e uma cópia do mesmo `id` na pasta do workspace vence a do aplicativo (`src/main/plugins/read.ts:137-147`).
- A produção nos dois modelos e a migração por igualdade exata preservam lista editada pela pessoa e são idempotentes (`src/shared/config/migrations.ts:392-414`).
- A pasta de plugins embutidos sobe no pacote (`electron-builder.yml:32-33`) e `paths.ts` nomeia a constante, com a leitura tolerando a pasta ausente.
- Nenhum achado de área pública: o `plugin.json`, o `README.md` da pasta embutida, os dois catálogos, a documentação e o changelog são neutros; a auditoria fecha com zero achados em 1590 arquivos.

## Achados

### Bloqueante

1. **`src/main/plugins/read.ts:137-147` e `src/main/gate.ts:123-128` — um plugin de terceiro pode escrever por cima do manual do usuário.** O embutido é lido depois da pasta do workspace e, por isso, a cópia da pessoa vence a do aplicativo. O que a pasta do workspace não vence é a escrita: um plugin qualquer que declare um documento chamado `USER_MANUAL.md` grava nele pela primeira fonte de documento do próprio registro (`src/main/plugins/runtime.ts:96-97,105-112`), sem `flow` e sem guarda de nome reservado. O arquivo é do fluxo e é versionado: um plugin sem relação com o ciclo apaga o manual que o aplicativo acabou de produzir. Antes desta mudança esse nome não existia, então o risco nasce com ela. A contenção que o plano previu (filtro por capacidade) é sobre o que entra na pasta do aplicativo, não sobre o que um plugin da pasta da pessoa pode escrever.

### Sugestões

2. **`src/main/gate.ts:136-139` — dois artefatos do mesmo portão abrem a partir do metadado do run.** Os botões da tela levam o arquivo do próprio botão, e o valor sem tipo é descartado no canal (`src/main/index.ts:212`), então o caminho pelo parâmetro é fechado. O que continua aberto é o metadado de uma proposta ou de uma resposta: `startGate(card, gate, file)` aceita qualquer opção calculada daquele cartão, e um `gate:start` gravado antes da mudança, ou ensaiado por um plugin, abre o outro artefato do mesmo portão. Nada sai do cartão e o pior caso é abrir o artefato errado do mesmo portão.

3. **`test/plugins-core.test.ts:9-21` — os nomes dos dados de prova citam a plataforma de plugins de outro repositório.** O identificador `web-search`, o arquivo `7_WEB_SEARCH.md` e a chave `plugins.webSearch.document` do dado de prova não existem no repositório (o real é `plugins/web-search/` com `WEB_SEARCH.md`), e os padrões de auditoria pública estão codificados justamente para não ligar um dado de teste a um projeto real. Quem for ler o teste depois pode procurar aquilo no código e não achar. Não é violação de regra do repositório: nada de empresa, pessoa, host ou número real aparece.

4. **`plugins/cycle-artifacts/README.md:15` e `plugins/cycle-artifacts/plugin.json:24` — os dois arquivos novos da pasta embutida não terminam em linha nova.** As verificações deste repositório não checam isso, e o diff ou uma leitura por linha fica sem a marca de fim de arquivo.

5. **`test/golden/legacy-prompts.json:294` — o ouro das cerimônias fixa a abertura do portão pelo metadado do cartão.** O cartão de prova grava a fase `Plan escrito` enquanto a pasta de prova tem o plano em `bug/2_PLAN.md`, e é por esse metadado que o portão abre (`test/helpers/promptCapture.ts:99-115,169`). Com o portão agora somando os tipos de plugin, um registro ligado no momento do teste de paridade mudaria o artefato que o ouro fixa — hoje o registro está vazio e o arquivo está correto; fica registrado como o ponto que muda se alguém ligar um plugin naquele caminho.

## Não verificado

- Os aceites de ponta a ponta com modelos de verdade (execução passando pelo refinamento, pelo plano e pelo fim, com os três documentos na pasta e o manual ao lado da nota de lançamento): exige modelos e um espaço real. O que está provado é a mesma produção com respostas falsas (`test/runner-e2e.test.ts` e os goldens do runner).
- O clique nos botões do portão na janela e o efeito de desligar o plugin na lista sem reiniciar: o mecanismo tem teste (opção por arquivo, artefato escolhido, leitura a cada chamada), a tela não.
- Um quarto tipo instalado e aberto num portão de verdade: coberto por teste de unidade e de função pura, não demonstrado numa tela.
- Um espaço de trabalho real aberto depois da migração: a migração está testada com objetos.

## Veredito

**Aprovado com um bloqueante.** Fora o achado 1, os critérios de aceite estão atendidos pelo código e pelos testes, os portões da CI fecham verdes e a fronteira de segurança (guarda de caminho, canal, embutido por capacidade, caminho do artefato) está contida. Os achados 2 a 5 são sugestões e não travam a entrega.
