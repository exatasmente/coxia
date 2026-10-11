# Integração: pronto para o pull request

## Veredito

Pronto para o pull request. Nenhum item bloqueante (1 a 6). O PR #277 já existe e aponta para `release/0.11.0`.

## Itens

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | CHANGELOG | Ok | Entrada em `## [Unreleased]` › `### Added` ("Schedules that wake the persona, kept by the app"); o diff de CHANGELOG.md contra a release é só essa inserção. |
| 2 | Esquema de configuração | Ok | `CONFIG_SCHEMA_VERSION` = 32 na branch e em `origin/release/0.11.0`. A branch não toca nenhum arquivo de `src/shared/config` em relação à release: sem passo de migração novo (a agenda fica em `schedules.json`). Sem colisão com a release. Outros PRs abertos para a release: a consulta ao host só devolveu o #277 (não há operação de listar todos); não verificado. |
| 3 | Base | Ok | `git rev-list --count HEAD..origin/release/0.11.0` = 0; 7 commits à frente. Host: `hasConflicts: false`. |
| 4 | Gates do CI | Ok | Abaixo. |
| 5 | Nomes de módulo | Ok para esta mudança | Nenhum arquivo novo (`src/main/schedules/*`, `src/shared/schedules.ts`, telas) colide por maiúscula ou extensão. Pares já existentes na release (um `.css` ao lado de `.ts`/`.tsx`: TurnAsks, CeremonyCommands, jobs, activity; `icon.png`/`icon.svg`) não vêm desta branch; só observação. |
| 6 | Base do PR | Ok | PR #277: base `release/0.11.0`; CI do host `success` no commit cf3ae072. |

## Gates

- `npm run typecheck` (tsc --noEmit), rodado pelo app antes da etapa: saída 0.
- `npm test` (app, antes da etapa): 8772 passaram, 3 falharam, 15 pulados. Falhas: `browser-sites`, `browser-quit` e `browser-runtime`/`browser-contract` (falta `@playwright/mcp` em node_modules, sem relação com a mudança) e `public-audit.test` (achou `out/` velho de um build anterior). Nesta etapa, depois de apagar `out/`, `npx vitest run test/public-audit.test.ts`: 18 de 18, saída 0.
- `node scripts/theme-audit.mjs`: saída 0.
- `npm run i18n:lint`: 6215 chaves nos dois idiomas, saída 0.
- `node scripts/public-audit.mjs`: saída 0 sem `out/` (com `out/` velho, 2 achados no bundle `elk`, artefato de build, não do repositório).
- `npx electron-vite build`: saída 0; `out/` apagado em seguida.

## Não verificado

- Tela Agendamentos e pergunta de partida no app rodando (nenhuma etapa abriu o app).
- Critério 8: só o carimbo `door: 'schedule'` é testado; sem teste de integração com Actions.
- Sugestão da revisão aberta: recusar conversa de run na criação.
- Horário de verão; outros PRs em voo para a release.
- Testes de navegador, que dependem do pacote ausente.

## Resultado dos cenários

- Base e esquema contra release/0.11.0: passou (executado na sandbox) — 0 commits atrás, 7 à frente; schema 32 igual à release e nenhum arquivo de config tocado.
- Gates theme, i18n, public-audit, build: passou (executado na sandbox) — theme-audit 0, i18n 6215 chaves, build 0, public-audit 0 após apagar out/.
- Tela Agendamentos e pergunta de partida no app: não rodou (lido) — O app não foi aberto; sem comprovação visual.
