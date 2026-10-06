# O Coxia aceita plugins: como ficou implementado

## O que passou a existir

A plataforma de plugins foi implementada sobre o plano aprovado, sem reabrir a spec. As peças:

- **A seção `plugins` da configuração** (esquema 13): a pasta de plugins do espaço de trabalho, a lista do que
  está ligado e o que a pessoa concedeu a cada um. Um espaço de trabalho sem plugins continua válido e se
  comporta como antes.
- **O núcleo puro do plugin** (`src/shared/plugins/`): a leitura e a validação da declaração (`plugin.json`) e a
  lista fixa de acontecimentos. Função pura — não toca em disco, processo nem sistema, então o mesmo caminho
  roda no Linux, no macOS e no Windows.
- **O serviço de plugins** (`src/main/plugins/`): lê a pasta, publica a lista para a interface, liga e desliga
  (só o computador), roda o script do plugin pela mesma sandbox da etapa e entrega o que o plugin pediu para
  escrever à porta única de Ações.
- **O gatilho automático no ciclo** (`src/main/runner/`): o runner chama o serviço de plugins nos quatro
  acontecimentos do catálogo, no lugar onde eles já acontecem. É o que faz um plugin ligado reagir de verdade a
  uma execução, sem reinício e sem tocar no caminho de execução além das chamadas.
- **O kit no repositório** (`docs/plugins/`): o contrato, a lista de acontecimentos, a fronteira, o destino
  neutro da escrita externa e o exemplo que compila e roda, base da primeira entrega (busca na web para os
  agentes).

## O que mudou em cada peça

### A configuração

- `src/shared/config/types.ts`: `CONFIG_SCHEMA_VERSION` sobe para 13; entram `PluginsConfig` e `PluginConfig`, e
  `WorkspaceConfig` ganha a seção `plugins`.
- `src/shared/config/defaults.ts`: `neutralPlugins()` devolve `{ dir: null, list: [] }` e `neutralConfig()` a inclui.
- `src/shared/config/schema.ts`: a seção `plugins` no JSON Schema, com os campos documentados.
- `src/shared/config/migrations.ts`: o degrau `v12ToV13` escreve `plugins` vazio quando falta, mantém uma seção
  que já exista e não toca no resto. É idempotente e não lê o disco.
- `src/main/config-resolve.ts`: `ResolvedConfig.pluginsDir` resolve a pasta (o que `plugins.dir` lista, com `~/`,
  ou a pasta `plugins` dos dados). `src/main/plugins/read.ts` (`pluginsDirOf`) é a fonte dessa expansão.

### O núcleo puro

- `src/shared/plugins/events.ts`: `PLUGIN_EVENTS` (`stage-entered`, `stage-finished`, `gate-decided`,
  `run-finished`) e `isPluginEvent`. É a lista fixa e pública, separada do canal de interface (`AppEvent`).
- `src/shared/plugins/declaration.ts`: `readPluginDeclaration(texto, pasta)` devolve o plugin desdobrado ou a
  recusa com o motivo. Recusas: declaração vazia/não-JSON/não-objeto, sem nome, sem identidade, identidade que
  não é um id, versão de contrato desconhecida, acontecimento fora do catálogo, nome de documento que a pasta do
  ciclo não aceita, destino de escrita ou script de entrada que escapa da pasta, e destino de rede que não é
  nome de host. `ARTIFACT_NAME` de `src/shared/runs/output.ts` é a regra do nome de documento.
- `src/shared/plugins/index.ts`: o kit como o app publica (re-export do contrato e dos acontecimentos).

### O serviço

- `src/main/plugins/read.ts`: percorre a pasta, lê cada `plugin.json`, aplica a escolha da pessoa por identidade
  e devolve um registro por plugin. Uma declaração recusada vira um registro com o motivo e nada oferecido; uma
  identidade repetida é recusada mantendo o primeiro; uma pasta ilegível virá um registro com o motivo. Não
  segue link (a pasta do plugin precisa ser a sua própria pasta real).
- `src/main/plugins/runtime.ts`: `runPlugin` abre a **mesma** `SandboxService.open` do runner, com o
  `runner.sandbox` do espaço de trabalho (fechado por padrão), e roda `sh <entry> <event>` como leitura. Um
  plugin que falha, sai diferente de zero ou não abre sandbox devolve o motivo, sem derrubar o app; o que ele
  imprime é mascarado.
