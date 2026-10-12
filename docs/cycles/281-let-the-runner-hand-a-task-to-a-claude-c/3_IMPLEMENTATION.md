# Sessão do Claude Code: executor, interface, testes de ponta a ponta e documentação

## Estado

O módulo da sessão, a guarda, a recusa do celular e da persona, a interface do campo e da opção, a documentação e os testes de ponta a ponta estão escritos. **Nenhum comando foi rodado** (esta etapa não tem shell): `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` e `node scripts/public-audit.mjs` são **não verificados**. Tudo abaixo é leitura e escrita de código.

## O que mudou nesta rodada (devolução da revisão 3)

- **Transcrição também na falha** (`src/main/runner/claudeCodeTask.ts`, `executor.ts`): `runClaudeCodeTask` anexa o texto acumulado ao erro que lança (`transcriptOf(e)`); o ramo do executor grava o arquivo e a mensagem da thread tanto no sucesso quanto no erro.
- **Teste do `executeStage` com `claude-code`** (`test/runner-claude-code-stage.test.ts`, novo; `test/helpers/runner.ts` ganhou a opção `claudeCode` do `boot`): porta de sessão simulada, fluxo inteiro do runner. Cobre: a sessão roda e `d.engine` nunca roda para o desenvolvedor, e o resultado aparece na thread no lugar da resposta do agente (critérios 1 e 9); transcrição em arquivo + mensagem `runner.claudeCode.transcript`, fora das mensagens do agente (critério 2); falha da sessão deixa a execução `failed` com a mensagem e ainda grava a transcrição (critério 8); opção desligada e workspace de teste falham com a mensagem clara, sem chamar a porta nem o agente (critérios 5 e 6); etapa sem executor ou com `agent` segue no agente do Coxia com a opção ligada (critério 9).
- **Teste do handler da persona** (`test/config-claude-code-persona.test.ts`, novo): `config:save` pela porta da persona (`invokePersona` dentro de um ato aberto) é negado ao ligar `runner.claudeCodeTasks` e ao escolher `executor`, sem mudar a configuração guardada; a janela da pessoa liga e escolhe; a persona pode baixar os dois (critério 7).
- **Teste do erro com transcrição** em `test/claude-code-task.test.ts`; formatação de `withExecutor` em `test/claude-code-executor-guard.test.ts` corrigida.
- **Interface:** `StagePanel.tsx` (campo Executor para etapas de trabalho, só visível com a opção ligada ou quando a etapa já está em `claude-code`; desabilitado com a opção desligada e no navegador pareado; aviso quando a opção está desligada e a etapa já usa Claude Code), `FlowEditor.tsx` (passa `claudeCodeOn`), `labels.ts` (`EXECUTOR_LABEL`), `RunnerSection.tsx` e `runnerEdit.ts` (botão "Entregar tarefas ao Claude Code", só no desktop; no navegador pareado aparece só leitura e o valor guardado é mantido). Chaves em `ui-team.en.json` e `ui-team.pt-BR.json`. Mudar o tipo da etapa para não trabalho limpa o `executor`.
- **Documentação:** seção nova em `docs/runner.md` (pt-BR e en) e o CHANGELOG atualizado.
- **Ruído de diff:** o espaço depois dos dois-pontos em `main.forum.code.runner.qa.repair` voltou nos dois catálogos principais.

## Do que já existia

Esquema e migração v34→v35, `claudeCodeTasksOf`, `FlowStage.executor` só quando `claude-code`, `guardExecutor`, `executorRaised` e `claudeCodeRaised`, o módulo da sessão e a fiação em `service.ts` e `module.ts`, e os testes de módulo.

## Não feito

- Link da transcrição no detalhe da etapa (`StageTimeline.tsx`) e canal `runs:claudeTranscript`: a transcrição fica em arquivo e na mensagem da thread. O critério 2 vale por esses dois, não por um link na tela.
- `PendingCommand.tool`: a ferramenta vai no texto da pergunta.
- `flow-check` rejeitando `executor` em etapa sem agente (o campo é ignorado nelas; a interface o limpa ao trocar o tipo).
- Teste de componente do `StagePanel` com a opção desligada (critério 5 na interface): a visibilidade é uma condição no componente, sem teste automatizado.

## Verificação

Não rodados, portanto não verificados: `npx tsc --noEmit`, `npx vitest run` (em especial `test/runner-claude-code-stage.test.ts`, `test/config-claude-code-persona.test.ts`, `test/claude-code-task.test.ts`, `test/claude-code-executor-guard.test.ts`, `test/config-migrations.test.ts` e os testes de `runnerEdit`), `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

Pontos que a execução deve conferir primeiro: o id da etapa `implement` e o agente `developer` no fluxo de engenharia do `boot`; se o texto da resposta da sessão aparece na thread como o teste assume; `dataDir` do executor ser a pasta `b.dir` do `boot`; `runAct`/`invokePersona` devolverem a rejeição do handler como o teste assume; teste de chaves i18n não usadas ou de cobertura dos dois catálogos para as chaves novas; tipos de `firstRun` e do cast de `loadClaudeQuery`.
