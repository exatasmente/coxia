# Plano de testes: etapa entregue a uma sessão do Claude Code (rodada 4, base nova)

## Resultado

Bloqueado. Com o ramo ainda 33 commits atrás de origin/release/0.11.0, `config-migrations` falha em 85 testes com "no migration from config schema 34" (ev-13): o STEPS do ramo não tem os passos 34 e 35 da release, e a versão alvo é 37. tsc passa (ev-13). Os outros 5 arquivos de teste rodados passam (ev-13). Nada além disso foi rodado nesta rodada.

## Comando rodado nesta etapa

1. Um único comando: `git log`, `git rev-list --count HEAD..origin/release/0.11.0` (resultado 33), `npx tsc --noEmit` (tsc=0) e `npx vitest run` em 6 arquivos (config-migrations, docs-schema-version, config-claude-code-persona, runner-claude-code-stage e outros da entrega). Resultado: 1 arquivo falhou, 5 passaram; 85 testes falharam, 53 passaram (ev-13).

## Cenários

| # | Cenário | Resultado |
|---|---|---|
| 1 | Base: o ramo contém a release 0.11.0? | Falhou: 33 commits atrás (ev-13). |
| 2 | Migração com os passos da release (`config-migrations`) | Falhou: 85 testes com "no migration from config schema 34"; STEPS sem 34/35 (ev-13). |
| 3 | tsc --noEmit | Passou, saída 0 (ev-13). |
| 4 | Testes da entrega (persona, estágio, tarefa, guarda, docs-schema-version) | 5 arquivos passaram; só `config-migrations` falhou (ev-13). O nome exato de cada arquivo está no comando, não na evidência salva; por isso só afirmo a contagem. |
| 5 | vitest completo, theme-audit, i18n:lint, public-audit, build | Não rodou nesta rodada. |
| 6 | Interface (campo Executor, botão da opção) | Não rodou. |
| 7 | SDK real (deny respeitado, structured_output) | Não verificado. |

## Não verificado

- Qualquer portão além de tsc e dos 6 arquivos, depois da base nova.
- Interface e SDK real.
- Se a mesclagem da base, com v37 e STEPS 34/35 + v36ToV37, faz `config-migrations` passar: ainda não feita.

## O que desbloqueia

Trazer origin/release/0.11.0 (pela ferramenta de conflito do app), manter v37 com STEPS 34/35 da release e 36: v36ToV37, refazer a linha do CHANGELOG, e rodar tudo de novo.

## Resultado dos cenários

- 1 Base: ramo contém a release 0.11.0: falhou (executado na sandbox) — git rev-list --count HEAD..origin/release/0.11.0 retornou 33: o ramo está atrás da release.
- 2 Migração com passos da release (config-migrations): falhou (executado na sandbox) — 85 testes falham com 'no migration from config schema 34'; STEPS sem 34/35 porque a base não foi trazida (causa lida na mensagem de erro).
- 3 tsc --noEmit: passou (executado na sandbox) — tsc=0 no mesmo comando.
- 4 Testes da entrega (persona, estágio, tarefa, guarda, docs-schema-version): passou (executado na sandbox) — Test Files: 1 failed | 5 passed (6); o único arquivo que falhou foi config-migrations (cenário 2). Os 5 arquivos restantes passaram.
- 5 vitest completo, theme-audit, i18n:lint, public-audit, build: não rodou (lido) — Não rodados nesta rodada.
- 6 Interface (campo Executor, botão da opção): não rodou (lido) — Nenhum app subido nesta rodada.
