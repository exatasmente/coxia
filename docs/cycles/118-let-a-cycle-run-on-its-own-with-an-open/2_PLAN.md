# Como uma execução passa a caminhar sozinha, com a sandbox na rede e a lista dos comandos de cada agente

## 1. Resumo da abordagem

O plano entrega o comportamento descrito em `1_SPEC.md` em quatro frentes independentes, cada uma com os seus pontos de código e a sua migração ou o seu passo de esquema, e com a documentação do runner e da configuração ajustada onde a regra muda.

1. **Um bloco de autonomia por espaço de trabalho e um por fluxo**, guardados na configuração. Um resolvedor puro decide, para cada execução, qual bloco vale (o do fluxo quando o interruptor está desligado, o do espaço de trabalho quando está ligado e o fluxo não tem bloco próprio) e devolve os cinco valores efetivos. O bloco guarda a decisão no início de cada passo: a etapa, o gate, o comando `host`, o push e o pull request leem o valor no momento em que decidem, nunca a meio de um passo.
2. **Um terceiro valor para a rede da sandbox**, `open`, que compartilha a rede do computador. A montagem deixa de pôr `--unshare-net` quando `open` e passa a montar o resolvedor de nomes de forma controlada, sem abrir o resto do sistema. O texto da etapa e o das menções passam a dizer que o agente tem rede.
3. **Uma seção "Comandos" na tela da execução**, montada a partir do que a execução já registra (a conversa `runner.exec` / `runner.exec.host` e o log de cada sessão), e uma mensagem única na conversa quando a execução termina. Nada novo sai para o host de código.
4. **A regra "o push e o pull request sempre esperam um 'sim'" vira condicional** à escolha correspondente no bloco que decide a execução, com a exceção da release (item 26 da spec). Os textos onde a regra está escrita e o contrato do `autonomous` são reescritos.

A migração do esquema é o passo **v13**, que cria o bloco do espaço de trabalho com os cinco campos desligados e não toca no resto (a rede nunca é elevada). Nenhuma frente muda o que um agente pode ler ou escrever: só muda **quando** um passo espera a pessoa.

## 2. Configuração: onde o bloco mora e como é lido

### 2.1 Tipos (`src/shared/config/types.ts`)

Acrescentar ao arquivo, junto de `RunnerSandbox` e de `RunnerConfig`:

```ts
/** As cinco escolhas de autonomia de uma execução. Os quatro de baixo só valem com `cycle` ligado. */
export const AUTONOMY_CHOICES = ['hostCommands', 'gates', 'push', 'pullRequest'] as const;
export type AutonomyChoice = (typeof AUTONOMY_CHOICES)[number];

export interface AutonomyBlock {
  /** A chave geral: as etapas começam e entregam o resultado sem esperar. */
  cycle: boolean;
  /** Comandos de `shell: host` sem a pergunta. */
  hostCommands: boolean;
  /** Gates aprovados pelo app, com o motivo e a origem registrados. */
  gates: boolean;
  /** O push sai pela porta sem esperar um "sim", auditado. */
  push: boolean;
  /** O pull request é aberto sem esperar um "sim", auditado. */
  pullRequest: boolean;
}
```

- `SANDBOX_NETWORKS` passa de `['off', 'registry']` para `['off', 'registry', 'open']`, e o contrato de `SandboxNetwork` ganha a frase de que `open` é a rede do computador inteira, só no desktop e desligada por padrão (hoje em `types.ts:687-689`).
- `RunnerConfig` ganha `autonomy: AutonomyBlock`.

O bloco do fluxo precisa de um lugar estável por fluxo. O fluxo principal é `devCycle.stages` (uma lista), o de cada squad é `devCycle.flows[squad]` (uma lista). Duas listas não guardam um objeto de bloco. O desenho escolhe **um mapa novo irmão das listas**, que não mexe nas listas nem na sua forma:

```ts
// DevCycleConfig
export interface FlowAutonomy extends AutonomyBlock {
  /** Ligado (padrão): o bloco do espaço de trabalho decide neste fluxo e os campos ficam desligados na tela. */
  useWorkspace: boolean;
}

/** O bloco de autonomia de cada fluxo, pela chave do fluxo: `''` para o principal, o id do squad para o de cada squad. */
autonomy?: Record<string, FlowAutonomy>;
```

