# Plano de testes: aprovações dos passos na tela

Cada critério de aceite virou um cenário. Nesta tentativa (nenhum código mudou desde a anterior) rodei de novo os 9 arquivos de teste da política: screen-step-approvals, browser-intermediary, browser-classify, browser-asks, prompts-screen, config-migrations, config-web-scope, config-transfer e agent-team. Resultado: 9 arquivos, 504 testes passando, saída 0 (ev-13). Os gates (tsc, i18n:lint, theme-audit, public-audit) e a linha do CHANGELOG foram conferidos na tentativa anterior (ev-7) e não foram repetidos agora. Nenhum cenário foi visto no app em execução.

## Cenários

| # | Critério | O que esperar | Resultado | Evidência |
|---|---|---|---|---|
| 1 | Sem configuração, "Enviar pagamento" pede aprovação | Retido | Passou (teste) | ev-13 |
| 2 | "nome do controle" liberado: "Salvar rascunho" roda e grava `screen-autonomous` com nível | Roda e registra | Passou (teste) | ev-13 |
| 3 | Liberado, "Pagar agora" segue pedindo, com aviso | Pergunta, marcado sensível | Passou (teste) | ev-13 |
| 4 | "Enviar mensagem", senha e cartão seguem retidos | Retidos, com aviso | Passou (teste); `autocomplete` de cartão não é lido (limite) | ev-13 |
| 5 | Liberar as quatro categorias é ignorado com aviso | Chave descartada | Passou (teste) | ev-13 |
| 6 | Precedência agente > squad > workspace > padrão | Conforme a spec | Passou (teste) | ev-13 |
| 7 | Grade com modo e origem por tipo | Seis linhas | Testes de renderização incluídos; visual não visto | ev-13 |
| 8 | Mudança vale na próxima etapa e é registrada | Registro `screen-policy` | Passou (teste) | ev-13 |
| 9 | Prompt segue a política | Frase só com tipo liberado | Passou (teste) | ev-13 |
| 10 | `screen_handoff` inalterado | Texto igual | Passou (teste) | ev-13 |
| 11 | Catálogos e CHANGELOG | 0 problemas | i18n limpo; linha em Unreleased lida (tentativa anterior, não repetido) | ev-7 |
| 12 | Gates | tsc, i18n, theme, public limpos | Passou na tentativa anterior; vitest completo e build não rodados por mim | ev-7 |
| 13 | Visual da grade e da janela de aprovação | Visual correto | Não executado: app não foi subido | n/a |
| 14 | Migração v32→v33 (esquema 33) | 33 atual, 34 recusado | Passou (teste config-migrations) | ev-13 |

## Não verificado

- Tela de configurações (agente, squad, workspace) e janela de aprovação no app.
- Suíte completa e `electron-vite build` nesta tentativa. A implementação relatou falha só nos 4 testes de navegador real (falta `@playwright/mcp`, não verificado se falham na base) e tempo esgotado de agent-assist-prompts (passa sozinho).
- Unificação com a #268 (`screen-autonomous`/`screen-policy` × `auto-step`/`policy-change`). Não liberar para produção sem a #268.
- Limites da heurística: Enter em campo neutro com botão "Pagar"; `autocomplete` de cartão.

## Resultado dos cenários

- 1-4 Padrão retido; liberado roda com registro; categorias sensíveis retidas: passou (executado na sandbox) — Testes do intermediário, classificador e asks passaram (504 no total, saída 0).
- 5-6 Liberação ignorada com aviso; precedência: passou (executado na sandbox) — Testes de resolução e sanitização passaram.
- 7 Grade mostra modo e origem (renderização): passou (executado na sandbox) — Só testes de renderização passaram; tela não vista no app.
- 8-10 Vigência, registro, prompt, screen_handoff: passou (executado na sandbox) — Testes de prompt, asks e migração passaram.
- 14 Migração v32→v33: passou (executado na sandbox) — config-migrations passou dentro dos 504.
- 13 Conferência visual no app: não rodou (lido) — O app não foi subido nesta tentativa; sem comprovação visual.
