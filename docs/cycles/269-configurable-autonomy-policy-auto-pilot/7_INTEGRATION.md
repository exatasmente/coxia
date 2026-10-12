# Integração: conferências antes do pull request

**Veredito: código pronto; um bloqueio fora do código.** O pull request #276 aponta para `release/0.9.1`. Por decisão do Neto, a release-alvo é `release/0.11.0` e a base do PR tem de ser ela. Não consigo redirecionar pelo host: só leio, e não há operação para trocar a base. Falta alguém trocar a base do #276. Não é caso de devolver ao implement.

## O que falta para liberar

1. Trocar a base do PR #276 para `release/0.11.0` (no GitHub: Edit ao lado do título, ou `gh pr edit 276 --base release/0.11.0`). Não foi feito por mim.
2. Depois da troca, conferir que o GitHub segue sem conflitos e com CI verde (só foi visto com a base antiga).

## Itens

| # | Item | Resultado | Evidência |
|---|---|---|---|
| 1 | CHANGELOG | OK na tentativa anterior: linha "Screen step approvals" em `[Unreleased]` › Added, com a condição da #268. Não refeito agora. | grep em `CHANGELOG.md` |
| 2 | Esquema | OK na tentativa anterior: `CONFIG_SCHEMA_VERSION = 33`, passo `32: v32ToV33` depois de `v31ToV32`; release na versão 32; sem passo repetido. PRs abertos para a release não foram listados. Não refeito agora. | ev-4 |
| 3 | Base | OK na tentativa anterior: 0 commits atrás de `origin/release/0.11.0` depois do fetch. Não refeito agora. | ev-4, ev-8 |
| 4 | Gates | Ver abaixo. | ev-9, ev-10, ev-11 |
| 5 | Nomes de módulo | OK na tentativa anterior: só pares preexistentes; a mudança não acrescenta nenhum. Não refeito agora. | git ls-files |
| 6 | Base do PR | **BLOQUEANTE.** PR #276 com base `release/0.9.1`; deve ser `release/0.11.0` (decisão do Neto). Não posso redirecionar. | ev-8 (vcs_read) |

## Gates

Observados nesta etapa (rodados pelo app):
- typecheck (`tsc --noEmit`): saída 0 (ev-9).
- suíte: 4 arquivos falham, 532 passam; 8808 testes passam, 2 falham, 15 ignorados (ev-10). Falham browser-contract, browser-runtime, browser-quit e browser-sites, com `Cannot find module @playwright/mcp` na cópia (ev-11). Não verifiquei se falham também na base: **não verificado**.

Da tentativa anterior (não repetidos agora): theme-audit, i18n:lint (6190 chaves, 0 problemas), public-audit e `electron-vite build` com saída 0; `agent-assist-prompts` sozinho: 36 passam.

## Não verificado

- As 2 falhas de `@playwright/mcp` na base.
- Tela de configurações e janela de aprovação vistas no app.
- Pull requests abertos para a release (só vi o #276).
- Que `release/0.11.0` é a release aberta no host (decisão do Neto, não conferida por mim).

## Condição de lançamento

Não ir à produção sem a #268; unificar `screen-autonomous`/`screen-policy` com `auto-step`/`policy-change` na mescla dela.

## Plano de teste / cenários

- Typecheck e suíte completa: rodados pelo app (ev-9, ev-10, ev-11). Só 4 arquivos de navegador falham por falta de @playwright/mcp; na base, não verificado.
- CHANGELOG, esquema, base, nomes de módulo, lints e build: conferidos na tentativa anterior (ev-4, ev-8); não repetidos nesta.

## Resultado dos cenários

- Base do PR é a release aberta: falhou (lido) — O PR #276 tem base release/0.9.1; deve ser release/0.11.0 (decisão do Neto). Não consigo trocar pelo host (só leitura). Visto por leitura (vcs_read), registrado em ev-8; não reconferido nesta tentativa.
- Typecheck e suíte completa: passou (lido) — tsc --noEmit saiu 0 (ev-9). Suíte: 8808 passam, 2 falham, 4 arquivos de navegador por falta de @playwright/mcp (ev-10, ev-11). Se também falham na base: não verificado. — afirmado como executado (como o app registrou)
- Base e esquema contra release/0.11.0: passou (lido) — 0 commits atrás de origin/release/0.11.0; CONFIG_SCHEMA_VERSION 33 com passo v32ToV33, sem passo repetido contra a release (versão 32). PRs abertos para a release não foram listados. — afirmado como executado (como o app registrou)