Chave `''` (string vazia) para o fluxo principal, o id do squad para o de cada squad, e a chave reservada `release` (`RELEASE_FLOW_KEY`, hoje em `squads.ts`) para o fluxo de release. É um mapa opcional, então um config guardado sem ele lê como "todos os fluxos usam o do espaço de trabalho e o bloco do fluxo é tudo desligado". Sem entrada no mapa, os cinco campos são `false` e `useWorkspace` é `true`.

### 2.2 O resolvedor (`src/shared/config/autonomy.ts`, novo)

Arquivo puro, sem disco, no mesmo estilo de `squads.ts`: recebe o config e a chave do fluxo, devolve os cinco valores efetivos.

```ts
export interface EffectiveAutonomy extends AutonomyBlock {
  /** De onde veio a decisão, para o cabeçalho da tela e para o registro do gate: "workspace" ou "flow". */
  from: 'workspace' | 'flow';
  /** O fluxo que decidiu (a chave do mapa); null quando quem decidiu foi o espaço de trabalho. */
  flow: string | null;
}

export const flowKeyOf = (squadId: string | null | undefined): string => squadId ?? '';

/** O bloco que decide a execução: o do fluxo quando o interruptor está desligado, o do espaço de trabalho quando está ligado (ou o fluxo não tem bloco). */
export function autonomyOf(c: WorkspaceConfig, flowKey: string): EffectiveAutonomy;

/** O bloco efetivo de um passo: os campos de baixo só contam com `cycle` ligado. */
export function choiceOn(a: EffectiveAutonomy, choice: AutonomyChoice): boolean;

/** As quatro escolhas ligadas, para o cabeçalho da tela. */
export function onChoices(a: EffectiveAutonomy): AutonomyChoice[];
```

Regras de `autonomyOf`, que replicam a precedência da spec:

- `flowKey` é `''` no fluxo principal, o id do squad no fluxo de um squad, e `release` num fluxo de release.
- `block = c.devCycle.autonomy?.[flowKey]`. Sem bloco, ou com `useWorkspace === true`: vale `c.runner.autonomy` e `from = 'workspace'`.
- Com bloco e `useWorkspace === false`: valem os campos do bloco e `from = 'flow'`, `flow = flowKey`.
- `choiceOn` devolve `a.cycle && a[choice]` (os quatro de baixo nunca valem sozinhos).

### 2.3 Esquema (`src/shared/config/schema.ts`) e padrões (`src/shared/config/defaults.ts`)

Os três arquivos andam juntos, como manda a regra do squad; `test/config-schema.test.ts` falha se `types.ts`, `defaults.ts` e `schema.ts` divergirem.

- `defaults.ts`: `neutralAutonomy()` devolve os cinco campos `false`; `neutralRunner()` inclui `autonomy: neutralAutonomy()`; `neutralDevCycle()` (em `src/shared/cycles/neutral.ts`) inclui `autonomy: {}`.
- `schema.ts`: um objeto `autonomy` com os cinco booleanos, com descrições em inglês (o `i18n-lint` permite o cabeçalho `allow-file` que o arquivo já traz), acrescentado a `runner` e a `devCycle` (com a variante de fluxo que acrescenta `useWorkspace`), e o enum `network` recebe `open` na descrição de `SANDBOX_NETWORKS`.

### 2.4 Migração v13 (`src/shared/config/migrations.ts`)

- `CONFIG_SCHEMA_VERSION` passa de `12` para `13`.
- Um passo novo `v12ToV13(old, _ctx, notes)`: cria `runner.autonomy` com os cinco campos desligados quando falta, e `devCycle.autonomy: {}` quando falta (um mapa já presente é mantido, o que torna o passo idempotente). **Não toca em `runner.sandbox.network`**: a migração nunca eleva a rede. `notes` diz o que foi criado.
- O comentário do histórico no topo do arquivo ganha a linha da v13, e `STEPS` recebe `12: v12ToV13`.
- `docs/configuration.md` ganha o passo v13 na lista de histórico (em português e em inglês).

### 2.5 Leitura da decisão nos pontos de decisão

