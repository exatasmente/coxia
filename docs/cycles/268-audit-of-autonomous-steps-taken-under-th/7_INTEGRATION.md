# Integração: base atrasada, o resto confere

**Veredito: devolver.** O item 3 (base) é bloqueante: a branch está 160 commits atrás da release aberta e a mescla de teste dá conflito. Peça que a base seja trazida pela ferramenta de conflito do app. Não fiz merge, rebase nem commit.

## Itens

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | CHANGELOG | OK. Há linha em `[Unreleased]` › Added, sobre o registro dos passos autônomos. | leitura de `CHANGELOG.md` |
| 2 | Esquema | OK, sem colisão. A branch não toca `CONFIG_SCHEMA_VERSION` nem as migrações (nenhum arquivo de `src/shared/config` além de `autonomy.ts` mudou desde a base comum). Vale 28 na branch, 32 em `origin/release/0.11.0` e 31 na main. Pull requests abertos para a release: não consultados (a ferramenta de leitura não lista pull requests); só conferi as branches. Aviso: a entrega da #269 usa `v28ToV29` e já foi mandada renumerar para `v32ToV33`; esta não muda o esquema e não conflita nesse ponto. | `git show origin/release/0.11.0:src/shared/config/types.ts`, `git diff` desde a base comum |
| 3 | Base | **BLOQUEANTE.** `git rev-list --count HEAD..origin/release/0.11.0` = 160 (a branch tem 7 commits à frente). `git merge-tree --write-tree` (sem gravar na árvore) dá conflito em `src/main/runner/executor.ts`, `src/renderer/src/screens/Auditoria.tsx`, `src/shared/auditoria.ts`, `src/shared/i18n/ui-today.en.json` e `ui-today.pt-BR.json`. A lista que li pode estar cortada; a saída foi vista só no final. `auditoria.ts` e `Auditoria.tsx` também são tocados pela #269, então o conflito pode se repetir com ela. | ev-6 |
| 4 | Gates | Passaram, com a ressalva dos testes de navegador (ver abaixo). | ev-6 |
| 5 | Nomes de módulo | OK. Os arquivos novos da branch (`test/audit-policy.test.ts`, `test/helpers/audit.ts`) não colidem. Pares que só diferem pela extensão já existiam (`jobs.css`/`jobs.ts`, `activity.css`/`activity.ts`, `CeremonyCommands.tsx`/`ceremonyCommands.css`, `icon.*`); não foram acrescentados por esta mudança e são css/ts, não módulos de mesmo nome. Nenhum par só por maiúscula. | `git ls-files` |
| 6 | Base do pull request | Deve ser `release/0.11.0`, não a main. Não aberto ainda. A release aberta foi deduzida da branch `origin/release/0.11.0` mais recente e da versão 0.11.0-beta; não confirmei no host. | leitura |

## Gates (rodados nesta etapa, nesta ordem)

- `npx tsc --noEmit`: saída 0.
- `npx vitest run` (com `out/` apagado antes): 459 de 463 arquivos e 7787 testes passaram, 15 ignorados. Falham 4 arquivos de navegador (`browser-contract`, `browser-runtime`, `browser-quit`, `browser-sites`) porque `@playwright/mcp` não está em `node_modules`. Não verifiquei se falham também na base.
- `node scripts/theme-audit.mjs`: terminou com a tabela de totais (14 no total).
- `npm run i18n:lint`: 5769 chaves iguais nos dois idiomas.
- `node scripts/public-audit.mjs`: 1713 arquivos, nada de empresa ou pessoa.
- `npx electron-vite build`: saída 0; `out/` apagado depois.

Observação sobre a rodada do app antes desta etapa: lá `test/public-audit.test.ts` falhou com 2 achados em `out/renderer/assets/elk-*.js` (`real-issue-number`). Eram arquivos de build deixados em `out/` (ignorado pelo git); depois de apagar `out/`, o teste passou nesta etapa. Quem rodar `vitest` deve apagar `out/` antes.

Os comandos de saída 0 do `theme-audit`, `i18n:lint` e `public-audit` passaram por `tail` no meu comando, então o código de saída vem das mensagens, não do status direto.

## Para a próxima passagem

1. Trazer a base pela ferramenta de conflito do app e resolver os 5 arquivos (e os que aparecerem).
2. Depois, rodar de novo `tsc`, `vitest`, os três audits e o build.
3. Abrir o pull request contra `release/0.11.0`.

## Não verificado

- Pull requests abertos para a release.
- Que a release aberta seja a 0.11.0 (deduzido).
- Os 4 testes de navegador e a tela do log aberta no app.
- Os gates rodaram na branch como está, não depois de trazer a base.

## Resultado dos cenários

- CHANGELOG tem linha em Unreleased: passou (lido) — Há linha em [Unreleased] › Added sobre o registro dos passos autônomos.
- Esquema sem passo repetido com a release: passou (executado na sandbox) — A branch não altera CONFIG_SCHEMA_VERSION (28) nem migrações; release em 32. Pull requests abertos não consultados.
- Base em dia com a release aberta: falhou (executado na sandbox) — 160 commits atrás de origin/release/0.11.0; merge-tree dá conflito em executor.ts, Auditoria.tsx, auditoria.ts e nos dois ui-today.
- Gates tsc, theme, i18n, public-audit, vitest e build: passou (executado na sandbox) — tsc 0, vitest 459/463 arquivos (4 de navegador falham por @playwright/mcp ausente), theme, i18n (5769 chaves), public-audit e build com saída 0; out/ apagado.
- Nomes de módulo sem pares por maiúscula/extensão: passou (executado na sandbox) — Nenhum par novo; os pares css/ts existentes são anteriores à mudança.
- Base do pull request: não rodou (lido) — Pull request ainda não aberto; a base correta é release/0.11.0 (deduzida, não confirmada no host).
