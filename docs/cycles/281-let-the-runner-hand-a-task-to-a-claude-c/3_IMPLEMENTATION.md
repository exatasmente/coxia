# Sessão do Claude Code ligada ao executor da etapa

## Estado

O módulo da sessão existe e está ligado ao executor e à produção. Continuam por fazer a interface (campo Executor, botão da opção, transcrição na timeline), a documentação em `docs/` e `flow-check` rejeitando `claude-code` em etapa sem agente. **Nenhum comando foi rodado nesta tentativa** (tsc, vitest, theme-audit, i18n:lint, public-audit): tudo abaixo é leitura e escrita de código, não verificado por execução.

## O que mudou nesta tentativa

- `src/main/runner/claudeCodeTask.ts` (novo): `runClaudeCodeTask(deps, input)` abre a sessão pelo Agent SDK (`query` injetável). Opções: `permissionMode: 'default'`, `settingSources: []`, `settings.autoMemoryEnabled: false`, `disallowedTools` com `Bash`, `WebFetch`, `WebSearch`, `NotebookEdit` e `SECRET_READ_DENY`, `hooks` = os `call.confine.hooks` da própria etapa (a cerca da worktree), `outputFormat` quando há schema, `maxTurns` da chamada. `canUseTool`: para `Edit`/`Write`/`MultiEdit`/`NotebookEdit` repete `checkPath` (resolve link simbólico e `..`) e nega sem perguntar; senão pausa o relógio, pergunta à pessoa e devolve `allow` ou `deny` com a nota; com a etapa abortada, nega. O texto de `result` vira `data = { summary }` (ou o `structured_output` com schema); `is_error`, subtipo diferente de `success`, resultado vazio ou fim sem resultado lançam erro como um agente que falha. A transcrição (texto e linhas de ferramenta, passadas por `redact`) volta à parte.
- `src/main/runner/executor.ts`: `ExecutorDeps.claudeCode = { test(); run(input) }`. O ramo da chamada principal usa `d.claudeCode.run` no lugar de `d.engine` (nunca cai no agente do Coxia; sem porta, `claude-code-off`). A pergunta de permissão usa o `askCommand` existente (texto `Ferramenta: caminho`). A transcrição é gravada em `<dataDir>/claude-code/<run>-<stage>.txt` e uma mensagem do app (`runner.claudeCode.transcript`) a anuncia na conversa. Rodadas de reparo (QA sem comando, evidência, documentos faltantes) são puladas para esse executor.
- `src/main/runner/service.ts` e `module.ts`: `RunnerDeps.claudeCode` repassado ao executor; na produção usa `isTestWorkspace`, `loadClaudeQuery`, `claudeSdkEnv(rc().agentModel(...))` e `claudeExecutable`.
- `src/main/configScope.ts` e `configModule.ts`: `claudeCodeRaised` (liga a opção ou escolhe o executor) recusada em `config:save` quando a chamada é da persona (`byPersona()`), com a mensagem `main.config.webScope`.
- `src/shared/i18n/main.en.json` e `main.pt-BR.json`: `main.forum.code.runner.claudeCode.transcript`.
- `CHANGELOG.md` (`Unreleased`): entrada, dizendo que o campo ainda não está na interface.
- Testes: `test/claude-code-task.test.ts` (novo, sessão simulada, tmp dirs, nada de `~/.claude`): resultado e transcrição à parte, schema, falhas (erro, `is_error`, vazio, sem resultado), opções isoladas e sem `Bash`, permissão pendente com relógio pausado e recusa com nota, escrita fora por `..` e link e caminho absoluto negada sem perguntar, etapa abortada. `test/claude-code-executor-guard.test.ts` ajustado ao novo formato da porta e com o teste de `claudeCodeRaised`.

## Do que já existia (passos anteriores)

Esquema e migração v34→v35, `claudeCodeTasksOf`, `FlowStage.executor` só quando `claude-code`, `guardExecutor` (`claude-code-off`, `claude-code-test`), `executorRaised` para o celular e seus testes.

## Não feito

- Interface: campo Executor no editor do fluxo, botão em `RunnerSection`, transcrição no detalhe da etapa (`runs:claudeTranscript` não foi criado; a transcrição é arquivo e mensagem da conversa), chaves i18n da interface. O critério 2 ("transcrição disponível como detalhe") está atendido só pelo arquivo e pela mensagem, não por um link na tela.
- Documentação em `docs/` (opção, campo, limites: sem shell nativo).
- `PendingCommand.tool`: a ferramenta vai dentro do texto da pergunta.
- `flow-check` rejeitando `claude-code` em etapa sem agente.
- Teste de integração do ramo do executor (etapa `claude-code` com `query` falso pelo `executeStage`, critérios 1, 5, 6, 8 e 9 de ponta a ponta) e teste da recusa da persona pelo handler.
- Confirmar: se `config:save` recebe a configuração inteira também quando vem pela porta da persona (`Settings.set` com path/valor); a guarda foi posta no handler por isso, mas o encaminhamento da persona não foi lido.

## Verificação

Não rodados, portanto não verificados: `npx tsc --noEmit`, `npx vitest run` (em especial `test/claude-code-task.test.ts`, `test/claude-code-executor-guard.test.ts`, `test/config-migrations.test.ts`), `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. Pontos de tipo a conferir no tsc: o retorno `firstRun` agora é a união do motor e do resultado da sessão; o cast de `loadClaudeQuery` em `module.ts`; o tipo das opções em `claudeCodeTask.ts`; o mock de `AgentCall` nos testes; chaves `main.forum.code.*` talvez exigirem registro de código em outro lugar.
