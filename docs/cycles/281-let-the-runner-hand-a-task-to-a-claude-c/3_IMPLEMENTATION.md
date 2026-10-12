# Implementação parcial: só o esquema e a migração

## Estado

Dos sete passos de 2_PLAN.md, só o passo 1 (esquema e migração) está no código. Os passos 2 a 7 não foram feitos. Nenhum portão do repositório foi rodado nesta tentativa: nada abaixo está verificado por execução.

## O que mudou (lido no diff do worktree)

- `src/shared/config/types.ts`:
  - `CONFIG_SCHEMA_VERSION` 34 → 35;
  - `STAGE_EXECUTORS` e `StageExecutor`;
  - `StageDef.executor?`;
  - `RunnerConfig.claudeCodeTasks?`.
- `src/shared/claudeCode.ts` (novo): `claudeCodeTasksOf(runner)`, em que ausente significa desligado. Segue o modelo de `unconfined.ts`.
- `src/shared/config/schema.ts`: o enum `executor` no objeto `stage`, que vale para `devCycle.stages` e para `devCycle.flows`, e o booleano `runner.claudeCodeTasks`.
- `src/shared/config/defaults.ts`: `claudeCodeTasks: false`.
- `src/shared/config/migrations.ts`:
  - comentário da v35;
  - `v34ToV35`, que grava `claudeCodeTasks: false` mesmo por cima de um valor guardado, não toca nas etapas e, com `runner` inválido, só sobe a versão;
  - `34: v34ToV35` em `STEPS`;
  - novo nesta tentativa: no reparo (`poolKeyAt`), um `executor` inválido em `devCycle.stages[i]` ou em `devCycle.flows.<squad>[i]` é descartado sozinho.
- `test/config-migrations.test.ts`: casos da v34→v35. O passo grava `false`, não acrescenta `executor` às etapas, o resultado valida, uma segunda migração não muda nada, um `runner` inválido só sobe a versão, e 35 é a versão atual, com 36 recusado.

## Não feito

- Passo 2: `FlowStage.executor` (só quando `claude-code`) na resolução do fluxo, a checagem do fluxo para etapa sem agente e `PendingCommand.tool`.
- Passo 3: `executorRaised` em `configScope.ts`, a recusa da persona e `runs:claudeTranscript` em `DESKTOP_ONLY`.
- Passo 4: `src/main/runner/claudeCodeTask.ts`.
- Passo 5: guarda e desvio em `executor.ts`, com os códigos `claude-code-off` e `claude-code-test`.
- Passo 6: interface e i18n.
- Passo 7: documentação e CHANGELOG.
- Testes dos critérios 1 a 9 da spec, e um teste para o descarte do `executor` inválido no reparo.

## Verificação

Nenhum comando de verificação foi rodado. Não verificados:

- `npx tsc --noEmit`
- `npx vitest run`
- `node scripts/theme-audit.mjs`
- `npm run i18n:lint`
- `node scripts/public-audit.mjs`

Um ponto a conferir: o comentário do topo de `schema.ts` ainda diz "schema 34".
