# Integração: conferência antes do pull request

## Veredito
**Devolver ao implement** só para trazer a base: a branch está 11 commits atrás de `origin/release/0.11.0` e a mesclagem de teste (`git merge-tree`) acusa conflito em `CHANGELOG.md` (os demais arquivos mesclam sozinho). Pedir que a base seja trazida pela ferramenta de conflito do app. Nada foi mesclado, rebaseado nem commitado pelo shell. Depois disso, o resto está pronto.

## Itens

1. **CHANGELOG: ok.** Há linha em `## [Unreleased]` > `### Added` ("Talk to the persona by voice..."). Lido em `CHANGELOG.md`. O conflito acima é nesse arquivo; ao trazer a base, manter a linha na seção Unreleased.
2. **Esquema: ok.** `CONFIG_SCHEMA_VERSION = 34` na branch e em `origin/release/0.11.0`; a branch não toca `src/shared/config`, então não cria passo de migração. Pull requests abertos para a release: **não verificado** (não consegui listá-los com a leitura do host, que exige o número).
3. **Base: bloqueante.** `git rev-list --count HEAD..origin/release/0.11.0` = 11 (7 à frente). Conflito provável confirmado só em CHANGELOG.md.
4. **Gates:**
   - `npx vitest run` (rodado pelo app): 4 arquivos e 2 testes falham (browser-contract, browser-quit, browser-runtime, browser-sites) por falta de `@playwright/mcp` na worktree; 8955 passam. Não repeti e não os rodei sozinhos de novo; a causa é de ambiente, não da mudança (não verificado em um ambiente com o pacote).
   - `node scripts/theme-audit.mjs`: exit 0 (rodei).
   - `npm run i18n:lint`: 6305 chaves nos dois idiomas, 0 sem tradução (rodei).
   - `node scripts/public-audit.mjs`: limpo, 2003 arquivos (rodei).
   - `npx electron-vite build`: exit 0; `out/` apagado (rodei).
5. **Nomes de módulo: ok para o que a branch acrescentou.** Nenhum arquivo novo colide por maiúscula/extensão. Há pares já existentes na main (`activity.ts`/`activity.css`, `jobs.ts`/`jobs.css`, `CeremonyCommands.tsx`/`ceremonyCommands.css`, `TurnAsks.tsx`/`turnAsks.css`), não vindos desta branch e de extensões diferentes; observação, não bloqueio desta entrega.
6. **Base do pull request:** deve ser `release/0.11.0` (a release aberta em origin), não a main. O PR ainda não existe.

## Não verificado
App com voz instalada, latência, celular, o modelo seguindo o prompt de voz, vitest sem as falhas de ambiente, pull requests abertos na release.

Comprovação: ev-3.

## Resultado dos cenários

- Base atualizada com a release aberta: falhou (executado na sandbox) — 11 commits atrás de origin/release/0.11.0; merge-tree acusa conflito em CHANGELOG.md.
- Esquema de configuração sem colisão: passou (executado na sandbox) — CONFIG_SCHEMA_VERSION 34 igual à release; a branch não altera src/shared/config. PRs abertos não listados.
- Auditorias e build: passou (executado na sandbox) — theme-audit, i18n:lint (6305 chaves), public-audit e electron-vite build saíram com 0.
- Nomes de módulo: passou (executado na sandbox) — Nenhum arquivo novo colide; pares antigos na main não vêm desta branch.
- Fluxo de voz no app, latência, celular: não rodou (lido) — Sem voz instalada nem aparelho; sem comprovação.
