# Revisão da rodada 8: passo de migração renumerado para v36→v37

## Veredito

Aprovado. Só leitura; nenhum comando foi rodado nesta etapa.

## Bloqueantes anteriores

O único bloqueante aberto (rodada 6, teste da persona com `executor: undefined`) foi tratado na rodada 7 e não é reaberto.

## O que mudou nesta rodada (lido no diff)

- `CONFIG_SCHEMA_VERSION = 37` em `src/shared/config/types.ts`; comentário "schema 37" em `schema.ts`.
- `src/shared/config/migrations.ts`: `v36ToV37` grava `runner.claudeCodeTasks: false`; `STEPS` tem `36: v36ToV37`; comentário `v37`.
- `docs/configuration.md`: as menções à versão do esquema (pt-BR e en) passam a 37.
- Nada novo no código do produto: executor, fronteira de segurança e interface são os já aceitos.

## Achados

Nenhum bloqueante. Sem fato novo no diff.

## Ponto de atenção (não bloqueia esta revisão)

A base `origin/release/0.11.0` ainda não foi trazida. Neste ramo isolado `STEPS` não tem os passos 34 e 35 da release; uma configuração v34/v35 não migra aqui, e testes que migram de versão antiga até a atual podem falhar até a mesclagem. A mesclagem (ferramenta de conflito do app) deve manter v37, os passos 34 e 35 da release mais `36: v36ToV37`, e refazer a linha do CHANGELOG.

## Não verificado

- Nenhum portão rodado aqui: tsc, vitest, theme-audit, i18n:lint, public-audit, build. Todos precisam rodar de novo depois da mesclagem (atenção a `config-migrations` e `docs-schema-version`).
- O resultado da mesclagem com a release.
- Interface e comportamento real do SDK (deny respeitado, `canUseTool`, `structured_output`).
