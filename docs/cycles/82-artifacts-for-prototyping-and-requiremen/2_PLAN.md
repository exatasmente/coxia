# Plano dos documentos de requisitos, protótipo e manual do usuário

O comportamento pedido, com suas regras e seu aceite, está em `1_SPEC.md`. Este documento é
só o caminho técnico: o que muda, em que ordem, como é testado e o que cada decisão resolve.

## Comportamento que este plano entrega

Três tipos de documento do ciclo — requisitos, protótipo e manual do usuário — passam a vir
com o aplicativo numa declaração de plugin que não tem código, ligada por padrão. Cada tipo
diz em qual portão aparece e em que ponto da ordem de fase entra, ancorado num arquivo que o
ciclo daquele espaço já conta; um documento de plugin sem essa declaração continua sendo
colateral, como é hoje (portão 2, fora da fase). O fluxo do ciclo de agentes passa a produzir
os três documentos — no refinamento, no plano e na etapa que fecha a execução junto da nota de
lançamento — e é a única coisa que muda em espaços que já existem: a migração acrescenta os
arquivos à lista de produção só onde a lista ainda é a que veio com o aplicativo. A tela do
portão passa a ter um botão por artefato, e o botão que a pessoa aperta é o que abre o portão
com aquele documento.

## O que foi lido para fechar este plano (nada foi executado)

Nenhum teste, compilação, auditoria ou aplicativo rodou nesta etapa. Os pontos abaixo foram
conferidos **por leitura** nesta árvore:

| Ponto | Onde | O que diz |
|---|---|---|
| Fase do cartão | `src/main/cards.ts:28-40` | a fase é o primeiro arquivo presente de `specLayout.phaseFiles`, ordenada do mais avançado para o primeiro; sem nenhum, a frase de "sem artefato" |
| Lista de fase e portões | `src/shared/config/types.ts:246-279` | `PhaseFile` é só arquivo+rótulo (sem rank, sem âncora); `GateFiles` traz `[arquivo, rótulo]` por portão |
| Portão: fontes | `src/main/gate.ts:106-125` | soma a fonte do ciclo com os documentos de plugin, e estes entram com o número `2` fixo |
| Portão: escolha | `src/main/gate.ts:174-176` | abre a **primeira** opção daquele número |
| Registro dos documentos | `src/main/plugins/module.ts:665` | lê os plugins no momento de uso, só os ligados e não recusados (trocar vale sem reiniciar) |
| Tela do portão | `src/renderer/src/screens/Gate.tsx:196-200` | um botão por opção, chave pelo **número** do portão, todos abrindo aquele número |
| Assinaturas vistas pela tela | `src/shared/types.ts:516-517`, canais em `src/main/index.ts:211-212` | `startGate(card, gate)` ainda não escolhe artefato |
| Declaração de documento | `src/shared/plugins/declaration.ts:16-22,197-203` | tipo é `name` + `label`; rótulo é chave de catálogo ou literal; sem recusa própria para mais nada |
| Padrão de recusa | `src/shared/plugins/declaration.ts:102-121` | um motivo por campo, em inglês |
| Estado do plugin | `src/main/plugins/read.ts:105-111` | sem escolha guardada, fica desligado; `:132-137` a pasta é a do workspace; `:164-168` a escolha é gravada por identidade |
| Único plugin do repositório | `plugins/web-search/plugin.json` | tem código, configuração e acontecimentos; declaração com execução |
| Onde o aplicativo acha suas coisas | `src/main/paths.ts:8-11`, `electron-builder.yml:23-31` | a pasta dos dados implantados sobe `resources` e `sidecar`; **não** sobe `plugins` |
| Produção dos documentos | `src/shared/cycles/templates/agentFlow.ts:14-38,74-92` | quais etapas produzem quais arquivos, e o `specLayout` dos dois modelos do ciclo de agentes |
| Aviso da etapa, pedido único e ignorado | `src/main/runner/prompt.ts:288`, `src/main/runner/executor.ts:733-745,1163-1175,1246-1263` | a etapa é avisada do que produz; falta uma vez, depois falha; documento fora da lista é ignorado |
| Distinção da pasta | `src/main/runner/git.ts:257-271` | o que se apaga fora da pasta do ciclo; dentro nada é removido |
| Verificação do fluxo | `src/shared/runs/flowCheck.ts:97-101` | `reads` sem produtor é erro; dois produtores do mesmo arquivo é erro |
| Migração | `src/shared/config/types.ts:5`, `src/shared/config/migrations.ts:10-45,207-226,379` | versão 24; passos em `STEPS` (fecha em `v23ToV24`); a migração que trocou o fluxo compara com a **lista gravada** |
| Idiomas | `src/shared/i18n/index.ts:35-38`, `src/shared/cycles/text.ts:24-27`, `src/main/cyclePrompts.ts:19-21` | rótulo é chave de catálogo ou literal; os catálogos `en.json`/`pt-BR.json` trazem `cycle.agentFlow.phase.*` (`:630-634`) e `cycle.agentFlow.gate.*` (`:635-636`) |
| Onde o rótulo aparece | `ui-gate.*.json:102` ("Gate {gate} — {label}"), `TodayParts.tsx:165`, `Deep.tsx:206`, `Call.tsx:355`, `PluginsSection.tsx:92-117` | a lista de artefatos do portão são os botões; a fase vem pronta do processo principal; a lista de plugins mostra nome e nomes de arquivo |
| Testes que isto toca | `test/gate-plugin-documents.test.ts`, `test/config-getters.test.ts:32-84`, `test/plugins-core.test.ts`, `test/cycle-templates.test.ts:404-447`, `test/config-migrations.test.ts`, `test/runner-missing-documents.test.ts`, `test/runner-business.test.ts:44-54`, `test/runner-chain.test.ts:18-26`, `test/helpers/promptCapture.ts:169` | como os comportamentos estão cobertos hoje e onde os casos novos entram |

