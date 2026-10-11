# Plano de testes da agenda que acorda a persona

## Resultado
Lógica coberta por testes automáticos com fakes (44 de 44 passaram) e build ok (ev-2, ev-3). Interface não exercitada no app rodando.

## Cenários

| # | Critério | O que fazer / esperar | Resultado |
|---|---|---|---|
| 1 | Disparo recorrente sem sessão | Relógio e motor falsos: agendamento vence, a persona recebe o prompt com porta `schedule`, a resposta aparece na conversa. Esperado: dispara sem `resume`. | Passou, testes (ev-2) |
| 2 | Persona cria, pessoa remove | Persona cria na própria conversa, a pessoa vê e remove, a persona não encontra mais. | Passou, testes (ev-2) |
| 3 | Persistência após reinício | Nova instância do store relê `schedules.json` com o mesmo estado; arquivo ilegível é preservado. | Passou, testes (ev-2) |
| 4 | Pergunta de partida | Lógica `asksAtStart` e resposta "não" sem disparo: testadas. Diálogo na tela: não aberto. | Lógica passou (ev-2); tela não executada |
| 5 | Pausa e reativação | Pausado não dispara; reativado volta. | Passou, testes (ev-2) |
| 6 | Disparo perdido | Ao ligar, perdidos rodam uma vez, marcados como atrasados. Reabrir o app de verdade: não executado. | Passou nos testes (ev-2) |
| 7 | Falha do turno | Falha aparece na conversa, agendamento segue ativo. | Passou, testes (ev-2) |
| 8 | Aprovação pendente e auditoria | Só o carimbo `door: 'schedule'` na auditoria é testado; falta teste de integração com Actions. | Parcial |
| 9 | Gates | Testes da agenda e porta: 44/44. `electron-vite build`: saída 0 (ev-3). tsc, theme-audit, i18n, public-audit: relatados pela implementação, não repetidos aqui. | Passou |
| 10 | Tela Agendamentos no app (criar, pausar, remover, reabrir) | Abrir com pasta de dados vazia. | Não executado |

## Não verificado
- Tela e pergunta de partida em execução; reabertura do app.
- Horário de verão.
- Recusa de conversa de run na criação (sugestão da revisão, aberta).

## Resultado dos cenários

- 1 Disparo recorrente sem sessão: passou (executado na sandbox) — Testes de disparo com relógio e motor falsos passaram (44/44 no conjunto).
- 2 Persona cria, pessoa remove: passou (executado na sandbox) — Teste da porta real passou.
- 3 Persistência após reinício: passou (executado na sandbox) — Nova instância do store relê o estado; testado em arquivo, não no app reaberto.
- 5-7 Pausa, perdidos, falha: passou (executado na sandbox) — Cobertos por testes com fakes.
- Build electron-vite: passou (executado na sandbox) — Build terminou com saída 0.
- 4/10 Tela Agendamentos e pergunta de partida no app: não rodou (lido) — O app não foi aberto nesta etapa; sem comprovação visual.
- 8 Aprovação pendente num disparo: não rodou (lido) — Sem teste de integração com Actions; só o carimbo da porta é testado.
