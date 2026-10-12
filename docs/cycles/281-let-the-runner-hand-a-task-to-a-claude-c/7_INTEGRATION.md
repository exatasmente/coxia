# Integração: bloqueada pela base e pelo passo de migração

## Veredito

**Devolver ao implement.** Os itens 2 e 3 são bloqueantes. O item 1 está certo. Do item 4, tsc, vitest, theme-audit, i18n:lint, public-audit e o build passaram nesta etapa. O item 5 está limpo. O item 6 (base do pull request) só pode ser conferido na abertura do pull request: a base deve ser `release/0.11.0`.

Um limite: o `git fetch` não foi rodado, porque esta etapa só lê. Os números abaixo usam as referências locais de `origin/release/0.11.0` (último commit em 12 out, 10:56). Os pull requests abertos para a release não foram listados: só a leitura da release em si foi feita, e `vcs_read` não foi usado.

## Itens

1. **CHANGELOG: ok (lido).** Há uma linha em `[Unreleased]`, na seção Added, sobre `executor: claude-code`. Ela vai precisar ser refeita no conflito de mesclagem, porque a release também mexeu em `CHANGELOG.md`.

2. **Esquema: BLOQUEANTE.** A branch tem `CONFIG_SCHEMA_VERSION = 35` e o passo `v34ToV35` (`runner.claudeCodeTasks`). A release aberta `0.11.0` tem `CONFIG_SCHEMA_VERSION = 36`: seu `v34ToV35` é de `claudeSessions` (#280) e seu `v35ToV36` é de outra entrega. **Renumerar o passo desta branch para v36→v37** (`CONFIG_SCHEMA_VERSION = 37`, `STEPS[36]`, o comentário `v37`, a tabela de versões por caminho e os testes de migração e do `docs-schema-version`). Isso se faz junto com trazer a base.

3. **Base: BLOQUEANTE.** A branch está 33 commits atrás de `origin/release/0.11.0` (merge-base 41bee786). `git merge-tree` indica conflito em: CHANGELOG.md, docs/configuration.md, src/main/configModule.ts, src/main/configScope.ts, src/main/runner/executor.ts, src/main/runner/service.ts, src/shared/config/migrations.ts, schema.ts, types.ts, test/config-migrations.test.ts e test/helpers/runner.ts. Devolvo pedindo que a base seja trazida pela ferramenta de conflito do app. Não foi feito merge, rebase nem commit pelo shell.

4. **Gates.**
   - Estes resultados valem para a branch atual, antes da base nova: depois da mesclagem e da renumeração todos os gates precisam rodar de novo.

5. **Nomes de módulo: ok.** Nenhum arquivo novo da branch colide por maiúscula ou extensão (conferido com `git diff --name-status` contra o merge-base). Existem pares antigos como `activity.ts`/`activity.css`, que não vêm desta branch. O teste `module-names-case` passou.

6. **Base do pull request: não aplicável ainda.** Deve ser `release/0.11.0`, nunca `main`.

## Não verificado

- Interface (campo Executor, botão da opção) e o comportamento real do SDK (`canUseTool`, deny respeitado): sem app subido nem sessão real.
- Os pull requests abertos para a release (não consultados).
- O resultado depois de trazer a base: gates e renumeração.

## Resultado dos cenários

- 1 CHANGELOG: passou (lido) — Linha em [Unreleased] > Added; precisa ser refeita no conflito.
- 2 Esquema vs release: falhou (executado na sandbox) — Branch v35 colide com v35 (claudeSessions) da release 0.11.0, que está em 36. Renumerar para v36→v37.
- 3 Base: falhou (executado na sandbox) — 33 commits atrás de origin/release/0.11.0 e conflito em 11 arquivos (merge-tree). Sem fetch nesta etapa.
- 4 Gates theme-audit, i18n:lint, public-audit, build: passou (executado na sandbox) — Todos com saída 0; out/ apagado. tsc e vitest passaram no app antes da etapa.
- 5 Nomes de módulo: passou (executado na sandbox) — Nenhum arquivo novo da branch colide por maiúscula ou extensão.
- 6 Base do pull request: não rodou (lido) — Não há pull request ainda; deve apontar para release/0.11.0. Sem comprovação.