## A mudança, arquivo por arquivo

**1. `src/shared/plugins/declaration.ts` — o tipo novo ganha `flow`.**
`PluginDocumentType` passa a ser `{ name, label, flow? }`, com
`flow: { gate?: 1 | 2; phase?: { label?: string; before: string } }`:
`gate` diz em qual portão o documento é oferecido; `phase` diz o rótulo da fase (sem ele, o
`label` do documento) e `before`, o arquivo do ciclo **logo acima** do qual o documento entra.
`readPluginDeclaration` valida: `gate` só `1` ou `2`; `phase.before` um nome de arquivo simples
(o mesmo `ARTIFACT_NAME` que já valida o `name`); `flow` presente precisa trazer um dos dois.
Recusa com motivo próprio em `REASONS` (`flow`), no mesmo estilo dos demais.
Sem `flow` nada muda: continua sendo o tipo de sempre, colateral.

**2. `src/shared/plugins/phase.ts` (arquivo novo) — a junção, função pura.**
`withPhaseDocuments(core: PhaseFile[], documents: PluginDocumentType[]): PhaseFile[]`
devolve a lista de fase com cada documento de `flow.phase` inserido **antes** da entrada do
seu `before` (ou seja, mais avançado que ela), na ordem da declaração quando dois apontam o
mesmo arquivo. `before` que a lista não tenha: o documento não entra (a fase não muda).
A lista do ciclo preserva posição e rótulo; sem documentos, é a de hoje — cópia, não mutação
 da lista original.

**3. `src/main/cards.ts` — o leitor da fase vê os tipos novos.**
Registro no estilo do que já existe, `phasePluginDocuments.files: () => PluginDocumentType[]`
(`files: () => []` por padrão), lido no momento de uso. Em `specInfo` (:38) a lista passa a
ser `withPhaseDocuments(layout.phaseFiles, phasePluginDocuments.files())` antes do `find`;
o resto (`has`, rótulo via `cycleWord`, `planFile`, a frase de "sem artefato") é intocado.

**4. Rótulos novos nos dois idiomas.** Em `src/shared/i18n/en.json` e `pt-BR.json`,
junto das chaves atuais (`:630-636`): `cycle.agentFlow.phase.requirements`,
`.phase.prototype`, `.phase.userManual` ("requirements written"/"requisitos escritos",
"prototype written"/"protótipo escrito", "user manual written"/"manual do usuário escrito")
e `cycle.agentFlow.gate.requirements`, `.gate.prototype`, `.gate.userManual`
("Requirements"/"Requisitos", "Prototype"/"Protótipo", "User manual"/"Manual do usuário").
São seis chaves; nada novo nos catálogos `ui-*`.