- `src/main/plugins/module.ts`: `pluginsDeps` com injeção de dependências (config, leitura, execução, gravação),
  `listPlugins`, `setPluginEnabled`, `setPluginGrant` (só o computador) e `firePluginEvent`, que roda só os
  plugins ligados, não recusados e que observam o acontecimento, e entrega o pedido de escrita à porta única.
  O `pluginsModule` registra `plugins:list`, `plugins:set-enabled` e `plugins:set-grant`, e liga os tipos de
  documento ao gate.
- `src/main/modules.ts`: o `pluginsModule` entra na lista de módulos registrados.
- `src/main/webPolicy.ts`: `plugins:set-enabled` e `plugins:set-grant` entram em `DESKTOP_ONLY` — o navegador
  pareado não liga, desliga nem amplia plugin. `plugins:list` fica acessível.

### A porta única de escrita

- `src/main/actions.ts`: `proposePluginWrite` cria uma proposta `plugin-write` que espera o "sim"; ela chama
  `assertExternalWrite` (recusa num espaço de trabalho de teste), descreve o destino neutro declarado pelo
  plugin e, quando aprovada, passa pelo `audited` que grava a linha de auditoria. `approveAction` e
  `previewAction` tratam o novo tipo.
- `src/shared/types.ts`: `plugin-write` entra em `ActionKind`.
- `src/shared/auditoria.ts`: `plugin-write` entra em `AuditKind`.

### O ciclo

- `src/main/gate.ts`: `gatePluginDocuments.files()` é uma segunda fonte somada à lista que `gateOptions` já
  percorre. Um tipo de documento de plugin aparece onde os artefatos do ciclo aparecem, e o leitor dos tipos de
  hoje não mudou de linha. O `pluginsModule` liga essa fonte à lista de plugins, lida no momento do uso, então
  desligar um plugin retira o tipo.

### O gatilho automático no runner