- **Início da etapa** (`src/shared/runs/transitions.ts`, `enter`): o `autonomous` que a etapa guarda hoje vem de `FlowStage.autonomous` (a chave do agente combinada com a do squad por `effectiveTeam`). O `FlowStage` ganha `cycleAutonomous: boolean` e o `enter` guarda `rec.autonomous = stage.cycleAutonomous || stage.autonomous` (com `autonomyOf(...).cycle` ligado, a etapa é autônoma mesmo com o agente e o squad desligados). Guardar na própria `StageRecord.autonomous` mantém a regra "vale a partir da próxima etapa, nunca a meio" sem um campo novo no run.
- **Gate** (`src/main/runner/service.ts`): com `choiceOn(autonomyOf(config, flowKeyOf(run.squad)), 'gates')`, o app chama `gateApprove` sozinho ao entrar no gate, com o motivo e a origem, e registra no histórico um `gate-approved` com `by: 'app'` e um detalhe que diz que foi a autonomia (e de onde veio). Sem a escolha, o gate espera como hoje. A transição é a mesma (`gateApprove`), para não duplicar regra.
- **Comando `host`** (`executor.ts`, `hostApproval`): quando a escolha está ligada, `hostApproval` devolve `{ ok: true }` sem chamar `d.askCommand` e reporta na conversa a linha que diz que o comando rodou neste computador sob a autonomia do ciclo (decisão 2 da spec; recomendação seguida).
- **Push e pull request** (`publish.ts`, `pushStage` e `pullRequest`): em vez de sempre `door.proposePush` / `door.propose`, quando a escolha está ligada o publisher chama o caminho autônomo da porta (`door.post` para o pull request; um `door.push` novo para o push), que audita uma linha por chamada. Sem a escolha, o caminho de hoje (proposta em Ações) fica igual.
- **Release**: uma execução com `run.subject` (uma release) nunca consulta o bloco para push e pull request. `releaseWaits` e `alwaysWaits` (`src/shared/release.ts`) continuam decidindo (`beta`, `stable`, `push-branch`, `push-tag` sempre esperam). O resolvedor recebe a chave `release` apenas para o resto (etapas/gates do fluxo de release), e a spec deixa isso como recomendação até a pessoa decidir (item 27).

## 3. Rede aberta na sandbox

### 3.1 Montagem (`src/main/sandbox/policy.ts`, `system.ts`, `index.ts`)

- `SandboxSpec.network` passa de `'off' | 'proxy'` para `'off' | 'proxy' | 'open'`.
- `bwrapArgs`: a lista fixa (hoje `policy.ts:87`) deixa de incluir `--unshare-net` sempre; passa a incluí-lo **exceto** quando `spec.network === 'open'`, caso em que a sandbox compartilha a rede do computador. Os outros unshares (`--unshare-user`, `--unshare-ipc`, `--unshare-pid`, `--unshare-uts`, `--unshare-cgroup-try`, `--disable-userns`) continuam iguais.
- `sandboxEnv`: com `network === 'open'` não são postas as variáveis de proxy (`HTTPS_PROXY` e companhia) nem `COXIA_PROXY`; o ambiente continua construído do zero.
- **Resolvedor de nomes**: com `open`, a sandbox monta o resolvedor do computador de forma controlada. O `systemLayout()` passa a devolver, além de `roDirs` e `links`, os binds do resolvedor:
  - o alvo real de `/etc/resolv.conf` (lido com `realpathSync`, que pode ser um link para fora de `/etc`), montado **somente leitura**, no mesmo caminho do alvo;
  - o que o alvo precisar para existir (o mais comum é `/run/systemd/resolve` ou `/run/resolvconf`), montado também somente leitura, quando existir;
  - `/etc/hosts` e `/etc/nsswitch.conf` já vêm com o bind de `/etc`; a decisão de resolvedor fica isolada a esses caminhos e ao destino fixo dentro da sandbox, sem abrir mais nada de `/run` nem de `/var`;
  - o que não existir na máquina é ignorado; se nada for encontrado, a sandbox ainda sobe com a rede compartilhada e o prompt diz que a resolução de nomes pode não funcionar (a spec marca o resultado como não exercitado).
- `index.ts`: `const registry = opts.config.network === 'registry'`, e `network: opts.config.network === 'registry' ? 'proxy' : opts.config.network === 'open' ? 'open' : 'off'`. O proxy do registro continua sendo criado só em `registry`.
- `probe.ts` continua montando a sandbox com `network: 'off'` (o teste de disponibilidade não muda); a expectativa de `--unshare-net` em `test/sandbox-policy.test.ts` é atualizada para o novo contrato.

### 3.2 O que o agente é dito (`src/main/runner/prompt.ts`, `src/main/mentions/call.ts`, catálogos)