**5. `src/main/gate.ts` — o portão de cada tipo e o artefato escolhido.**
`gatePluginDocuments.files` passa a devolver `PluginDocumentType[]`. Em `gateOptions`
(:119-124) a fonte de plugin calcula o número: sem `flow` é `2` (hoje, e segue); com
`flow` e sem `gate` não é oferecido; com `flow.gate` é oferecido nele — procurado na raiz e
nas subpastas como agora, depois da fonte do ciclo, que continua primeira. A escolha sai de
uma função pequena e testável, `pickGateOption(options, gate, file?)`: o arquivo que a tela
nomiou se ele casar com uma opção calculada **para aquele cartão**, senão a primeira opção do
número (o comportamento de hoje, inclusive para quem não manda arquivo nenhum).
`startGate(card, gate, file?)` usa essa função; o erro de "sem artefato" continua igual.
A forma `{ gate, label: cycleWord(label), file }` não muda, então `watchers.ts:81` e o
`quizFile` de `:188` seguem como estão.

**6. `src/shared/types.ts:517` e `src/main/index.ts:212` — o parâmetro opcional.**
`startGate(card: Card, gate: 1 | 2, file?: string)`, repassado pelo canal `gate:start`;
`gate:get` e os demais canais não mudam.

**7. `src/renderer/src/screens/Gate.tsx:196-200` — um botão por artefato.**
Chave do botão pelo arquivo (`key={o.file}` — hoje duas opções do mesmo número dividem
chave), o texto continua `ui.gate.pick.option` com portão e rótulo, o identificador do
trabalho leva o arquivo também, e a chamada passa `o.file`. Sem chave nova de interface.

**8. `plugins/cycle-artifacts/plugin.json` (pasta nova, com um `README.md` curto) — a
declaração embutida.**

```json
{
  "id": "cycle-artifacts",
  "name": "Cycle documents",
  "contract": 1,
  "offers": {
    "documents": [
      { "name": "REQUIREMENTS.md", "label": "cycle.agentFlow.gate.requirements",
        "flow": { "gate": 1, "phase": { "label": "cycle.agentFlow.phase.requirements", "before": "1_SPEC.md" } } },
      { "name": "PROTOTYPE.md", "label": "cycle.agentFlow.gate.prototype",
        "flow": { "gate": 2, "phase": { "label": "cycle.agentFlow.phase.prototype", "before": "2_PLAN.md" } } },
      { "name": "USER_MANUAL.md", "label": "cycle.agentFlow.gate.userManual",
        "flow": { "phase": { "label": "cycle.agentFlow.phase.userManual", "before": "6_RELEASE_NOTE.md" } } }
    ]
  }
}
```

Sem `events`, sem `entry`, sem `network`, sem `write`, sem `settings` e sem nota que fale com
os agentes: é uma declaração que só nomeia documentos. O manual tem `flow` sem `gate`: ele não
é artefato de portão nenhum, porque existe depois do último.

**9. `src/main/paths.ts` + `electron-builder.yml` — a pasta do aplicativo.**
`export const PLUGINS_BUILT_IN_DIR = join(BASE, 'plugins')` ao lado de `RESOURCES` e
`SIDECAR_DIR`, comentando que essa pasta logo sobe no pacote. `extraResources` ganha `from:
plugins, to: plugins`. As linhas de cabeçalho de `paths.ts:4` e do `extraResources`
acompanham.

**10. `src/main/plugins/read.ts` — o que vem com o aplicativo, e o padrão ligado.**
`readPlugins(dir, config, builtInDir?)` lê primeiro a pasta do workspace (comportamento
atual, byte a byte) e, se `builtInDir` existir, acrescenta como embutidos só os registros
**sem código e sem alcance** (`!entry`, sem `events`, sem `network`, sem `write`, sem
`settings`, sem nota) que não estejam recusados e cujo `id` a pasta do workspace já não tenha
(a cópia da pessoa vence a do aplicativo). O embutido começa ligado:
`enabled: choice?.enabled ?? true`; a escolha guardada vale nos dois sentidos. Uma pasta de
aplicativo inexistente não derruba a leitura e não põe nada na lista. Um plugin colado na
pasta do workspace continua desligado por padrão, como hoje.

