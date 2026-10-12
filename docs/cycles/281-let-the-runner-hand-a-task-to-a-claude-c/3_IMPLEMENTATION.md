# Sessão do Claude Code: correções da QA

## Estado

Esta tentativa tratou as falhas que a QA mediu (tsc, theme-audit, i18n:lint e public-audit passaram; vitest falhou com 12 testes em 7 arquivos). **Nenhum comando foi rodado nesta tentativa** (sem shell): `npx tsc --noEmit`, `npx vitest run` e as auditorias são **não verificados**. As correções abaixo são leitura e escrita de código.

## O que mudou

- **Esquema da execução** (`src/shared/runs/schema.ts`): o bloco da etapa ganhou `executor` (enum `claude-code`), ao lado de `display`. Era a causa dos cinco testes de `runner-claude-code-stage` e de toda criação de execução com etapa Claude Code ("executor: is not a known field"). `RUN_VERSION` e o hash do fluxo não mudam: o campo só entra no snapshot quando é `claude-code`.
- **Teste da persona** (`test/config-claude-code-persona.test.ts`): a config neutra não tem etapas; o teste agora parte de uma etapa de trabalho própria (`withStage`) antes de escolher o executor.
- **Testes que não esperavam o campo novo**: `test/runner-config.test.ts` e `test/team-runner-edit.test.ts` passam a esperar `claudeCodeTasks: false` no runner.
- **Documentação**: `docs/configuration.md` cita a versão do esquema 35 (pt-BR e en, texto e tabela).
- **Catálogos**: as chaves `ui.flow.f.executor*` e `ui.runner.claudeCodeTasks*` foram para a posição ordenada em `ui-team.en.json` e `ui-team.pt-BR.json` (o teste exige chaves em ordem).
- **runs-policy** (`test/runs-policy.test.ts`): `module.ts` lê `isTestWorkspace` só para passar a resposta à guarda do executor Claude Code; não escreve em host. O teste agora separa `externalRefusal`/`assertExternalWrite` (só `door.ts`) de `isTestWorkspace` (só `module.ts`).

## Não feito (aceito)

Link da transcrição na timeline e canal `runs:claudeTranscript`; `PendingCommand.tool`; `flow-check` para executor sem agente; teste de componente do `StagePanel`.

## Verificação

Não rodados, portanto não verificados: `npx tsc --noEmit`, `npx vitest run` (primeiro `test/runner-claude-code-stage.test.ts`, `test/config-claude-code-persona.test.ts`, `test/runner-config.test.ts`, `test/team-runner-edit.test.ts`, `test/docs-schema-version.test.ts`, `test/ui-i18n.test.ts`, `test/runs-policy.test.ts`), `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.

Riscos a conferir ao rodar: se a etapa `build` do teste da persona passa na validação de `saveConfig`; se o esquema da execução tem outro lugar que repita o bloco da etapa; se `ui-i18n` (ordem) passa também no pt-BR.