- `StageInput.sandbox.network` passa a `'off' | 'registry' | 'open'`, e o mesmo em `MentionInput.shell.network` (hoje `prompt.ts:40` e `call.ts:30`).
- Uma chave de catálogo nova, `prompt.sdd.runner.rules.shell.open` (em `pt-BR` e `en`), no lugar do texto de `off`/`registry` quando a rede é `open`: diz que o agente tem a rede do computador, que ela alcança a rede local e a internet sem filtro, e que a escolha é da pessoa. A seleção da leitura (`prompt.ts:99`) ganha um ramo para `'open'`.
- **Menções**: `call.ts` monta o texto do shell a partir de `shell.network`; passa a distinguir `open` do mesmo jeito.

### 3.3 O que muda na tela

- `RunnerSection.tsx` (Configurações › Runner) e a tela de Time e ciclo ganham o seletor de rede com o terceiro valor e um aviso de que `open` é a rede do computador inteira; o aviso é uma string do catálogo.
- Onde o agente tem `shell: sandbox` e a rede é `open`, o texto da etapa diz isso.

## 4. A lista de comandos que cada agente rodou

### 4.1 Onde ela é montada

Tudo o que a lista precisa já é registrado:

- cada comando da sandbox vira uma mensagem `runner.exec` na conversa, e cada comando `host`, `runner.exec.host` (`executor.ts`, `openStageSandbox`, `report`), com `agent`, `n`, `command`, `result` (`endedAs`) e `ms`;
- cada sessão guarda o log completo (`SandboxSession.log`, `ExecResult[]`), com `n`, `command`, `exitCode`, `timedOut`, `refused`, `ms` e `output` — e `openHostSession` usa a mesma forma.

O plano monta a lista **das mensagens da conversa**, que já trazem agente, etapa, número, comando, resultado e duração e que o renderer já lê; o log da sessão fica como a fonte de quem precisa distinguir `refused` e `timedOut` com mais detalhe.

- Um módulo puro novo (`src/shared/runCommands.ts`) com:

```ts
export interface RunCommand {
  agent: string;
  stage: string;
  /** 1-based, na ordem da etapa. */
  n: number;
  command: string;
  via: 'sandbox' | 'host';
  result: 'exit' | 'timeout' | 'refused' | 'not-run';
  exitCode: number | null;
  ms: number;
}

/** Agrupa os comandos por agente e, dentro dele, por etapa, na ordem em que rodaram. */
export function groupCommands(list: RunCommand[]): { agent: string; stages: { stage: string; commands: RunCommand[] }[] }[];
```

- `CommandsSection.tsx` (nova) lê a conversa (`useThreads`, que o renderer já assina) e agrupa com `groupCommands`.

### 4.2 Ao vivo e no fim

- **Ao vivo**: a seção lê a conversa que o renderer já assina; cada mensagem nova de `runner.exec*` re-renderiza a lista. Nada de canal novo.
- **No fim**: quando a execução chega a `done`, `cancelled` ou `failed`, o app posta **uma** mensagem `runner.commands.list` na conversa com a mesma lista, por agente. O gatilho é a transição que termina a execução, em um único lugar (`service.ts`, ao lado de onde hoje o run chega a um estado terminal), para não postar duas vezes. A mensagem carrega o texto já renderizado, pelo mesmo mecanismo das outras mensagens de sistema; o renderer monta o texto no idioma do workspace.
- **Nunca ao host**: a lista é montada e exibida a partir da conversa; nenhum caminho novo toca a porta das Ações nem o host de código. `test/runs-policy.test.ts` continua pinando que o runner só escreve pelo door.

## 5. O que muda na regra de hoje (documentação)

Pontos que mudam de sentido e precisam de texto novo, em português e em inglês:

- `docs/runner.md:9` (o resumo "o push e o pull request esperam sempre").
- `docs/runner.md:120` (o parágrafo "Push e pull request esperam sempre").
- `docs/runner.md:179` (a linha de `runs:start` entre as chamadas do navegador).
- `docs/runner.md:100` (o contrato de `shell: host`, "cada comando espera você permitir", ganha a exceção da escolha).
- A seção "Não verificado" de `docs/runner.md` (a partir de `:209`), que passa a dizer que a rede `open` nasce não exercitada.
- `src/shared/config/types.ts:536-538` (o contrato do campo `autonomous`: deixa de dizer que o push e o pull request esperam de qualquer jeito).
- `docs/configuration.md:57` e `:205` (a mesma frase), mais a lista `runner` do resumo (`:42`, `:190`), o histórico do esquema (v13) e a tabela de `config:cycle-save` (`:118`, `:266`) quando o bloco do fluxo for editável pelo navegador.
- `CHANGELOG.md`, em `## [Unreleased]`, na entrega.