**11. `src/main/plugins/module.ts` — o registro duplo.**
`pluginsDeps.read` passa a repassar `PLUGINS_BUILT_IN_DIR`. Uma função única
`enabledDocuments()` (registros ligados e não recusados, `flatMap` dos `documents`) alimenta
o registro de `:665` e `phasePluginDocuments`, chamada a cada uso — ligar e desligar vale sem
reiniciar, como já vale no portão.

**12. `src/shared/cycles/templates/agentFlow.ts` — o fluxo produz.**
`AGENT_FLOW_STAGES`: `refine` produz `['1_SPEC.md', 'REQUIREMENTS.md']`, `plan`
`['2_PLAN.md', 'PROTOTYPE.md']`, `communicate` `['6_RELEASE_NOTE.md', 'USER_MANUAL.md']`,
com um comentário dizendo que os três vêm da declaração embutida e só existem se o fluxo os
produzir. `ENGINEERING_FLOW_STAGES` recebe os de `refine` e `plan` (não tem `communicate`,
então não ganha o manual). O `specLayout` dos dois modelos **não** muda.

**13. `src/shared/config/migrations.ts` + `src/shared/config/types.ts` — a migração.**
Linha nova no histórico, função `v24ToV25`, `24: v24ToV25` em `STEPS`, `CONFIG_SCHEMA_VERSION`
para 25 e as linhas de cabeçalho que citam o número acompanhando (`types.ts:1` e as do
`schema.ts`, a conferir na implementação). A função percorre `devCycle.stages` e troca a lista
só quando ela é **exatamente** a que veio com o aplicativo (`['1_SPEC.md']` em `refine`,
`['2_PLAN.md']` em `plan`, `['6_RELEASE_NOTE.md']` em `communicate`), gravando nota dizendo o
que mudou; lista tocada pela pessoa fica intacta e ganha nota própria. Não há mudança de
formato, então `defaults.ts` e `schema.ts` não mudam — `test/config-schema.test.ts` é o portão
que confirma o trio. Execuções em andamento não são tocadas: cada uma continua no fluxo com
que começou (`runs:migrateFlow` move uma execução se a pessoa quiser).

**14. Docs e changelog.** `docs/cycles.md` (as duas seções, português e inglês): a linha de
`specLayout` ganha a frase de que documentos com `flow` entram na ordem de fase na sua
âncora; a seção do ciclo de agentes ganha os três arquivos na lista de produção, os portões 1
e 2 com o artefato novo e o manual junto da nota; a linha da etapa de comunicação cita o
manual. `docs/plugins/README.md` (as duas línguas): a linha de `offers.documents` passa a
`name`, `label` e `flow`, seguida de um parágrafo curto dizendo o que é colateral e o que é
documento de fluxo, e de uma nota de que declarações sem código vêm do próprio aplicativo,
ligadas por padrão. `CHANGELOG.md`, sob `## [Unreleased]`: entrada única, em inglês, dizendo
que a pasta do ciclo ganha requisitos, protótipo e manual, que os três vêm de um plugin
embutido ligado por padrão e que fase e portão os leem. `AGENTS.md` não precisa mudar: nenhuma
instrução dele fica falsa.

## Ordem de trabalho

Cada passo deixa os testes do passo verdes antes do próximo.

1. `declaration.ts` (tipo `flow` + validação) e seus casos em `test/plugins-core.test.ts`.
2. `phase.ts` (função pura) e `test/phase-flow-documents.test.ts`.
3. Seis chaves nos dois catálogos (a fase e o portão já passam a resolver nos testes).
4. `cards.ts` + casos em `test/config-getters.test.ts`.
5. `gate.ts` + `types.ts` + `index.ts` + casos em `test/gate-plugin-documents.test.ts`.
6. `Gate.tsx` (botão por artefato; não tem teste de tela, verificado na revisão e na QA).
7. Plugin embutido: `plugins/cycle-artifacts/`, `paths.ts`, `electron-builder.yml`, `read.ts`,
   `module.ts` + `test/plugin-builtin.test.ts`.
