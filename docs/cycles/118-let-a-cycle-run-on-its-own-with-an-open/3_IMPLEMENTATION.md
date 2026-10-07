# A autonomia lida em cada decisão, a rede aberta na sandbox e a lista dos comandos, presas no stash

## Estado desta passada

A implementação foi feita sobre a `release/0.7.0` (o rebase que a resposta da pessoa pediu) e **passou em todas as verificações que rodei**. O worktree, porém, **não mostra o código agora**: o último comando desta etapa (`git stash pop`, ao pausar para comparar com a base) não voltou, o orçamento de comandos da etapa acabou, e as alterações ficaram presas em `stash@{0}` (a entrada marcada "wip4"). O que está visível no worktree é o estado commitado: os documentos do ciclo sobre a `release/0.7.0`.

**A primeira coisa a fazer na próxima etapa é `git stash pop`** (ou `git stash apply stash@{0}`) e conferir `git status`. Sem isso, nada do que este documento descreve aparece no código.

## O que foi implementado e conferido

### Rebase e configuração

- A branch foi rebaseada sobre `release/0.7.0` (esquema 15), como a resposta pediu. A migração de autonomia ficou em **`v15ToV16`** (`CONFIG_SCHEMA_VERSION` 15 → 16), sem o `v12ToV13` que colidia com o da release.
- Sobre o código da release: `AUTONOMY_CHOICES`/`AutonomyBlock`/`FlowAutonomy` em `types.ts`, `RunnerConfig.autonomy`, `DevCycleConfig.autonomy` (mapa por fluxo), `SANDBOX_NETWORKS` com `open` e o contrato de `SandboxNetwork`; `neutralAutonomy()` e `neutralRunner()` em `defaults.ts`; `autonomy: {}` em `neutralDevCycle()`; os objetos `autonomy`/`flowAutonomy` em `schema.ts`; `v15ToV16` em `migrations.ts` (cria os blocos desligados, mantém um já presente, **nunca toca na rede**); o resolvedor puro `src/shared/config/autonomy.ts`.

### A decisão lida nos pontos de decisão

- `FlowStage.cycleAutonomous` (novo, no esquema do run também) guarda o valor do bloco quando o fluxo é resolvido; `enter` faz `rec.autonomous = stage.cycleAutonomous || stage.autonomous`, e `startStage` repete — a regra "vale a partir da próxima, nunca a meio" se mantém pelo `StageRecord.autonomous`.
- **Gate**: `drive` chama `autoGate`, que com `cycle && gates` ligados aprova por `gateBy(id, 'approve', motivo, 'app')`; `gateApprove` ganhou um `by` e registra `gate-approved` com `by: 'app'` e o motivo com a origem (espaço de trabalho ou fluxo), em `main.runner.gate.autonomy*`.
- **Comando `host`**: `hostApproval` lê `choiceOn(autonomyOf(config, flowKeyOf(run.squad)), 'hostCommands')` e devolve `{ ok: true }` sem `askCommand`.
- **Push e pull request**: a regra da release continua intacta (`proposePush` e a proposta de pull request seguem sendo os caminhos de sempre); a leitura das escolhas de push/pull request **não foi ligada** nesta passada (ver abaixo).

### Rede `open`

- `SandboxSpec.network` ganhou `'open'`; `bwrapArgs` deixa de pôr `--unshare-net` em `open` (os outros unshares ficam); `sandboxEnv` não põe proxy em `open`; `index.ts` monta o resolvedor (`nameResolverBinds`, novo em `system.ts`) somente leitura, no alvo real de `/etc/resolv.conf` e no caminho convencional; `probe.ts` continua `off`.
- O prompt (`prompt.ts`, `mentions/call.ts`) distingue `open` e usa as chaves novas `prompt.sdd.runner.rules.shell.open` nos dois idiomas.

### Lista de comandos

- Módulo puro novo `src/shared/runCommands.ts` (`groupCommands`, `countCommands`), que agrupa por agente e etapa a partir das mensagens `runner.exec`/`runner.exec.host`. A seção na tela e a mensagem única ao fim da execução **não foram ligadas** (ver abaixo).

### Navegador pareado

- `devCycle.autonomy` entrou em `WEB_EDITABLE` com `raisedAutonomy`, que recusa qualquer campo `false → true` e `useWorkspace true → false`; `runner.autonomy` e `runner.sandbox` continuam fora, então nem o bloco do espaço de trabalho nem a rede `open` se mexem do celular.

### Documentação

- `docs/runner.md` (o resumo, o parágrafo do push e do pull request, o contrato de `shell: host` ganhou a exceção, a linha de `runs:start`, a descrição da sandbox e a seção "Não verificado" dizendo que `open` nasce não exercitada), `docs/configuration.md` (o passo v16 no histórico, o contrato do `autonomous`, o bloco `autonomy`, a rede `open`, a tabela de `config:cycle-save`) e `CHANGELOG.md` em `## [Unreleased]`.

## O que foi verificado

- `npx tsc --noEmit` limpo; `npx vitest run` em lotes (a suíte inteira estoura o tempo desta máquina): ~1800 casos verdes, incluindo config, migração, `autonomy`, `run-commands`, sandbox (com o teste real de `bwrap`), runs, gate, release, publish, runner-*, web-scope.
- **A rede `open` foi exercitada num teste real de sandbox**: uma interface da máquina existe dentro e `getent hosts example.com` resolve (nesta máquina `/etc/resolv.conf` é um link para `/run/systemd/resolve/stub-resolv.conf`, e a resolução funcionou). Alcançar um endereço público por TCP não foi confirmado.
- `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4378 chaves nos dois idiomas) e `node scripts/public-audit.mjs` limpos.
- Um teste que falha na base (`test/sandbox-gui.test.ts`, o da pasta de navegadores) foi conferido como **pré-existente**, não desta mudança.

## O que não foi feito ou não foi verificado

- **O push e o pull request autônomos não foram ligados**: com as escolhas ligadas, o push e o pull request ainda viram propostas em Ações. O caminho autônomo da porta para os dois (o `door.push` novo e o `door.post` do pull request) ficou desenhado e não escrito.
- **A seção "Comandos" na tela e a mensagem única ao fim da execução não foram ligadas**: o módulo puro `runCommands.ts` existe e tem teste, mas `CommandsSection.tsx` e a mensagem `runner.commands.list` no `service.ts` não foram escritas.
- **O cabeçalho da execução** não diz que ela é autônoma nem de onde vem a decisão.
- **As telas do bloco de autonomia** (Configurações › Runner e Time e ciclo) não foram escritas; só o seletor de rede ganhou o valor `open` no `RunnerSection.tsx`.
- Nenhuma tela foi aberta e nada foi visto funcionando no aplicativo.