## 6. Navegador pareado (`src/main/configScope.ts`, `src/main/webPolicy.ts`)

A spec (item 9) manda que o navegador só **desligue**. O desenho:

- O bloco do espaço de trabalho (`runner.autonomy`) fica **fora** de `WEB_EDITABLE` (como já estão `runner.sandbox` e `runner.commands`), o que recusa qualquer mudança dele pelo navegador.
- O bloco do fluxo (`devCycle.autonomy`) **pode** estar em `WEB_EDITABLE` com uma checagem própria, ao lado de `raisedPermissions`: uma função `raisedAutonomy(before, after)` que compara os dois blocos por chave e recusa qualquer campo que passe de `false` para `true` (e `useWorkspace` de `true` para `false`), aceitando só a descida. Isso permite o celular desligar sem poder ligar.
- A rede `open` segue impossível pelo navegador porque `runner.sandbox` continua fora de `WEB_EDITABLE`; um teste fixa isso.
- `test/configScope.test.ts` e o teste de política ganham os casos; a tabela de `docs/configuration.md` ganha a linha nova.

## 7. Onde o bloco aparece na tela

- **Espaço de trabalho**: `RunnerSection.tsx` (Configurações › Runner), um bloco com os cinco campos.
- **Fluxo**: a tela de Time e ciclo, na edição de cada fluxo (principal e de cada squad), com o interruptor "Usar a configuração do espaço de trabalho" ligado por padrão; com ele ligado, os cinco campos do fluxo ficam desabilitados e uma dica diz que o espaço de trabalho decide (decisão 3 da spec; a recomendação é a tela de Time e ciclo, com o bloco do espaço de trabalho em Configurações › Runner).
- **Cabeçalho da execução** (`RunScreen.tsx`): uma linha diz que a execução é autônoma, quais das quatro escolhas estão ligadas e de onde vem a decisão (espaço de trabalho ou fluxo, e qual). Os dados vêm de `autonomyOf(config, flowKeyOf(run.squad))`, calculados no renderer a partir do config que a tela já carrega.
- **Seção "Comandos"** (`CommandsSection.tsx`, nova), na tela da execução.

## 8. Testes e verificações

Cada critério de aceite da spec tem um teste; os que não puderem ser exercitados ficam marcados como não verificados no relatório.

1. **Migração (aceite 7)**: `test/config-schema.test.ts` / um teste de migração novo — um config v12 com a rede em `registry` e nada de autonomia migra para v13 com os cinco campos `false`, `devCycle.autonomy` vazio e `runner.sandbox.network` **inalterado** (`registry`), e um config v13 qualquer não é tocado (idempotência).
2. **Precedência (aceite 2)**: `test/autonomy.test.ts` (novo) — com `useWorkspace` ligado, vale o bloco do espaço de trabalho e `from === 'workspace'`; desligado, vale o do fluxo e o do espaço de trabalho é ignorado; sem bloco do fluxo, vale o do espaço de trabalho; `choiceOn` só é `true` com `cycle` ligado.
3. **Workspace de teste (aceite 3)**: `test/runner-publish.test.ts` — com as duas escolhas ligadas, `door.refusal()` continua recusando a confirmação do push e do pull request, e o gate/comando `host` locais funcionam.
4. **Navegador pareado (aceite 4)**: `test/configScope.test.ts` e o teste de política — subir qualquer campo do bloco do fluxo é recusado; descer é aceito; `runner.autonomy` e `runner.sandbox` são recusados por inteiro; `open` não pode ser escolhido do navegador.
5. **Rede `open` (aceite 5)**: `test/sandbox-policy.test.ts` (puro) — `bwrapArgs` com `network: 'open'` não tem `--unshare-net` e continua com os outros unshares; com `off` tem; `sandboxEnv` com `open` não traz as variáveis de proxy. Um teste de integração (`test/sandbox-bwrap.test.ts`) exercita, onde a sandbox funciona, `open` resolvendo um nome público; com `off` continua sem alcançar. **Onde a máquina não tem sandbox, o teste é pulado e o item fica marcado como não verificado.**
6. **Lista por agente e etapa, e a mensagem final (aceite 6)**: `test/runner-commands.test.ts` (novo) com um mundo de teste — uma execução com dois agentes e duas etapas monta a lista agrupada; a seção lê a conversa; ao terminar (`done`, `cancelled` e `failed`) posta **uma** mensagem `runner.commands.list`, e nenhum caminho novo toca o host.
7. **Gate automático (aceite 8)**: `test/runner-gate.test.ts` — com a escolha ligada, o app aprova o gate sozinho, o histórico registra `gate-approved` com `by: 'app'` e o motivo com a origem; com a escolha desligada, o gate espera.
8. **Vale na próxima decisão (aceite 9)**: um gate que já esperava continua esperando depois de a escolha ser ligada; a escolha só pega no próximo gate/etapa/comando.
9. **Release (aceite 10)**: `test/runner-release.test.ts` — com qualquer bloco ligado, os quatro passos (`beta`, `stable`, `push-branch`, `push-tag`) continuam esperando o "sim".
10. **Push e pull request autônomos (aceite 1)**: `test/runner-publish.test.ts` — com as escolhas ligadas, o push e o pull request saem pela porta e são auditados; com uma desligada, aquele passo vira proposta como hoje.