8. Produção: `agentFlow.ts`, `test/cycle-templates.test.ts` e os roteiros falsos das execuções
   (`runner-business`, `runner-chain`, `runner-squads*` — mudança mecânica: os roteiros das
   etapas que agora produzem três documentos devolvem os três).
9. Migração: `migrations.ts`, `types.ts`, `test/config-migrations.test.ts`.
10. `test/runner-missing-documents.test.ts` (pedido único cobrindo a lista de dois documentos).
11. `docs/cycles.md`, `docs/plugins/README.md`, `CHANGELOG.md`.
12. Os portões da mudança: tipos, testes completos, auditoria de tema, `i18n:lint`, área
    pública e compilação — **nada disso rodou nesta etapa**; é da implementação e da revisão.

## Testes: um por comportamento

| Comportamento (aceite) | Arquivo de teste | O caso |
|---|---|---|
| A declaração aceita `flow` e recusa o que não presta | `test/plugins-core.test.ts` | `gate` 1/2 aceito, `gate` 3 recusado, `before` com pasta ou vazio recusado, `flow` vazio recusado, declaração sem `flow` segue igual |
| O quarto tipo de um plugin existe sem mudança no aplicativo (9) | `test/plugins-core.test.ts`, `test/phase-flow-documents.test.ts`, `test/gate-plugin-documents.test.ts` | um tipo qualquer com `flow` é lido, entra na fase na sua âncora e aparece no portão que declarou, sem tocar em nenhum outro código |
| A fase leva os três em conta, na ordem (1, 2, 4) | `test/phase-flow-documents.test.ts`, `test/config-getters.test.ts` | âncora desconhecida não entra; dois na mesma âncora guardam a ordem da declaração; lista sem documentos é a de hoje; com o registro ligado, pasta só com `REQUIREMENTS.md` mostra a fase dos requisitos e pasta com `2_PLAN.md` + `PROTOTYPE.md` mostra a do protótipo |
| Sem plugin ligado, a fase é a de hoje (6, 10) | `test/config-getters.test.ts` | registro vazio devolve o mesmo texto que antes |
| Colateral não move a fase e segue no portão 2 (6) | `test/phase-flow-documents.test.ts`, `test/gate-plugin-documents.test.ts` | documento sem `flow` fica fora da junção e continua com `gate: 2` |
| Tipo novo cai no portão certo e o primeiro nunca fica sem artefato (5) | `test/gate-plugin-documents.test.ts` | pasta só com o documento de requisitos abre o portão 1; com spec e documento, as duas opções existem; `flow` sem `gate` não aparece |
| O botão abre o portão com o artefato daquele botão | `test/gate-plugin-documents.test.ts` | escolha por arquivo; arquivo fora da lista do cartão cai de volta na primeira opção do número (é a porta de segurança) |
| O plugin embutido vem ligado sem escolha guardada (6) | `test/plugin-builtin.test.ts` | leitura da pasta do aplicativo: declaração sem código e sem alcance entra ligada; escolha guardada vale nos dois sentidos; a cópia na pasta do workspace vence; declaração com código na pasta do aplicativo não vira embutida; pasta ausente não derruba a leitura |
| Desligar tira os tipos da leitura (6, 7) | `test/plugin-builtin.test.ts` | o provedor de documentos relê a cada chamada: registro desligado devolve lista vazia, ligado devolve os três — a verificação da tela sem reiniciar fica para a QA |
| O plugin declara exatamente os três tipos esperados (1) | `test/plugin-builtin.test.ts` | lê `plugins/cycle-artifacts/plugin.json` e confere nomes, portões e âncoras |
| O fluxo produz os três onde a spec coloca (1, 2, 3) | `test/cycle-templates.test.ts` (atualiza a lista de `:407`), `test/runner-business.test.ts` | `produces` por etapa nos dois modelos; execução de ponta a ponta com respostas falsas grava `REQUIREMENTS.md`, `PROTOTYPE.md` e `USER_MANUAL.md` na pasta do ciclo |
| Etapa sem um dos seus documentos é pedida uma vez e depois falha (8) | `test/runner-missing-documents.test.ts` | lista com dois documentos, um faltando: um pedido nomeando o que falta, depois falha |
| Espaço já existente ganha os arquivos e o editado não muda (10) | `test/config-migrations.test.ts` | `v24ToV25` nas duas listas antigas intactas; lista com coisa a mais fica como está; segunda passagem não mexe; versão 25 e 26 recusada (padrão atual) |
| Rótulos nos dois idiomas (i18n) | `test/cycle-templates.test.ts` | as seis chaves resolvem em `pt-BR` e `en`, com o texto esperado |
| Portões da mudança | — | tipos, testes completos, auditoria de tema, `i18n:lint`, área pública e compilação: **não executados nesta etapa** |

