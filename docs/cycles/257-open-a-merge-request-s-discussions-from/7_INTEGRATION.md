# Integração: discussões de uma MR por projeto e número

Veredito: **pronto para o pull request**, com três itens não verificados (base, esquema, base do PR) por falta de `.git` na cópia da sandbox. O pull request deve ter como base `release/0.10.0` (a release em andamento segundo a memória do workspace), nunca a `main`.

## Itens

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | CHANGELOG | Passou | Em `## [Unreleased]` › Added há a linha das discussões de uma MR abertas por projeto e número (lida por grep nesta etapa). |
| 2 | Esquema de configuração | **Não verificado** | `CONFIG_SCHEMA_VERSION = 30` em `src/shared/config/types.ts:5`. Sem `.git` não comparei com `origin/release/X.Y.Z` nem com PRs abertos (`vcs_read` não lista branches). Nada nos documentos do ciclo menciona migração de configuração; a mudança é de destino de botão, não de config. |
| 3 | Base | **Não verificado** | `git` falha na sandbox ("not a git repository"); `git rev-list --count HEAD..origin/release/...` não rodou. O app deve trazer a base pela ferramenta de conflito se a branch estiver atrás. |
| 4 | Gates do CI | Passou, com ressalvas | Ver abaixo. |
| 5 | Nomes de módulo | Passou | Varredura de `src` e `test` sem extensão/caixa: só `activity`, `ceremonyCommands`, `jobs`, `turnAsks`, cada um um par `.css` + código (padrão do repositório, não criado por esta mudança). Nenhum par de código com a mesma base. |
| 6 | Base do PR | **Não verificado** | Deve ser `release/0.10.0`. |

## Gates (rodados nesta etapa, na cópia descartável)

- `npx tsc --noEmit`: saída 0 (comando do app antes da etapa; `npm run typecheck`).
- `node scripts/theme-audit.mjs`: saída 0.
- `npm run i18n:lint`: 5927 chaves nos dois idiomas.
- `npx electron-vite build`: saída 0; `out/` apagado depois.
- `node scripts/public-audit.mjs`: com `out/` presente acusa 2 achados `real-issue-number` só no bundle gerado (`out/renderer/assets/elk-*.js`); sem `out/`, passa (1782 arquivos, nada). É artefato de build, não do código.
- `npx vitest run` em `conflict-resolve`, `public-audit`, `discussions-by-mr`, `push-targets`, `mentions-open-discussions`: 5 arquivos, 77 testes, saída 0.
- `npx vitest run` completo (rodado pelo app antes da etapa, saída 1): 4 testes e 2 suítes falharam. Falhas de navegador (`browser-*`, `@playwright/mcp` ausente no `node_modules`); `conflict-resolve` estourou 5 s e passou de novo sozinho; `public-audit.test` falhou só por `out/` presente (passa sem ele). Não rodei o vitest completo de novo.

## Não verificado

- Base, esquema, base do PR (acima).
- A tela no app (chat da persona, Fórum, execução), a linha no thread e o voltar: só testes automatizados, como diz o plano de testes.
- Celular pareado (Q3); Q5 (escopo da execução), Q6, Q7 seguem para a pessoa.
- Sugestão não bloqueante: cada toque grava uma nova linha de sistema.

## Resultado dos cenários

- CHANGELOG em Unreleased: passou (executado na sandbox) — Linha em Unreleased › Added sobre as discussões abertas por projeto e número.
- Gates theme, i18n, public, build: passou (executado na sandbox) — theme-audit 0, i18n 5927 chaves, build 0, public-audit sem out/ passa; com out/ acusa só o bundle gerado.
- Testes tocados e conflict-resolve: passou (executado na sandbox) — 5 arquivos, 77 testes passam, saída 0.
- Nomes de módulo: passou (executado na sandbox) — Só pares css+código preexistentes; nenhum par de código colide.
- Esquema, base atrás da release e base do PR: não rodou (lido) — Sandbox sem .git (git falha); vcs_read não lista branches. Sem comprovação; conferir antes de abrir o PR.