Além disso: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` (as strings novas do catálogo, nos dois idiomas) e `node scripts/public-audit.mjs` (nenhum nome real, nenhum endereço, nenhum número de issue real nos fixtures e nos textos).

## 9. Ordem de trabalho sugerida

A frente mais barata e independente é a rede `open` (item 3), que também destrava testes de sandbox que hoje não rodam. Depois o bloco de autonomia (item 2) e a regra do push e do pull request (item 5), que compartilham os mesmos pontos. A lista de comandos (item 4) não depende do bloco e pode andar em paralelo. A migração v13 entra junto com o bloco, e a documentação fecha cada frente.

## 10. Fora do escopo do plano

- Qualquer ajuste por execução na hora de iniciar.
- Ligar qualquer campo ou a rede `open` pelo celular.
- Filtrar, limitar ou listar endereços na rede `open`.
- Responder a pergunta que chegou à pessoa, o pedido de um plugin, um provedor sem orçamento e as etapas de espera: continuam esperando.
- Mudar o que um agente pode ler ou escrever (`permission`, `tracker`, `shell`): esta mudança mexe em **quando** um passo espera, não no que o agente pode fazer.
- Uma lista de comandos que saia para o host de código, ou um documento da pasta do ciclo com ela.

## 11. Decisões da pessoa que ficam abertas

As quatro decisões da seção 4 da spec não bloqueiam o plano; ele segue a recomendação de cada uma e deixa o item marcado:

1. Push e pull request de uma execução de release fora das duas escolhas (recomendação) — o plano trata a release como hoje.
2. O que a tela mostra quando um comando `host` roda sem a pergunta (recomendação: uma linha dizendo que rodou neste computador sob a autonomia do ciclo).
3. Em que tela fica o bloco do fluxo (recomendação: Time e ciclo, com o do espaço de trabalho em Configurações › Runner).
4. A rede `open` como padrão de instalação nova (recomendação: continuar desligada).

## 12. Como foi conferido

Leitura da issue, da triagem, da especificação funcional (`1_SPEC.md`) e da conversa da atividade; leitura do código citado pela issue e pelos pontos que o plano toca (`src/shared/config/types.ts`, `defaults.ts`, `schema.ts`, `migrations.ts`, `src/shared/config/squads.ts`, `src/shared/runs/types.ts`, `src/shared/runs/transitions.ts`, `src/main/runner/service.ts`, `executor.ts`, `prompt.ts`, `publish.ts`, `door.ts`, `src/main/sandbox/policy.ts`, `system.ts`, `index.ts`, `session.ts`, `host.ts`, `probe.ts`, `src/main/configScope.ts`, `src/main/webPolicy.ts`, `src/shared/release.ts`); leitura da documentação do runner e da configuração e do `CHANGELOG.md`; leitura dos testes que pinam as regras (`test/sandbox-policy.test.ts`, `test/config-schema.test.ts`, `test/runs-policy.test.ts`).

**Nada foi executado**: nenhum comando foi rodado, nenhum teste foi rodado, nenhum comportamento novo foi visto funcionando — nem o bloco de autonomia, nem a rede `open`, nem a lista de comandos. O que este documento diz do estado atual é o que o código e a documentação dizem, por leitura, não o que se viu. As decisões de desenho que dependem da máquina (o caminho real do resolvedor de nomes, se a máquina tem sandbox) ficam para a implementação e a verificação.
