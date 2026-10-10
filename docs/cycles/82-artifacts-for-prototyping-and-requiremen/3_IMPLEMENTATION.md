# O que foi implementado dos documentos de requisitos, protótipo e manual

Este registro é o da implementação do que está em `2_PLAN.md`: o que mudou em cada área, como
cada comportamento está coberto por teste e o que foi de fato conferido nesta etapa. A última
tentativa corrigiu o achado bloqueante da revisão (ver "A correção desta tentativa").

## A mudança, por área

1. **Declaração de documento com `flow`** (`src/shared/plugins/declaration.ts`).
   `PluginDocumentType` passou a ser `{ name, label, flow?, chain? }`, com
   `flow: { gate?: 1|2; phase?: { label?: string; before: string } }`. A leitura valida: `gate` só 1
   ou 2, `phase.before` só um nome de arquivo simples da pasta do ciclo, e `flow` presente precisa
   trazer um dos dois; a recusa tem motivo próprio (`flow`). Sem `flow` nada muda: o tipo continua
   colateral (portão 2, fora da fase). `chain` é do que vem com o aplicativo (ver a correção, abaixo).

2. **Junção de fase, função pura** (`src/shared/plugins/phase.ts`, novo).
   `withPhaseDocuments(core, documents)` devolve a lista de fase com cada documento ancorado inserido
   logo acima do arquivo de `before` (mais avançado que ele), na ordem da declaração quando dois
   apontam o mesmo arquivo; âncora que a lista não tem deixa o documento fora, e a lista original
   não é mutada.

3. **Leitor da fase** (`src/main/cards.ts`).
   `specInfo` passou a ler a lista com `withPhaseDocuments(layout.phaseFiles,
   phasePluginDocuments.files())`; o registro `phasePluginDocuments` é preenchido pelo módulo de
   plugins e devolve lista vazia por padrão, então um espaço sem plugins lê a fase exatamente como
   antes.

4. **Rótulos nos dois idiomas** (`src/shared/i18n/en.json`, `pt-BR.json`).
   Seis chaves novas, junto das que já existem: `cycle.agentFlow.phase.requirements|prototype|userManual`
   e `cycle.agentFlow.gate.requirements|prototype|userManual`. Nenhum literal novo na interface.

5. **Portão com o artefato escolhido** (`src/main/gate.ts`, `src/shared/types.ts`, `src/main/index.ts`).
   `gatePluginDocuments.files` devolve os tipos completos; a fonte de plugin calcula o portão de cada
   tipo — sem `flow`, portão 2 (o comportamento de sempre); com `flow` e sem `gate`, não é oferecido;
   com `flow.gate`, é oferecido ali, depois da fonte do ciclo. `pickGateOption(options, gate, file?)`
   abre o artefato que o botão nomeou quando ele casar com uma opção calculada daquele cartão, senão a
   primeira opção do portão (comportamento de hoje); `startGate(card, gate, file?)` e o canal
   `gate:start` repassam o parâmetro opcional. Um caminho fora do cartão nunca é aberto por parâmetro.

6. **Tela do portão** (`src/renderer/src/screens/Gate.tsx`).
   Um botão por artefato, com a chave pelo arquivo (antes, duas opções do mesmo portão dividiam a
   chave) e a chamada mandando o arquivo do próprio botão.

7. **Plugin embutido ligado por padrão** (`plugins/cycle-artifacts/`, com `README.md` curto nas duas
   línguas; `src/main/paths.ts` + `electron-builder.yml`; `src/main/plugins/read.ts`;
   `src/main/plugins/module.ts`).
   `PLUGINS_BUILT_IN_DIR` nomeia a pasta de plugins que sobe no pacote. `readPlugins(dir, config,
   builtInDir?)` lê a pasta do workspace primeiro (byte a byte, como sempre) e, da pasta do
   aplicativo, acrescenta só registros **sem código e sem alcance** — sem script, eventos, rede,
   escrita, configuração ou nota — que não estejam recusados e cujo `id` a pasta do workspace já não
   tenha; esses começam ligados (`choice?.enabled ?? true`) e a escolha guardada vale nos dois
   sentidos. Pasta ausente não derruba a leitura. `pluginsDeps.read` repassa a pasta do aplicativo e
   `enabledDocuments()` alimenta a fase e o portão, relendo a cada uso (ligar e desligar vale sem
   reiniciar).

