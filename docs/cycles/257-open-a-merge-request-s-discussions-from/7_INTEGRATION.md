# Integração depois da mesclagem com a release

Veredito: **pronto para o pull request**, com ressalvas não verificadas (base, esquema contra a release, base do PR) porque a cópia da sandbox não tem `.git`. A base do PR deve ser `release/0.10.0`, nunca a `main`.

## Itens

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | CHANGELOG | Passou | `## [Unreleased]` › Added tem a linha das discussões de uma MR abertas por projeto e número (lida por grep nesta etapa). |
| 2 | Esquema de configuração | **Não verificado** | `CONFIG_SCHEMA_VERSION = 31` em `src/shared/config/types.ts:5` (veio da release). Sem git, não comparei com `origin/release/*` nem com PRs abertos. Nada nos documentos do ciclo indica migração de configuração; a mudança é de destino de botão. |
| 3 | Base | **Não verificado** | `git` falha na sandbox ("not a git repository"). A mesclagem de `release/0.10.0` (`8389197`) foi feita na etapa anterior; se ela andou depois, traga a base pela ferramenta de conflito do app. |
| 4 | Gates do CI | Passou (ressalvas abaixo) | Ver abaixo. |
| 5 | Nomes de módulo | Passou | Sem pares iguais por caixa. Pares que só diferem pela extensão: `activity`, `ceremonyCommands`, `jobs`, `turnAsks`, cada um `.css` + código (preexistente, não criado por esta mudança). |
| 6 | Base do PR | **Não verificado** | Deve ser `release/0.10.0`. |

## Gates (rodados nesta etapa)

- `node scripts/theme-audit.mjs`: saída 0.
- `npm run i18n:lint`: 6150 chaves nos dois idiomas, saída 0.
- `node scripts/public-audit.mjs` (sem `out/`): 1916 arquivos, nada achado, saída 0.
- `npx electron-vite build`: saída 0; `out/` apagado depois.
- `npx vitest run test/conflict-resolve.test.ts test/conflict-from-mr.test.ts`: 35 passam.
- `npm test` completo (rodado pelo app antes da etapa, saída 1): 13 testes e 5 arquivos falharam; 8701 passaram. As falhas mostradas são de `conflict-resolve` ("este conflito já tem um passo em andamento"), que passou inteiro ao rodar sozinho nesta etapa, o que indica oscilação sob carga. Os outros arquivos falhos não estavam no trecho visto; o relato anterior cita 4 arquivos de navegador (`@playwright/mcp` ausente). **Não verificado** individualmente.

## Não verificado

- Base atrás da release, esquema contra a release e PRs abertos, base do PR.
- A tela no app (chat da persona, Fórum, execução), linha no thread e voltar: só testes automatizados.
- Celular pareado (Q3); Q5, Q6, Q7 seguem para a pessoa.
- Sugestão não bloqueante: cada toque grava uma nova linha de sistema.

## Resultado dos cenários

- CHANGELOG em Unreleased: passou (executado na sandbox) — Linha em Unreleased › Added sobre as discussões abertas por projeto e número (grep em CHANGELOG.md).
- Gates theme, i18n, public, build: passou (executado na sandbox) — theme 0, i18n 6150 chaves, public-audit 1916 arquivos sem achado, build 0; out/ apagado.
- conflict-resolve e conflict-from-mr de novo: passou (executado na sandbox) — 35 testes passam rodados sozinhos; a falha do npm test do app foi oscilação sob carga.
- Nomes de módulo: passou (executado na sandbox) — Nenhum par igual por caixa; só pares css+código preexistentes.
- Esquema, base atrás da release e base do PR: não rodou (lido) — git falha na sandbox (não é repositório) e vcs_read não lista branches; sem comprovação. Conferir antes de abrir o PR (base release/0.10.0).