## Riscos e como se evitam

1. **Dois botões com o mesmo número de portão.** Hoje já é possível (a busca web soma no
   portão 2) e a chave deles colide. Contido trocando a chave para o arquivo e mandando o
   arquivo para o portão, com a escolha numa função pura testada. O que não tem teste
   automatizado é o clique da tela — verificação de QA listada no fim.
2. **Espaço com lista de fase que não tem a âncora** (outro ciclo, layout editado). A junção
   não insere e a fase fica exatamente como hoje; caso da função pura. Efeito colado dito: num
   ciclo que tenha `2_PLAN.md`, `PROTOTYPE.md` valeria acima dele se o arquivo existir na
   pasta — esses ciclos não produzem o documento, então na prática ele não aparece.
3. **Espaço já existente.** A migração só mexe em lista idêntica à antiga, é idempotente,
   avisa o que fez, não toca em formato e não toca em execuções em andamento; o teste cobre os
   dois modelos e a lista editada.
4. **A versão do arquivo subir.** Um aplicativo mais antigo recusa o arquivo em vez de
   degradá-lo — é o comportamento dos bumps anteriores (`migrations.ts:10-45`), aceito como
   está.
5. **A pasta do aplicativo não subir no pacote.** `electron-builder.yml` ganha a entrada e
   `paths.ts` nomeia a constante; a leitura tolera pasta ausente (testado), então nada quebra
   em desenvolvimento nem num pacote incompleto.
6. **Fronteira de segurança.** O arquivo que a tela manda só é usado se casar com uma opção
   calculada para aquele cartão — nenhum caminho novo é aberto por parâmetro. O embutido é
   filtrado por capacidade (sem código, sem rede, sem escrita, sem configuração, sem nota que
   fale com os agentes), então um plugin colado na pasta do aplicativo que traga alcance algum
   não é tratado como embutido.
7. **Regressão do comportamento atual.** Com o registro vazio, fase e portão devolvem o mesmo
   de antes; os casos existentes dos dois arquivos seguem intactos e um deles afirma a
   igualdade.
