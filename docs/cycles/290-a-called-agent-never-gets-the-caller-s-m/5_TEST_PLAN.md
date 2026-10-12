# Plano de testes: chamada entre agentes sem travar a etapa

Todos os cenários usam agentes e modelos de mentira, sem rede. Rodado nesta etapa: os 6 arquivos da área (46 testes, saída 0), `npx tsc --noEmit` (saída 0), `npm run i18n:lint` e `node scripts/public-audit.mjs` (saída 0). Não rodado: vitest completo e theme-audit (a revisão anterior registrou o completo verde, 9155 testes; o theme-audit lista 17 ocorrências fora do diff, sem comparação com a base).

A correspondência critério → teste vem de 2_PLAN.md e 3_IMPLEMENTATION.md; esta etapa não leu o corpo dos testes, só viu a suíte passar.

## Cenários

| # | Critério | O que fazer | O que esperar | Resultado | Evidência |
|---|---|---|---|---|---|
| 1 | 1 | Chamador chama chamado que escreve com assunto | O prompt do 1º turno contém o assunto | pass (suíte) | ev-2 |
| 2 | 2 | Chamado que escreve pede `AskConversation` no 1º turno, chamador aguardando | Volta na hora com aviso; a chamada não trava | pass (suíte) | ev-2 |
| 3 | 3 | Chamado responde sem pedir mais | Exatamente 1 turno e linha de encerramento | pass (suíte) | ev-2 |
| 4 | 4 | Conversa sem progresso até o limite | Termina com linha de sistema e `reason: stalled` | pass (suíte, nível da conversa) | ev-2 |
| 5 | 5 | Conversa travada e parada via `callStops` | Responde `true`, termina `stopped`; depois `false` | pass (suíte) | ev-2 |
| 6 | 6 | Mensagem seguinte do chamador | Chega na mesma sessão; conversa continua | pass (suíte) | ev-2 |
| 7 | 7 | Chamado que só lê; suítes existentes | Sem regressão | pass (6 arquivos) | ev-2 |
| 8 | 8 | Etapa com conversa travada expira no limite de ociosidade | Etapa expira | not-run: teste não existe | – |
| 9 | – | `CallAgent` devolve a mensagem de falta de progresso/parada ao chamador | Texto do catálogo | not-run: sem teste | – |
| 10 | – | Chave de `screenApi.stop(thread, agent)` bate com o registro em `callStops` | Parada pela tela acha a conversa | not-run: não conferido | – |
| 11 | gates | tsc, i18n:lint, public-audit | Saída 0 | pass | ev-1, ev-3 |

## Falhas

Nenhuma observada.

## Não verificado

- Critério 8 e a causa dos 70 minutos (segue hipótese; o limite sem progresso, metade da ociosidade, encerra a conversa antes).
- Mensagem de `stalled`/`stopped` devolvida por `CallAgent`.
- Parada pela tela (chave de `screenApi.stop`); nenhuma interface foi exercitada.
- Vitest completo e theme-audit nesta etapa; duplicadas no tracker.

## Resultado dos cenários

- Critérios 1 a 7: testes da área (assunto no prompt, aviso imediato, um turno, limite sem progresso, parada, mensagem seguinte, chamado que só lê): passou (executado na sandbox) — Os 6 arquivos da área rodaram: 46 testes passam, saída 0. A correspondência critério→teste vem dos documentos; os corpos dos testes não foram lidos por esta etapa.
- Gate de tipos e auditorias (tsc, i18n:lint, public-audit): passou (executado na sandbox) — tsc --noEmit saída 0; i18n:lint com 6416 chaves nos dois idiomas; public-audit limpo.
- Critério 8: relógio de ociosidade com conversa travada: não rodou (lido) — Não há teste de caracterização; a causa dos 70 minutos segue hipótese. O limite sem progresso encerra a conversa antes.
- CallAgent devolve a mensagem de stalled/stopped ao chamador: não rodou (lido) — Sem teste; as mensagens existem nos catálogos e a conversa é testada no nível de runConversation.
- Parada pela tela: chave de screenApi.stop contra callStops: não rodou (lido) — Não conferida; nenhuma interface exercitada.