O plano deixava o disparo dos hooks para uma etapa seguinte; a resposta da pessoa ("pode ligar agora como os
gatilhos automáticos") o trouxe para esta entrega. O que mudou:

- `src/main/runner/service.ts`: `RunnerDeps` ganha `pluginEvent?(event, { run })`, opcional — sem ele o runner
  roda exatamente como antes. Um `pluginDone` chama o hook dentro de um `try/catch`, então um hook que lança não
  derruba a execução nem a etapa; o motivo vai para o log de erros do app.
- Os quatro acontecimentos, nos pontos onde já acontecem: `stage-entered` quando a execução entra numa etapa
  (inclusive a primeira, quando ela nasce), `stage-finished` quando a etapa conclui — não quando ela pausa numa
  pergunta, porque aí a etapa ainda não terminou —, `gate-decided` dentro da transição da decisão do gate, e
  `run-finished` quando a execução fica terminal, uma vez só (a guarda é a transição de não-terminal para
  terminal).
- `src/main/runner/module.ts`: liga `pluginEvent` ao `firePluginEvent` do serviço de plugins, passando o número
  e o título da issue e a etapa. A chamada é disparada sem esperar (`void`): a execução não fica presa a um
  plugin.
- O runner não conhece plugin nenhum além desse gancho: o que ele entrega é material, e um plugin desligado,
  recusado ou que não observa o acontecimento é o serviço de plugins que deixa de fora.
- `docs/plugins/README.md`: passa a dizer onde o app dispara cada acontecimento.

### A interface

- `src/renderer/src/screens/Auditoria.tsx`: o tipo `plugin-write` tem rótulo próprio (`ui.audit.kind.pluginWrite`,
  nos dois catálogos). A lista de plugins sai pelo `config:get` que já existe (`ConfigView.config.plugins`), sem
  uma tela nova: nome, o que oferece, o que alcança e o estado.

### O kit

- `docs/plugins/README.md`: o contrato, os acontecimentos, a fronteira e onde cada permissão é recusada.
- `docs/plugins/example-web-search/`: `plugin.json` (identidade `web-search`, um acontecimento, um documento
  novo, um destino de rede e um destino neutro de escrita) e `search.sh`, o esqueleto da primeira entrega.
- `docs/README.md` e `docs/configuration.md`: o kit indexado e a seção `plugins` documentada; o histórico de
  esquema recebe a v13.

## Testes

Arquivos novos (Vitest, em `test/`):

- `plugins-core.test.ts` (18): a declaração válida desdobra; cada recusa com o motivo; identidade repetida;
  escolha por identidade; lista de recursos; a pasta resolvida.
- `plugins-service.test.ts` (6): a lista; ligar/desligar valendo na leitura seguinte (sem reinício); conceder;
  rodar só os ligados que observam; o pedido de escrita entregue à porta única; um plugin que falha não para o
  próximo.
- `plugin-runtime.test.ts` (5): a mesma sandbox da etapa, `reader`, com o `runner.sandbox` do espaço de trabalho;
  sem entrada não roda; sandbox que não abre, comando recusado e saída diferente de zero devolvem o motivo; o
  texto é mascarado; a sessão fecha.
- `plugin-write.test.ts` (4): espera o "sim"; não duplica a mesma chave; aprovada vai para a auditoria com o
  plugin e o destino; num espaço de trabalho de teste é recusada e nada é registrado.
- `gate-plugin-documents.test.ts` (3): um tipo de plugin entra nas opções do gate só quando o arquivo existe;
  retirar a fonte o faz sumir.
- `runner-plugin-events.test.ts` (5): o runner diz `stage-entered`, `stage-finished` e `run-finished` na ordem,
  com o número da issue; diz `gate-decided` na decisão (e nada enquanto o gate só espera); diz `run-finished`
  uma vez só; roda igual sem o gancho; e um gancho que lança não derruba a execução.
- `config-migrations.test.ts` (+2, na seção `schema 12 to 13`): a seção vazia entra num espaço sem plugins e uma
  seção já existente é mantida.

Testes existentes atualizados só onde o esquema corrente mudou de 12 para 13 (o número esperado e os arquivos
que usam o número para "documento mais novo"). O helper `test/helpers/runner.ts` ganhou `pluginEvent` em
`BootOptions`, para um teste observar o disparo sem o serviço de plugins nem uma sandbox.

## O que foi verificado e o que não foi

Verificado nesta execução:

- `npx tsc --noEmit` — sem erros.
- `npx vitest run` — 3706 testes passam; resta **uma** falha, `test/public-audit.test.ts`, e não é deste trabalho:
  os documentos do ciclo `0_ISSUE.md` e `0_TRIAGE.md` citam o texto da issue, que nomeia uma ferramenta pessoal.
  O kit, o código e o teste novos não somam nenhuma ocorrência. Os quatro testes de plugins que já existiam
  continuam passando (36 em 5 arquivos).
- `npm run i18n:lint` — 4060 chaves nos dois idiomas, 0 literais soltos.
- `node scripts/theme-audit.mjs` — passa (só as 8 cores literais que já existiam em `api.ts`).
- `npx electron-vite build` — compila.
- `node scripts/public-audit.mjs` — falha nas mesmas 4 ocorrências pré-existentes dos documentos do ciclo;
  nenhuma vem dos arquivos desta mudança.

O disparo do hook foi conferido com um gancho falso no teste do runner, que vê os quatro acontecimentos na
ordem e sobrevive a um gancho que lança. Não foi conferido, e fica como não verificado, que a chamada real chegue
ao `firePluginEvent` a partir do módulo do runner: o `runner/module.ts` não é exercitado por teste, e o lado do
serviço é coberto à parte, com dependências injetadas.

Não verificado: a lista de plugins e o interruptor numa tela; um plugin de verdade rodando numa sandbox real (os
 testes usam uma sandbox falsa); e o comportamento em Windows e macOS (só o caminho puro é comum, que é o que
 garante a Regra 2).

## Rodada 2: o contrato de permissão

Feita sobre a revisão reprovada (`4_REVIEW.md`) e o contrato que a pessoa fixou
(spec, "O contrato de permissão"; plano, "Rodada 2"). O que a rodada anterior do
desenvolvedor deixou sem commit foi aproveitado onde batia com o contrato (o
documento escrito pelo aplicativo, a exportação sem a lista) e trocado onde não batia
(o modelo `none`/`network`/`network-open`, o `pluginConfined` na sandbox e o registro
`plugin-requests.json`, que saíram).

### O que passou a existir

- **Permissão em três alcances.** `PluginConfig.allow = { network, write }` é o
  "sempre" (esquema 13, ainda não publicado, então sem degrau novo); "na sessão" é um
  mapa no processo principal; "uma vez" é a resposta ao pedido. A decisão é pura, em
  `src/shared/plugins/grants.ts` (`mayReachNetwork`, `pluginNetworkSandbox`,
  `pluginWriteStep`, `pluginAnswers`).
- **Rede só dos destinos declarados.** Permitida, a sandbox do plugin abre em
  `registry` com `registryHosts` = os destinos do plugin, e não a lista do espaço de
  trabalho; sem permissão, o plugin não roda e abre um pedido.
- **O pedido** (`plugin-ask` em Ações) leva tudo o que é preciso para refazer a chamada
  (`PluginAskUnit`). `plugins:answer` responde `once`/`session`/`always`/`refuse`;
  `session` e `always` respondem também os outros pedidos do mesmo plugin para a mesma
  coisa. `actions:approve` recusa um pedido; `actions:skip` (o navegador pareado pode)
  vale como recusa.
- **A execução espera.** `WAIT_KINDS` ganhou `plugin`; antes de começar uma etapa o
  runner consulta `pluginHold` e aplica `stageWaitingOnPlugin`; `pluginSettled` põe a
  recusa na conversa e aplica `pluginWaitDone` quando não sobra pedido da execução.
- **A escrita de verdade.** O destino neutro é a caixa de saída do plugin no espaço de
  trabalho (`plugins-out/<plugin>/<to>.md`), escrita por `audited`: a auditoria
  descreve o que foi escrito e o espaço de trabalho de teste recusa antes.
  Reversível e permitida, sai na hora (`writePluginNow`).
- **Escrita irreversível.** A declaração diz `write: { to, reversible }`; o que não diz
  é irreversível. Só aceita "sempre"; já permitida, é anunciada (`plugin-write` com
  `unit.due`) pelo prazo `plugins.confirmSeconds` (30 s), sai no prazo
  (`sendDuePluginWrite`), é bloqueada por `actions:skip` e revogada por
  `plugins:revoke-write`. Ao abrir o aplicativo, um aviso pendente recomeça o prazo.
- **O script não é montado.** A pasta de plugins padrão fica nos dados do aplicativo,
  que nenhuma sandbox vê; o texto do script de entrada é lido pelo aplicativo (dentro
  da pasta do plugin, sem link, até 64 KiB) e entregue como o próprio comando da
  sessão, com o acontecimento em `$1`.
- **A lista por entrada.** Ligar, permitir e retirar mudam só a entrada do plugin
  (`withChoice`), aplicadas sobre a configuração do momento da gravação; a importação
  mantém a lista do espaço de trabalho de destino e um espaço novo nasce sem nenhuma.
- **O gate** procura o documento de plugin na raiz e em cada `sub` do layout.
- **A política do navegador:** `plugins:set-enabled`, `plugins:settings`,
  `plugins:answer`, `plugins:revoke` e `plugins:revoke-write` em `DESKTOP_ONLY`; um
  teste percorre os canais que o módulo registra.
- **As telas:** Configurações → Plugins (pasta, prazo, e por plugin o que oferece, o
  que pede, o que foi permitido, retirar, pedidos esperando e o motivo de uma recusa)
  e, em Ações, o cartão do pedido (as respostas que valem para ele; no navegador só
  recusar) e o do aviso (contagem, bloquear, revogar).

### Bloqueantes da revisão

| # | Como ficou |
|---|---|
| 1 rede não consultada | `pluginNetworkSandbox` só abre com permissão, e só para os destinos do plugin |
| 2 escrita não consultada | `pluginWriteStep` decide entre sair, anunciar e pedir |
| 3 auditoria sem efeito | caixa de saída escrita dentro de `audited` |
| 4 resultado não vira documento | `writePluginDocument` pelo `writeArtifact`/`checkPath` (mantido) |
| 5 gate na raiz | raiz e cada `sub` |
| 6 lista reescrita / importação | gravação por entrada; importação mantém a lista |
| 7 navegador pareado | canais de plugin em `DESKTOP_ONLY`, com teste. A política aberta por omissão para canal não classificado é anterior a esta issue e não mudou |
| 8 sem tela | cartões em Ações e seção em Configurações |

### Testes da rodada

`test/plugin-grants.test.ts` (novo), `test/plugins-web-policy.test.ts` (novo),
`test/plugins-service.test.ts` e `test/plugin-write.test.ts` (reescritos),
`test/plugin-runtime.test.ts` (o teste antigo escrevia o documento dentro do próprio
repositório; agora usa uma pasta temporária), `test/plugins-core.test.ts`,
`test/runner-plugin-events.test.ts` (execução segurada e solta),
`test/gate-plugin-documents.test.ts` (`sub`), `test/config-transfer.test.ts`
(importação mantém a lista), `test/config-migrations.test.ts`, `test/web-server.test.ts`.

### Portões desta rodada

- `npx tsc --noEmit`: limpo.
- `npx vitest run`: 3756 passam, 1 falha em `test/release-workflow.test.ts` (o passo
  de shell da checagem do Windows) que passa sozinho (21/21): instável sob carga, sem
  relação com esta mudança.
- `node scripts/theme-audit.mjs`: passa. `npm run i18n:lint`: 4157 chaves, 0 literais.
- `node scripts/public-audit.mjs`: limpo. As ocorrências antigas eram o nome de uma
  ferramenta de horas citada no texto da issue, nos documentos do ciclo; trocado pelo
  marcador neutro que a spec já usava.
- `npx electron-vite build`: compila.

### Não verificado

- A tela em uso: nada foi aberto no aplicativo.
- Um plugin de verdade numa sandbox real (bwrap) e uma busca de verdade; os testes usam
  sandbox falsa. Windows e macOS.
- Uma execução de ponta a ponta com um plugin ligado no runner real (o runner é
  exercitado com `pluginHold` falso; o serviço, com dependências injetadas).

### Revisão da rodada 2 e o que mudou por ela

A revisão (sessão separada, só leitura) confirmou os oito bloqueantes fechados e pediu
mudanças em três pontos novos, mais quatro correções. Tratados:

- **B1, o varredor do runner.** Uma espera `plugin` não é mais perguntada ao host (um
  comentário na issue soltava o run como se fosse a resposta). O varredor só a solta
  quando não sobra pedido da execução, o que também recupera o caso em que o
  aplicativo fecha entre a resposta e a soltura (`service.ts`, `lookForEvents`).
- **B2, a escrita anunciada depois de retirar ou desligar.** No fim do prazo o serviço
  relê o plugin e só envia se ele estiver ligado, sem recusa e com `allow.write`.
  Retirar a escrita na lista ou desligar o plugin tira os avisos pendentes dele.
  Desligar também recusa os pedidos pendentes dele, e os runs que eles seguravam
  seguem. `actions:approve` não envia mais um aviso antes do prazo.
- **B3:** linha no `CHANGELOG.md`.
- **C1, `runs:skipWait`.** Seguir sem responder solta os pedidos daquela execução
  (`holdsRun: false`): eles ficam em Ações para serem respondidos e não seguram mais a
  execução. Um pedido novo volta a segurar.
- **C2:** `actions:skip` só vale para pedido e aviso de plugin ainda pendentes.
- **C3:** testes do revogar pelo cartão, do prazo com temporizador falso, de retirar e
  desligar durante a contagem, e de seguir sem responder.
- **C4:** o kit diz que o script é lido e entregue como comando, não rodado na pasta.
- Das sugestões: **S2** (desligar recusa os pedidos), **S3** (a importação mantém
  também `plugins.dir` e `confirmSeconds` do destino, e um espaço de trabalho novo
  nasce com a seção vazia), **S4** (o seletor de espera de etapa não oferece `plugin`
  nem `budget`), **S6** (a resposta relê a declaração da escrita) e **S10** (o texto da
  aceitação 14 alinhado ao que foi decidido).

Ficam para issues próprias, registradas aqui:

- **S1:** a chave do pedido inclui acontecimento e etapa, então "uma vez" pode precisar
  de duas respostas no mesmo run.
- **S5:** `stage-entered` não é esperado, e o pedido aberto ali só segura a etapa seguinte.
- **S7:** o motivo de um hook que falha não aparece na lista de plugins.
- **S8:** um "sempre" de plugin recusado ou que sumiu da pasta não tem "Retirar".
- **S9:** um ancestral da pasta que é link faz o plugin sumir sem motivo.
- **S11:** o aviso com prazo não notifica.
- **S12:** `config:save` da janela pode regravar `plugins.list` a partir de um rascunho
  velho.
- **S13:** a sandbox do plugin herda os `readOnlyPaths` do espaço de trabalho, e a lista
  de plugins não diz isso.
