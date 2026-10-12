# Plano: executor "Sessão do Claude Code" na etapa do fluxo

## Resumo

Uma etapa com `executor: 'claude-code'` deixa de chamar o agente do Coxia e entrega a tarefa a uma sessão do Claude Code aberta pelo **Agent SDK** que o app já embarca. O texto de resultado da sessão vira a resposta da etapa. A transcrição fica guardada à parte. Cada pedido de permissão da sessão vira um item pendente para a pessoa. Escritas fora da worktree são recusadas pelos mesmos hooks que já confinam os agentes. Com a opção global desligada, ou em workspace `test: true`, a etapa falha antes de abrir qualquer coisa e não cai no agente do Coxia.

Tudo abaixo veio de leitura do código. Nenhum comando foi rodado e nenhum teste executado nesta etapa.

## Decisões

1. **Agent SDK, não ACP.** O SDK já é carregado sob demanda por `src/main/claudeSdk.ts` (`loadClaudeSdkModule`/`loadClaudeQuery`) e já roda os agentes em `runClaudeSdk` (`src/main/agents.ts`). Ele dá `canUseTool` para as permissões e `hooks.PreToolUse` para o confinamento, e não precisa de dependência nova. O ACP exigiria um pacote novo, um segundo processo e uma segunda via de permissões que teria de ser auditada. Não achei referência a ACP em `src/`. O ganho do ACP (falar com outros clientes) não é pedido aqui.
2. **Separado da #280.** O módulo de sessões da #280 (`claudeSessions`) **não existe nesta base** (busca por `claudeSessions`/`listSessions` em `src/` só acha um `listSessions` não relacionado em `src/main/engine/open/session.ts`). O plano não importa nada dele. A opção própria `runner.claudeCodeTasks` evita ordem de merge acoplada. A regra 12 da spec fica atendida só em conceito: na integração, reconciliar o número do passo de migração e decidir se as duas opções viram uma. Isso fica para a etapa de integração (veja handoff).
3. **Opção global `runner.claudeCodeTasks?: boolean`**, modelada em `runner.unconfined` (ausente = desligada, `unconfinedOf`-style). Fora de `WEB_EDITABLE` em `src/main/configScope.ts`: o celular pareado não a muda (a regra existente já a recusa por nome).
4. **Campo `executor` na etapa**: `StageDef.executor?: 'agent' | 'claude-code'` (ausente = `agent`). Em `FlowStage` o campo só entra no snapshot quando é `'claude-code'`, para o hash do fluxo (`FlowSnapshot.hash`) de todos os fluxos existentes **não mudar** (a nota da #221 mostra que um campo novo em `FlowStage` toca o hash e a releitura do fluxo).
5. **Sem `Bash` nativo na sessão.** O limite de escrita só é imposto pelos hooks de arquivo (`Edit`, `Write`, `NotebookEdit`); um `Bash` livre escreveria em qualquer pasta. A sessão recebe `Read`, `Grep`, `Glob`, `Edit`, `Write` e, se o agente da etapa tem `shell: sandbox`, o shell em sandbox do app (`shellMcpServer`). Isso é uma limitação conhecida da primeira versão, dita na documentação.
6. **`isolated: true`** (sem `CLAUDE.md`/`.claude` do projeto ou da casa, sem memória automática), como os agentes da equipe (`sdkOptions` em `src/main/agents.ts`). Assim nada do `~/.claude` da pessoa entra na sessão nem nos testes.
7. **Permissões = item pendente de comando já existente.** `canUseTool` chama o mesmo porto `askCommand` (`ExecutorDeps`) que `hostApproval` usa, com o relógio da etapa pausado (`clock.pause()`). Reaproveita o cartão da tela, o limite do celular (`runs:command` está em `EXTERNAL_EFFECT` em `src/main/webPolicy.ts`) e a recusa que a sessão respeita. Acrescenta-se `tool?: string` opcional em `PendingCommand` e no pedido para o cartão dizer a ferramenta.
8. **Resultado.** O texto de `result` do SDK substitui a resposta (`summary`). Se o stage exige saída estruturada (`call.schema`, etapas de revisão/QA), passa-se o mesmo schema como `outputFormat` e o `structured_output` é o dado; sem schema, `data = { summary: result }`. Sessão sem resultado ou com `is_error` falha a etapa (`empty-answer` ou o código novo, como qualquer agente). Sem as rodadas de reparo (`repairRound`, `evidenceRound`, `askAgain`): elas continuam uma sessão do motor, e aqui a etapa só confere os documentos faltantes e falha com `missing-artifacts`.
9. **Transcrição.** Texto das mensagens e linhas de uso de ferramenta, passadas por `redact`/`maskOf`, gravadas num arquivo da pasta de dados da execução (`d.dataDir()`), mais uma mensagem `system` do app na conversa (`runner.claudeCode.transcript`). Um canal só de leitura `runs:claudeTranscript` (em `DESKTOP_ONLY`, porque o texto pode conter código) alimenta o detalhe da etapa em `StageTimeline.tsx`. Antes de codar, o desenvolvedor confere se o módulo de evidência (`keepEvidence`) cabe como destino mais simples; se couber, usa-o em vez de um canal novo.

## Mudanças, na ordem

### 1. Esquema e migração (`src/shared/config/`)
- `types.ts`: `StageDef.executor?`, `StageExecutor` e `STAGE_EXECUTORS`; `RunnerConfig.claudeCodeTasks?: boolean` e `claudeCodeTasksOf(runner)` em `src/shared/claudeCode.ts` (modelo: `src/shared/unconfined.ts`).
- `schema.ts`: o enum `executor` ao lado de `display` (linha ~176, e nos outros pontos onde o esquema de etapa se repete: conferir `devCycle.stages` e `devCycle.flows`) e `runner.claudeCodeTasks` ao lado de `unconfined` (~600).
- `defaults.ts`: `claudeCodeTasks: false` no runner; `executor` fica de fora (ausente = agente).
- `migrations.ts`: novo `v34ToV35` em `STEPS` (`34: v34ToV35`), `schemaVersion` + 1, comentário `v35 runner.claudeCodeTasks` como o de `v25`, e a entrada da tabela de versões por caminho (~linha 517) para `runner.claudeCodeTasks` e `…executor`. O passo grava `claudeCodeTasks: false` e não toca as etapas.
- Tipos: o versionamento de arquivo de execução (`RUN_VERSION`) **não** muda, porque o snapshot só ganha o campo quando é `'claude-code'`; a conferência é o teste do item 8.

### 2. Fluxo (`src/shared/runs/`)
- `types.ts`: `FlowStage.executor?: 'claude-code'` (ausente = agente); `PendingCommand.tool?`.
- `flow.ts` (resolução, onde `display: s.display === true` é lido, linha ~44): `...(s.executor === 'claude-code' ? { executor: 'claude-code' as const } : {})`. Uma etapa sem agente (gate, espera) ignora o campo, e `flow-check` (verificação do fluxo) rejeita `executor: 'claude-code'` em etapa sem agente.

### 3. Fronteira de segurança (`src/main/configScope.ts`, `webPolicy.ts`, `persona/`)
- `configScope.ts`: nova `executorRaised(before, after)` ligada em `refusedPaths`, porque `devCycle.stages`/`devCycle.flows` são editáveis pelo celular: uma etapa que passa a `'claude-code'` (ou nasce assim) é recusada por nome, e baixar para o agente é permitido. `runner.claudeCodeTasks` já fica recusado por não estar em `WEB_EDITABLE`.
- Persona: `persona/assist.ts` aplica `refusedPaths` só quando `viaOf() === 'paired'`; no desktop a persona alcança `config:save` pela tabela de portas (`persona/doorTable.ts`, `act('Settings','set',…)`). Acrescentar uma recusa do caminho `runner.claudeCodeTasks` e de qualquer `…executor` para a persona, em qualquer via (para ligar/escolher é preciso a pessoa na janela). Conferir o ponto exato em `persona/assist.ts` antes de editar; se a tabela de portas tem contagem fixada em teste (a #280 registrou 321 canais / 127 exclusões em outra worktree), o teste só muda se um canal novo entrar na tabela.
- `webPolicy.ts`: `runs:claudeTranscript` em `DESKTOP_ONLY`; `test/updates-policy.test.ts` e `test/plugins-web-policy.test.ts` cobrem a tabela.

### 4. Motor da sessão (novo `src/main/runner/claudeCodeTask.ts`)
`runClaudeCodeTask(deps, input)`, com `deps.query` injetável (padrão `loadClaudeQuery()`):
- Opções: `cwd: worktree`, `permissionMode: 'default'`, `canUseTool`, `hooks: confinedHooks({ root: worktree, commands, onDenied, anywhere })` de `src/main/runner/hooks.ts` (os mesmos que `executor.ts` passa em `confine`), `disallowedTools: ['Bash','WebFetch','WebSearch','NotebookEdit', ...SECRET_READ_DENY]`, `settingSources: []`, `settings: { autoMemoryEnabled: false }`, `systemPrompt` preset `claude_code` com o prompt da etapa anexado, `maxTurns` do `runner.turns`, `abortController` da etapa, `env` de `claudeSdkEnv(target)` e `pathToClaudeCodeExecutable` de `claudeExecutable()`.
- `canUseTool(tool, input)`: (a) defesa em profundidade: para `Edit`/`Write`, resolve o caminho (`realpath` do pai) e nega fora da worktree com mensagem; (b) senão pergunta pelo porto `askCommand` com o relógio pausado; `deny` volta como `{ behavior:'deny', message }` com a nota da pessoa; aborto da etapa nega.
- Laço sobre as mensagens: `req.beat`-equivalente (`clock.beat()`), uso (`onUsage`: tokens e `subscription`), transcrição, `result`/`is_error`.
- Devolve `{ data, sessionId, engine: 'claude-sdk', transcript }` com o mesmo formato de `StageEngine`, e erros do SDK mapeados como `runClaudeSdk` faz (orçamento, ocupação), para o runner dar os mesmos códigos.

### 5. Executor da etapa (`src/main/runner/executor.ts`)
- `ExecutorDeps.claudeCode?: { enabled(): boolean; test(): boolean; run: … }` (injeção; produção liga a `claudeCodeTask.ts` e a `isTestWorkspace()`).
- Em `runStage`, **antes** de abrir sandbox, tela ou worktree-locks, `guardExecutor(stage, config, d)`: `executor !== 'claude-code'` → nada muda. Caso contrário: opção desligada → `StageError('claude-code-off')`; workspace de teste → `StageError('claude-code-test')`; sem `d.claudeCode` → `claude-code-off`. Os dois códigos entram em `STAGE_ERROR_CODES` com mensagens i18n. Nunca cai em `d.engine`.
- Na chamada principal (linha ~1221), `stage.executor === 'claude-code' ? d.claudeCode.run(call, …) : d.engine(call, commands)`; os ramos de reparo/rodada são pulados para esse executor; o restante (documentos, memória, commit, `readOutput`) é o mesmo caminho dos agentes.
- A transcrição é gravada no `finally` mesmo quando a sessão falha.

### 6. Interface (`src/renderer/`)
- Editor de fluxo da equipe (`screens/team`, onde `display` é editado): campo "Executor" com as duas opções, visível/escolhível só com a opção ligada; etapa já configurada com Claude Code e opção desligada mostra o valor com aviso, e o caminho de execução falha.
- `RunnerSection.tsx` + `runnerEdit.ts`: botão "Entregar tarefas ao Claude Code", só desktop, texto de ajuda dizendo o limite (sem shell nativo, só a worktree).
- Cartão de comando pendente: mostra `tool`. `StageTimeline.tsx`: link "Transcrição" no detalhe. Tudo por `t()`, cores por tokens de tema; as chaves vão nos dois catálogos (`src/shared/i18n/ui-team.*.json`, `ui-cycle.*.json`, e o de runner para os erros).

### 7. Documentação
- `CHANGELOG.md` (`Unreleased`), a página de configuração e a do runner em `docs/` (a opção, o campo, o que a sessão pode e não pode). `AGENTS.md` não muda.

## Testes (um por comportamento; só sessões simuladas, nada de `~/.claude`)

| Critério | Teste | Arquivo |
|---|---|---|
| 1 resultado volta e substitui a resposta; a seguinte o recebe | etapa `claude-code` com `query` falso devolve `result`; `summary` é o texto e o artefato é escrito | `test/runner-claude-code-stage.test.ts` |
| 2 transcrição fora da resposta | arquivo da transcrição existe, a resposta não a contém, mensagem `system` registrada | idem |
| 3 permissão pendente | `canUseTool` chama `askCommand` com a ferramenta; sem resposta a etapa espera e o relógio está pausado; "allow" libera, "deny" volta `behavior:'deny'` com a nota | `test/claude-code-task.test.ts` |
| 4 escrita fora | `Write` em `../fora` e em link simbólico para fora é negado pelo hook e por `canUseTool`; arquivo não existe fora | idem |
| 5 opção desligada | `StageError('claude-code-off')`, `query` nunca chamado e `d.engine` nunca chamado | `test/runner-claude-code-stage.test.ts` |
| 6 workspace de teste | `claude-code-test` mesmo com a opção ligada | idem |
| 7 celular e persona | `refusedPaths` recusa ligar a opção e `executor` a `claude-code`, e deixa baixar; persona recusa os dois caminhos | `test/config-claude-code-scope.test.ts`, `test/persona-claude-code.test.ts` |
| 8 falha | sem `result`, com `is_error`, e erro lançado: etapa `failed` com o mesmo código/forma de um agente | `test/runner-claude-code-stage.test.ts` |
| 9 padrão intacto | etapa sem campo roda `d.engine`; hash do fluxo existente e `runVersionOf` inalterados | `test/runs-flow.test.ts` (resolução) e `test/runner-flow.test.ts` |
| 10 sem `~/.claude` | `settingSources: []` e `isolated` passados; teste confere as opções recebidas pelo `query` falso | `test/claude-code-task.test.ts` |
| Migração e esquema | `v34ToV35` grava `false`; `executor` inválido recusado pelo esquema | `test/config-migrations.test.ts` (nome real a conferir) |
| Editor | campo oculto/desabilitado com a opção desligada | `test/team-flow-edit.test.ts` |

Portões do repositório depois do código: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` (nenhum rodado nesta etapa).

## Riscos e como se contêm

- **Escrita fora da worktree por `Bash`.** Contido por não oferecer o `Bash` nativo (decisão 5); o shell, quando existe, é o sandbox do app. Teste: `disallowedTools` contém `Bash`.
- **Link simbólico ou `..` nos caminhos de `Edit`/`Write`.** Hook compartilhado e checagem extra com `realpath` em `canUseTool`; teste de ambos.
- **Hash do fluxo muda e as execuções antigas migram à força.** Campo só entra no snapshot quando `'claude-code'`; teste compara o hash antes/depois.
- **Esquema de configuração em duas frentes (#280, #282).** O número do passo de migração pode colidir na integração; a etapa de integração renumera (a memória do espaço registra essa renumeração para as outras entregas).
- **Persona no desktop alcança `config:save`.** Recusa explícita por caminho, com teste; se a tabela de portas guarda contagens, o teste é atualizado só se o conjunto de canais mudar.
- **Etapa parada esperando permissão e morta pelo relógio.** `clock.pause()` durante a pergunta, como em `hostApproval`; teste.
- **Vazamento de segredo na transcrição.** `redact` + `maskOf` antes de gravar, e canal só no desktop.
- **Diferença de comportamento entre saída em texto e etapas de revisão/QA.** O schema da chamada vai como `outputFormat`; se a sessão não devolver o formato, a etapa falha como qualquer agente. Não verificado: se `readOutput` aceita `{ summary }` sozinho para todo `kind`; o desenvolvedor confirma ao codar e, se não aceitar, usa o schema também para a etapa de trabalho.
- **Uso e custo.** A sessão pode contar como uso de assinatura; `onUsage` repassa `subscription` como no motor atual.

## O que o plano não cobre / não verificado

- A regra 12 da spec (depende da #280): o módulo de sessões não está nesta base, e o plano segue sem ele; a reconciliação fica para a integração.
- Não verificado: o formato exato de `readOutput`, o destino da transcrição (arquivo + canal ou evidência), o ponto de recusa da persona em `persona/assist.ts` e o nome do arquivo de teste de migração.
- O comportamento real do SDK (`canUseTool` com `permissionMode: 'default'`, `structured_output`) vem da leitura de `agents.ts` e de uma nota de outra entrega (SDK 0.3.x); nada foi rodado aqui.
- Critério 3 "recusar é respeitado pela sessão": coberto no teste com sessão simulada; o respeito real do Claude Code a um `deny` não foi observado.
