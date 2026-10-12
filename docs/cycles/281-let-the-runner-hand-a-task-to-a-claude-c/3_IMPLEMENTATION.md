# Passo de migração renumerado para v36→v37

## Estado

A release aberta já usa os passos 34→35 (sessões do Claude Code) e 35→36 (outra entrega). O passo desta entrega passou a ser **v36→v37**. **Nenhum comando foi rodado** (não há comando permitido): `npx tsc --noEmit`, `npx vitest run` e as auditorias são **não verificados**.

## O que mudou

- `src/shared/config/types.ts`: `CONFIG_SCHEMA_VERSION = 37` e comentário do topo.
- `src/shared/config/migrations.ts`: `v34ToV35` virou `v36ToV37` (grava `schemaVersion: 37` e `runner.claudeCodeTasks: false`); `STEPS` ganhou `36: v36ToV37` no lugar de `34: v34ToV35`; comentário `v37`.
- `src/shared/config/schema.ts`: comentário "schema 37".
- `docs/configuration.md`: as quatro menções à versão do esquema (pt-BR e en) passam a 37.
- `test/config-migrations.test.ts`: o bloco do passo parte de um documento v36, espera `fromVersion` 36, "37 é o atual e 38 é recusado".

## Base não trazida (importante)

A mesclagem com `origin/release/0.11.0` (33 commits, conflitos em CHANGELOG, docs/configuration.md, configModule, configScope, executor, service, migrations, schema, types, config-migrations.test e test/helpers/runner.ts) não foi feita aqui: sem git e sem comandos. Enquanto a base não entra, `STEPS` deste ramo não tem os passos 34 e 35, então uma configuração v34/v35 não migra neste ramo isolado; a mesclagem traz esses passos da release. Ao resolver os conflitos: manter `CONFIG_SCHEMA_VERSION = 37`, `STEPS` com os passos da release (34, 35) mais `36: v36ToV37`, o comentário `v37` depois dos da release, e refazer a linha do CHANGELOG.

## Não feito (aceito)

Link da transcrição na timeline e canal `runs:claudeTranscript`; `PendingCommand.tool`; `flow-check` para executor sem agente; teste de componente do `StagePanel`.

## Não verificado

Tudo: tsc, suíte completa, theme-audit, i18n:lint, public-audit, build, o resultado da mesclagem e outros testes que citem o número da versão do esquema.
