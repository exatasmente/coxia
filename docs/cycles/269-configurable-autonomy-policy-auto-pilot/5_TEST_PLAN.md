# Plano de testes: aprovações dos passos na tela

Cada critério de aceite virou um cenário. Rodados nesta tentativa, depois da mescla com a release: 9 arquivos de teste (screen-step-approvals, browser-intermediary, browser-classify, browser-asks, prompts-screen, config-migrations, config-web-scope, config-transfer, agent-team), 504 testes passando (ev-6); tsc, i18n:lint, theme-audit e public-audit limpos e a linha do CHANGELOG presente (ev-7). Nenhum cenário foi visto no app em execução.

## Cenários

| # | Critério | O que esperar | Resultado | Evidência |
|---|---|---|---|---|
| 1 | Sem configuração, "Enviar pagamento" pede aprovação | Retido | Passou (teste) | ev-6 |
| 2 | "nome do controle" liberado: "Salvar rascunho" roda e grava `screen-autonomous` com nível | Roda e registra | Passou (teste) | ev-6 |
| 3 | Liberado, "Pagar agora" segue pedindo, com aviso | Pergunta, marcado sensível | Passou (teste) | ev-6 |
| 4 | "Enviar mensagem", senha e cartão seguem retidos | Retidos, com aviso | Passou (teste); `autocomplete` de cartão não é lido (limite) | ev-6 |
| 5 | Liberar as quatro categorias é ignorado com aviso | Chave descartada | Passou (teste) | ev-6 |
| 6 | Precedência agente > squad > workspace > padrão | Conforme a spec | Passou (teste) | ev-6 |
| 7 | Grade com modo e origem por tipo | Seis linhas | Testes de renderização incluídos nos arquivos de teste; visual não visto | ev-6 |
| 8 | Mudança vale na próxima etapa e é registrada | Registro `screen-policy` | Passou (teste) | ev-6 |
| 9 | Prompt segue a política | Frase só com tipo liberado | Passou (teste) | ev-6 |
| 10 | `screen_handoff` inalterado | Texto igual | Passou (teste) | ev-6 |
| 11 | Catálogos e CHANGELOG | 0 problemas | i18n limpo; linha em Unreleased lida | ev-7 |
| 12 | Gates | tsc, i18n, theme, public limpos | Passou; vitest completo e build não rodados nesta tentativa | ev-7 |
| 13 | Visual da grade e da janela de aprovação | Visual correto | Não executado | n/a |
| 14 | Migração v32→v33 (esquema 33) | 33 atual, 34 recusado | Passou (teste config-migrations) | ev-6 |

## Não verificado

- Tela de configurações (agente, squad, workspace) e janela de aprovação no app.
- Suíte completa e `electron-vite build` nesta tentativa (a implementação relatou: suíte com falha só nos 4 testes de navegador real, por falta de `@playwright/mcp`, e tempo esgotado de agent-assist-prompts).
- Unificação com a #268 (`screen-autonomous`/`screen-policy` × `auto-step`/`policy-change`). Não liberar para produção sem a #268.
- Limites da heurística: Enter em campo neutro com botão "Pagar"; `autocomplete` de cartão.

## Resultado dos cenários

- 1-4 Padrão retido; liberado roda com registro; categorias sensíveis seguem retidas: passou (executado na sandbox) — Testes do intermediário, classificador e asks passaram (parte dos 504).
- 5-6 Liberação ignorada com aviso; precedência: passou (executado na sandbox) — Testes de resolução e sanitização passaram.
- 7 Grade mostra modo e origem (renderização): passou (executado na sandbox) — Só testes de renderização; tela não vista no app.
- 8-10 Vigência, registro, prompt, screen_handoff: passou (executado na sandbox) — Testes de prompt, asks e migração passaram.
- 11-12 Gates e CHANGELOG: passou (executado na sandbox) — tsc saiu 0; i18n:lint, theme-audit e public-audit sem problemas na saída; linha no CHANGELOG. Suíte completa e build não rodados.
- 13 Conferência visual no app: não rodou (lido) — O app não foi subido; sem comprovação visual.
