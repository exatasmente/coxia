# Implementação parcial: esquema, guarda e fronteira do celular

## Estado

Do plano estão feitos o passo 1 (esquema e migração), parte do passo 2 (resolução do fluxo), a fronteira do celular do passo 3 e a guarda do passo 5. Falta o módulo da sessão (passo 4), o desvio real no executor, a interface, o restante do i18n e a documentação. **Nenhum comando foi rodado nesta tentativa** (tsc, vitest, theme-audit, i18n:lint, public-audit): nada abaixo está verificado por execução.

## O que mudou (lido no diff do worktree)

- Esquema e migração (passo 1): `StageDef.executor?`, `runner.claudeCodeTasks`, `claudeCodeTasksOf` em `src/shared/claudeCode.ts`, `v34ToV35`, descarte de `executor` inválido no reparo e os testes da migração, incluindo o do descarte do executor inválido (já presente em `test/config-migrations.test.ts`). Os comentários "schema 34" de `schema.ts` e `types.ts` agora dizem 35.
- `src/shared/runs/types.ts` e `flow.ts`: `FlowStage.executor?: 'claude-code'`, só presente em etapa de trabalho com esse executor, para o hash dos fluxos existentes não mudar.
- `src/main/runner/executor.ts`: códigos `claude-code-off` e `claude-code-test`, `guardExecutor` chamada logo depois de `pickAgent` (antes de worktree, sandbox ou tela), `ExecutorDeps.claudeCode?: { test() }`. Como o módulo da sessão ainda não existe, o ponto da chamada ao motor lança `claude-code-off` para a etapa claude-code: ela nunca chega ao `d.engine`.
- `src/main/configScope.ts`: `executorRaised`, ligada em `refusedPaths`; uma etapa que passa a claude-code (no ciclo ou num fluxo) é recusada por nome, e voltar ao agente é permitido. `runner.claudeCodeTasks` já é recusada por não estar em `WEB_EDITABLE`.
- `src/shared/i18n/main.en.json` e `main.pt-BR.json`: mensagens dos dois erros.
- `test/claude-code-executor-guard.test.ts` (novo): guarda (padrão intacto, opção desligada, workspace de teste), hash do fluxo, `executorRaised` e a opção fora do que o celular edita.

## Não feito

- Passo 3: recusa da persona (`persona/assist.ts`) e `runs:claudeTranscript` em `DESKTOP_ONLY`.
- Passo 4: `src/main/runner/claudeCodeTask.ts` (Agent SDK, canUseTool, hooks de confinamento, transcrição). Sem ele, os critérios 1 a 4 da spec não são atendidos.
- Passo 5 restante: ligar `d.claudeCode` à produção (`isTestWorkspace`) e trocar o `throw` provisório pela chamada da sessão; `PendingCommand.tool`.
- Passo 6: campo Executor no editor do fluxo, botão em `RunnerSection`, cartão e transcrição na timeline, chaves i18n da interface.
- Passo 7: documentação e CHANGELOG.
- `flow-check` rejeitando claude-code em etapa sem agente (hoje o campo é ignorado nelas).

## Verificação

Não rodados, portanto não verificados: `npx tsc --noEmit`, `npx vitest run` (incluindo `test/claude-code-executor-guard.test.ts` e `test/config-migrations.test.ts`), `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. Um ponto a conferir no tsc: `after.devCycle.flows` em `executorRaised` e o formato do mock de `guardExecutor` nos testes.
