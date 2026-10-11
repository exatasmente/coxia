# Plano de testes: aprovações dos passos na tela

Cada critério de aceite virou um cenário. Os cenários marcados como executados foram verificados rodando os testes automatizados do repositório (fakes, sem rede). Nenhum cenário foi visto no app em execução.

## Cenários

| # | Critério | O que fazer | O que esperar | Resultado | Evidência |
|---|---|---|---|---|---|
| 1 | Sem nada configurado, "Enviar pagamento" pede aprovação | Testes do intermediário sem política | Passo retido | Passou (teste) | ev-1 |
| 2 | Tipo "nome do controle" liberado: "Salvar rascunho" roda sem pedir e gera registro autônomo | Testes do intermediário e de asks | Roda, registro `screen-autonomous` com nível | Passou (teste) | ev-1 |
| 3 | Liberado, "Pagar agora" segue pedindo, com aviso | Idem | Pergunta, pedido marcado como sensível | Passou (teste) | ev-1 |
| 4 | "Enviar mensagem", campo de senha e de cartão seguem retidos | Testes de detecção e intermediário | Retidos, com aviso | Passou (teste); `autocomplete` de cartão não é lido (limite) | ev-1 |
| 5 | Liberar as quatro categorias na config é ignorado com aviso | Testes de sanitização e validação | Chave descartada, aviso | Passou (teste) | ev-1 |
| 6 | Precedência agente > squad > workspace > padrão, por tipo | Testes de resolução | Conforme a spec | Passou (teste) | ev-1 |
| 7 | Tela mostra modo e nível de origem para os seis tipos | Testes de renderização | Seis linhas, origem atualiza | Passou (teste); visual não visto | ev-1 |
| 8 | Mudança vale na próxima etapa e é registrada | Testes de chamada e de `saveConfig` | Chamada em curso mantém a política; registro `screen-policy` | Passou (teste) | ev-1 |
| 9 | Prompt diz o que a política manda; sem política, igual ao de hoje | Testes de prompt | Frase só com tipo liberado | Passou (teste) | ev-1 |
| 10 | `screen_handoff` inalterado | Testes de prompt | Texto igual | Passou (teste) | ev-1 |
| 11 | Catálogos en e pt-BR; CHANGELOG | `npm run i18n:lint`; leitura do CHANGELOG | 0 problemas | i18n passou; CHANGELOG não reconferido nesta etapa | ev-2 |
| 12 | Gates do AGENTS.md | tsc, vitest, theme-audit, i18n:lint, public-audit | Todos verdes | Parcial: quatro gates passaram; vitest completo com falhas de ambiente | ev-2, ev-3 |
| 13 | Aviso na janela de aprovação e grade nas configurações vistos no app | Subir o app | Visual correto | Não executado | n/a |

## Suíte completa

7833 testes passam, 15 ignorados. Falham 4 arquivos de navegador real (browser-contract, browser-quit, browser-runtime, browser-sites), por falta do módulo `@playwright/mcp` neste computador. Não foram rodados na base sem a mudança. As falhas intermitentes de `agent-assist-prompts` e `workspace-guard` relatadas na implementação não apareceram nesta rodada.

## Não verificado

- Tela de configurações (agente, squad, workspace) e janela de aprovação no app em execução.
- Os 4 testes de navegador real.
- `electron-vite build` (só rodou na revisão).
- Mescla com a #268: os registros `screen-autonomous`/`screen-policy` ainda precisam ser unificados com `auto-step`/`policy-change`. Não liberar para produção sem a #268.
- Limites da heurística de palavras: Enter em campo neutro com botão "Pagar"; `autocomplete` de cartão.

## Resultado dos cenários

- 1-4 Padrão retido; liberado roda com registro; categorias sensíveis seguem retidas: passou (executado na sandbox) — Testes do intermediário, classificador, detecção e asks (13 arquivos, 522 testes) passaram: sem política pede aprovação, 'Salvar rascunho' liberado roda com registro autônomo, pagamento, envio a pessoas, senha e cartão seguem retidos com aviso.
- 5-6 Liberação ignorada com aviso; precedência: passou (executado na sandbox) — Testes de sanitização, validação e resolução por tipo passaram.
- 7 Grade mostra modo e origem (testes de renderização): passou (executado na sandbox) — Testes de renderização passaram; a tela não foi vista no app.
- 8-10 Vigência por chamada, registro, prompt e screen_handoff: passou (executado na sandbox) — Testes de chamada, de saveConfig e de prompt passaram.
- 11-12 Gates do repositório: passou (executado na sandbox) — tsc, theme-audit, i18n:lint e public-audit saíram com 0. Suíte completa: 7833 passam; 4 arquivos de navegador real falham por falta de @playwright/mcp (ambiente).
- 13 Conferência visual da grade e da janela de aprovação: não rodou (lido) — O app não foi subido; sem comprovação visual. Só testes de renderização cobrem a tela.
