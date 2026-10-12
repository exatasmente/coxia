# Integração: conferência antes do pull request (tentativa 2)

## Veredito
**Devolver ao implement**: a base ainda não foi trazida. A branch está 11 commits atrás de `origin/release/0.11.0` (e 11 à frente), e `git merge-tree` acusa conflito só em `CHANGELOG.md`; os demais arquivos mesclam sozinhos. Pedir que a base seja trazida pela ferramenta de conflito do app, mantendo o `CHANGELOG.md` da branch. Nada foi mesclado, rebaseado nem commitado pelo shell.

## Itens

1. **CHANGELOG: ok.** Uma linha "Talk to the persona by voice" em `[Unreleased]` > `### Added` (grep, 1 ocorrência).
2. **Esquema: ok.** `CONFIG_SCHEMA_VERSION = 34` na branch e em `origin/release/0.11.0`; `git diff` da branch contra a release não toca `src/shared/config`, então não há passo de migração novo. Pull requests abertos para a release: não verificado.
3. **Base: bloqueante.** `git rev-list --left-right --count HEAD...origin/release/0.11.0` = 11 / 11. Conflito em `CHANGELOG.md` (merge-tree). Resolução combinada: manter o arquivo da branch.
4. **Gates** (observados nesta etapa pelo app):
   - `npm run typecheck`: exit 0.
   - theme-audit, i18n:lint, public-audit, `electron-vite build`: não rodei nesta tentativa; a tentativa anterior os viu passar (relato, não verificado agora). Não repetidos depois da mesclagem da base.
5. **Nomes de módulo:** não conferi de novo; na tentativa anterior, nenhum arquivo novo colidia (relato).
6. **Base do pull request:** deve ser `release/0.11.0`, não a main. O PR ainda não existe.

## Não verificado
App com voz instalada, latência, celular, o modelo seguindo o prompt de voz, gates depois da mesclagem da base, pull requests abertos na release.

Comprovação: ev-6.

## Resultado dos cenários

- Base atualizada com a release aberta: falhou (executado na sandbox) — 11 à frente e 11 atrás de origin/release/0.11.0; merge-tree acusa conflito só em CHANGELOG.md.
- Esquema de configuração sem colisão: passou (executado na sandbox) — CONFIG_SCHEMA_VERSION 34 na branch e na release; a branch não altera src/shared/config. PRs abertos não listados.
- CHANGELOG tem a linha em Added: passou (executado na sandbox) — Uma ocorrência de 'Talk to the persona by voice' em CHANGELOG.md.
- Fluxo de voz no app, latência, celular: não rodou (lido) — Sem voz instalada nem aparelho; sem comprovação.