8. **Produção nos dois modelos do ciclo de agentes** (`src/shared/cycles/templates/agentFlow.ts`).
   `refine` produz `1_SPEC.md` e `REQUIREMENTS.md`, `plan` produz `2_PLAN.md` e `PROTOTYPE.md`,
   `communicate` produz `6_RELEASE_NOTE.md` e `USER_MANUAL.md`; o modelo de engenharia ganha os de
   `refine` e `plan` e não ganha o manual (não tem `communicate`). O `specLayout` dos dois modelos não
   mudou.

9. **Migração v24→v25** (`src/shared/config/migrations.ts`, `CONFIG_SCHEMA_VERSION = 25` em
   `src/shared/config/types.ts`).
   A função troca a lista de produção de `refine`, `plan` e `communicate` só quando ela é exatamente a
   que veio com o aplicativo, com nota dizendo o que mudou; lista tocada pela pessoa fica intacta e
   ganha nota própria; segunda passagem não mexe. Não há mudança de formato: `defaults.ts` e
   `schema.ts` ficaram como estavam, e execuções em andamento seguem no fluxo com que começaram.

10. **Documentação** (`docs/cycles.md`, `docs/plugins/README.md`, nas duas línguas; `CHANGELOG.md` sob
    `## [Unreleased]`). A documentação de cycles diz que o ciclo de agentes produz os três arquivos,
    que o gate 1 lê a spec e os requisitos, o gate 2 lê o plano e o protótipo e que o manual sai junto
    da nota de lançamento; a documentação de plugins diz o que é documento de fluxo e o que é
    colateral, que declarações sem código vêm do aplicativo, ligadas por padrão, e que os nomes de
    documento do próprio aplicativo ficam com ele. `AGENTS.md` não precisou mudar.

## A correção desta tentativa (bloqueante da revisão)

A revisão achou que o plugin embutido vencia o rótulo, não a escrita: um plugin de terceiro que
declaresse `USER_MANUAL.md` gravava, pela primeira fonte de documento do registro, por cima do manual
que o aplicativo acabara de produzir na pasta do ciclo. O que fecha o buraco:

- **`chain` no tipo de documento** (`src/shared/plugins/declaration.ts`): `true` num documento lido da
  pasta do aplicativo; é o que marca o nome como sendo do fluxo.
- **A recusa na leitura da pasta do workspace** (`src/main/plugins/read.ts`): depois de ler as duas
  pastas, os nomes dos documentos `chain` das declarações do aplicativo que são **sem código, sem
  alcance e estão ligadas** formam o conjunto que o fluxo possui; uma declaração da pasta do workspace
  que ofereça um desses nomes volta com `enabled: false`, `refused` preenchido (chave
  `main.plugins.refused.flowDocument`, nos dois idiomas) e nada oferecido — o registro, e assim a
  escrita, não a inclui. Com a pasta do aplicativo ausente, ou com a declaração dela desligada, nada é
  retido: um espaço de trabalho nunca fica sem ler as próprias pastas.
- **A guarda da escrita** (`src/main/plugins/runtime.ts`): `writePluginDocument` devolve `null` para um
  documento `chain`, seja qual for o caminho que o chamou; é a segunda barreira, para que a primeira
  fonte do registro nunca seja um plugin num arquivo do fluxo.
- **Tipos** (`src/main/plugins/types.ts`): `PluginRecord.documents` passou de `{ name, label }[]` para
  `PluginDocumentType[]` (`flow` entra na fase e no portão pelo registro, como antes).

## Testes: um por comportamento

