# Revisão: segunda rodada da entrega da mensagem ao chamado

Veredito: **mudanças**.

## Bloqueantes anteriores

1. Teste do aviso imediato (TS2352): tratado. `tsc --noEmit` passa.
2. Teste de tela com abort local: tratado, passa.
3. `activity-calls` com mensagem pendente: tratado, passa.
4. Teste de `callAgent`: escrito, mas **falha** (ver abaixo). A caracterização do relógio de ociosidade (critério 8) continua não escrita.

## O que foi verificado (rodado)

- `npm ci` e `npx tsc --noEmit`: passam.
- `vitest run` completo: 9153 passam, 2 falham. Uma falha é `test/runner-send-call.test.ts` (o teste novo). A outra foi um timeout de worker em `cycle-parity-novoice`, que passou ao rodar sozinho (não relacionada).
- `npm run i18n:lint` passa (6416 chaves). `node scripts/public-audit.mjs` passa.
- `theme-audit`: não rodado nesta rodada (o diff não toca o renderer).

## Bloqueantes

1. `test/runner-send-call.test.ts:221` e `src/main/runner/executor.ts:1134`: o teste espera dois turnos do chamado (duas conversas seguidas), mas recebe um. Causa lida: `chain.push(to)` nunca é desfeito, então a segunda chamada ao mesmo agente é recusada como ciclo (`callRefusal`), mesmo com a primeira conversa já encerrada e `forget()` feito. Resultado: o teste novo está vermelho e a nota do CHANGELOG ("the next `CallAgent` to it opens a new conversation") não é verdadeira para o chamado que escreve nem para o leitor. Ou o fim da conversa tira o chamado da cadeia (e o teste passa a valer), ou o teste e a nota mudam para o comportamento real. A causa do ciclo foi lida, não confirmada por execução isolada.

## Não bloqueantes

- Falta a caracterização do relógio de ociosidade (critério 8) e teste do retorno `stalled`/`stopped` por `callAgent`; a chave de `screenApi.stop` contra `callStops` não foi conferida. Seguem não verificados.
- Repositório público e regra de config: nada de nome ou segredo; sem campo novo de config; sem escrita nova fora da porta Actions.
