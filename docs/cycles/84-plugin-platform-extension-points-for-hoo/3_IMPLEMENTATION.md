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