| Comportamento | Onde coberto |
|---|---|
| A declaração aceita `flow` e recusa o que não presta | `test/plugins-core.test.ts` (gate 1/2 aceitos, `before` com pasta/oculto/vazio recusado, `flow` vazio recusado, declaração sem `flow` igual à de sempre) |
| Junção da fase na âncora, ordem da declaração, âncora ausente, colateral de fora, cópia da lista | `test/phase-flow-documents.test.ts` (arquivo novo, função pura) |
| A fase lê os tipos novos com o registro ligado e é a de hoje sem ele; âncora desconhecida não entra | `test/config-getters.test.ts` |
| Tipo novo cai no portão declarado; pasta só com requisitos abre o gate 1; manual não é artefato de portão; colateral segue no portão 2 | `test/gate-plugin-documents.test.ts` |
| O portão abre o artefato do botão e recusa arquivo fora do cartão | `test/gate-plugin-documents.test.ts` (`pickGateOption`) |
| Plugin embutido ligado por padrão, escolha guardada nos dois sentidos, cópia da pessoa vence, código/alcance não vira embutido, pasta ausente não derruba | `test/plugin-builtin.test.ts` |
| **Um plugin da pasta do workspace não responde por um documento do fluxo** | `test/plugin-builtin.test.ts` (recusa com o nome no motivo; a declaração do aplicativo é a única fonte; com ela desligada nada é retido; nome colateral segue do plugin) |
| **Um documento `chain` nunca é escrito por um plugin** | `test/plugin-runtime.test.ts` (o arquivo que a etapa escreveu fica intacto) |
| O leitor de documentos relê a cada chamada (desligar tira os tipos) | `test/plugin-builtin.test.ts` (`enabledDocuments`) |
| O plugin embutido declara exatamente os três tipos, com portões e âncoras | `test/plugin-builtin.test.ts` (lê o `plugin.json`) |
| O fluxo produz os três onde a especificação coloca, nos dois modelos | `test/cycle-templates.test.ts` |
| Rótulos dos seis nos dois idiomas, com o texto esperado | `test/cycle-templates.test.ts` |
| Produção de ponta a ponta com respostas falsas grava os documentos na pasta do ciclo | roteiros falsos de `test/runner-*.test.ts` (o churn mecânico que a mudança exige) e `test/runner-golden.test.ts` (traços regravados) |
| Etapa sem um dos documentos: um pedido nomeando o que falta, depois falha | `test/runner-missing-documents.test.ts`, incluindo o caso de lista de dois documentos com um faltando |
| Espaço existente ganha os arquivos; lista editada não muda; segunda passagem não mexe; versão 26 recusada | `test/config-migrations.test.ts` |
| Portões da mudança: tipos, tema, i18n, área pública, compilação | `npx tsc --noEmit`, `scripts/theme-audit.mjs`, `npm run i18n:lint`, `scripts/public-audit.mjs`, `npx electron-vite build` |

## O que foi verificado nesta etapa (2026-10-10)

Tudo abaixo rodou nesta tentativa, com o resultado registrado:

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | sem erros (exit 0) |
| `npx vitest run` (suíte completa) | 416 arquivos verdes, 1 pulado; 6952 testes verdes, 3 pulados |
| `npx vitest run` dos arquivos tocados (plugin-builtin, plugin-runtime, plugins-core) | 47 testes verdes |
| `npx vitest run` de gate-plugin-documents, config-getters, phase-flow-documents e vizinhos | 44 testes verdes |
| `node scripts/theme-audit.mjs` | verde |
| `npm run i18n:lint` | 5483 chaves nos dois idiomas, 12 catálogos, nenhum problema |
| `node scripts/public-audit.mjs` | verde em 1591 arquivos, 0 achados |
| `npx electron-vite build` | construído, exit 0 |

## O que não foi verificado

- **Os aceites no aplicativo com modelos de verdade** (uma execução real passando pelo refinamento,
  pelo plano e pelo fim, com os três documentos na pasta e o manual ao lado da nota): verificação de
  QA, como o plano declara.
- **Desligar o plugin na lista e ver fase e portão mudarem sem reiniciar** (o reler a cada chamada está
  testado; o efeito na tela é verificação de QA).
- **Um quarto tipo instalado e aberto numa tela** (o mecanismo está coberto por teste; a demonstração é
  manual).
- **Um espaço de trabalho real aberto depois da migração** (a migração está testada com objetos).
- **O clique nos botões do portão** na janela: o mecanismo tem teste, a tela não.
- **A recusa de um plugin do espaço de trabalho vista na tela de plugins**: o registro e o motivo estão
  testados; a linha na lista é verificação de QA.
