# Integração: gates verdes, mas a branch tem conflito com a release

## Veredito

**Devolver ao implement**: trazer a base de `release/0.11.0` pela ferramenta de conflito do app (o PR #286 está com `hasConflicts: true`) e revisar o passo de migração depois disso. Não fazer merge, rebase nem commit pelo shell.

## Itens

1. **CHANGELOG: ok (lido).** `[Unreleased]` > `### Added` tem a linha "An agent's stages can show up in claude.ai/code and the Claude app, view only".
2. **Esquema: não verificado, bloqueante até a base ser trazida.** A branch tem `CONFIG_SCHEMA_VERSION = 35` (migração v34→v35, `src/shared/config/types.ts:7`). Não consegui ler `origin/release/0.11.0` nem os outros PRs abertos (a cópia do shell não tem `.git` e `vcs_read` não lista PRs). Como o PR conflita, a release pode ter avançado; se ela já tiver um passo v34→v35, renumerar o desta branch para o próximo número livre.
3. **Base: bloqueante.** `git fetch`/`rev-list` não rodaram (sem `.git` na cópia). O PR #286 reporta `hasConflicts: true`; `behind` vem nulo. Pedir a base pela ferramenta de conflito do app.
4. **Gates (rodados nesta etapa, ev-11):** `npx tsc --noEmit` saída 0; `npx vitest run` saída 0 (546 arquivos, 8944 passaram, 4 pulados); `node scripts/theme-audit.mjs` 0; `npm run i18n:lint` 0 problemas (6286 chaves); `node scripts/public-audit.mjs` 0; `npx electron-vite build` 0; `out/` apagado depois. Observação: o `npm test` do app antes desta etapa falhou em `test/public-audit.test.ts` só porque havia um `out/` de build antigo no worktree (bundle `elk` com "real-issue-number"); sem o `out/`, passou.
5. **Nomes de módulo: ok com ressalva.** Quatro pares na mesma pasta diferem por extensão (`TurnAsks.tsx`/`turnAsks.css`, `jobs.ts`/`jobs.css`, `activity.ts`/`activity.css`, `CeremonyCommands.tsx`/`ceremonyCommands.css`), todos em `src/renderer/src`. São .css contra .ts/.tsx, não têm relação com remote control; sem git não pude confirmar que já existiam na base. Não bloqueia.
6. **Base do PR: ok.** O PR #286 mira `release/0.11.0`, não a `main`. Porém título e descrição estão desatualizados (falam só da sondagem, "nenhum código mudou"); atualizar antes de revisar.

## Não verificado

Critérios 1 e 3 com a conta real, interface no app em execução, celular. Pendentes sem bloqueio: critérios 9 e 10, não abrir a ponte em motor que não é o do Claude, aviso citar envio do conteúdo a claude.ai.

## Resultado dos cenários

- Gates: tsc, vitest, theme-audit, i18n:lint, public-audit, build: passou (executado na sandbox) — Todos saíram 0 nesta etapa; vitest 546 arquivos, 8944 testes passaram; out/ apagado.
- CHANGELOG em Unreleased/Added: passou (lido) — Linha de Remote Control presente em [Unreleased] > Added.
- Esquema e base contra release/0.11.0: falhou (lido) — PR #286 hasConflicts=true; git indisponível na cópia, rev-list e comparação do passo v35 com a release não rodaram.
- Nomes de módulo e base do PR: passou (executado na sandbox) — Só pares .css/.ts preexistentes no renderer; PR mira release/0.11.0.