8. **Churn nos roteiros falsos.** As execuções de teste que rodam o fluxo do ciclo de agentes
   passam a precisar dos arquivos novos; a suíte aponta quem falta (o erro é "documento
   ausente") e a lista do template, fixada por teste, impede resolver tirando o documento do
   `produces`.
9. **Auditoria pública e de idioma.** O `plugin.json` só traz nomes de arquivo e chaves de
   catálogo, neutros; as seis chaves ficam nos dois catálogos e a tela não ganha literal.

## Decisões e o motivo de cada uma

1. **O tipo novo entra como campo da declaração (`flow`), não como campo da configuração.**
   Motivo: o pedido é que tipo novo seja declaração de plugin; mexer em `specLayout` mudaria o
   formato da configuração, obrigaria migração também ali e amarraria a fase a um plugin que
   pode ser desligado (e hoje, desligado, some da leitura).
2. **A posição na fase é uma âncora por nome de arquivo, e não um número.** Motivo: a ordem de
   fase é da configuração de cada espaço e não tem escala compartilhável; ancorar em "logo
   acima de `1_SPEC.md`" ordena contra a lista que o próprio espaço já tem, sobrevive a
   qualquer edição dessa lista (âncora ausente = não conta) e permite um quarto tipo de
   qualquer plugin sem escala nova nem código novo.
3. **Um único campo separa documento de fluxo de documento colateral.** Motivo: é a
   distinção que a spec deixa para esta etapa — colateral (busca, qualquer efeito de etapa)
   mantém o comportamento de hoje (portão 2, fora da fase) e o que é do fluxo declara portão e
   âncora. Um campo, uma regra, sem lista de nomes no núcleo.
4. **Manual sem `gate`.** Motivo: o manual é lido por nada depois de escrito, e um `gate` nele
   o colocaria em competência do portão 2 junto com o protótipo, que é ali que vale.
5. **O que vem com o aplicativo é a pasta de plugins do próprio aplicativo, e a regra é por
   capacidade, não por nome.** Motivo: copiar para a pasta do workspace sumiria quando a
   pessoa aponta `plugins.dir` para outro lugar e duplicaria com cópia da própria pessoa;
   ler da pasta do aplicativo cobre espaço novo e antigo sem migração, e o filtro por
   capacidade mantém a busca web exatamente como está (ela tem código e configuração,
   continua manual e desligada) — sem efeito colateral sobre nenhum espaço.
6. **Embutido ligado por padrão, sem migração de configuração.** Motivo: o padrão é calculado
   na leitura (`choice?.enabled ?? true`, só para o embutido), então a escolha guardada
   continua sendo a única coisa gravada e um espaço que já existia ganha o plugin sozinho;
   escrever `plugins.list` na migração seria mudar formato para um valor que já deriva.
7. **Produção vive no `produces` do fluxo, com migração por igualdade exata.** Motivo: é o
   único caminho que faz a etapa avisar quem trabalha, aceitar o documento e pedi-lo uma vez
   antes de falhar (`executor.ts:744,1163-1175,1262`); a migração por igualdade preserva o
   princípio de que fluxo editado é dado da pessoa (mesmo critério do histórico em
   `migrations.ts:207-226`).
8. **O portão abre o artefato do botão.** Motivo: com dois documentos no mesmo número, a tela
   anunciava um rótulo e abria outro; escolher por arquivo corrige isso também para a busca
   web, e o parâmetro ser opcional mantém quem não manda nada com o comportamento de hoje.
9. **Rótulos vêm das chaves do catálogo do próprio aplicativo.** Motivo: as duas formas já
   são aceitas (`cycleText`: chave ou literal), o embutido precisa de idioma e um plugin de
   terceiro continua livre para escrever o literal no próprio arquivo.
10. **Sem mudança de formato: `defaults.ts` e `schema.ts` ficam como estão.** Motivo: só o
    conteúdo armazenado muda (`produces` existe desde a v8); a regra dos três arquivos existe
    para divergência de formato, e `test/config-schema.test.ts` é quem confirma que não
    houve.

## O que este plano não cobre

Dito aqui porque não tem teste para eles:

- **Aceite 1, 2 e 3 no aplicativo** (uma execução real passando por refinamento, plano e fim,
  com os três documentos na pasta e o manual ao lado da nota): exige modelos de verdade. O
  que se prova aqui é a mesma produção com respostas falsas.
- **Aceite 7 no aplicativo** (desligar na lista e ver fase e portão mudarem sem reiniciar):
  a leitura a cada chamada está testada; o efeito visível na tela é verificação de QA.
- **Aceite 9 mostrado numa tela** (instalar um quarto tipo e abrir o portão): o mecanismo está
  coberto por teste; a demonstração é manual.
- **Aceite 10 com um espaço real** (abrir a pasta de quem usa): a migração está testada com
  objetos; abrir dado real nunca é teste automatizado.
- **Os portões da mudança** (tipos, testes, tema, i18n, área pública, compilação): nada foi
  executado nesta etapa; qualquer um deles vermelho não é "pronto".

## Verificação desta etapa

Somente leitura: as linhas da tabela de leitura acima e os testes existentes que o plano
estende foram abertos e conferidos nesta árvore; nenhum portão de verificação rodou. As
comprovações das leituras estão em duas notas guardadas nesta execução: a da especificação
(`ev-1`) e a deste plano (`ev-2`).
