# Revisão: terceira rodada, a cadeia foi corrigida mas um teste de atividade ficou vermelho

Veredito: **mudanças**.

## Bloqueantes anteriores

1. `chain.push(to)` nunca desfeito (`executor.ts`): tratado. `forget()` retira o chamado da cadeia; `test/runner-send-call.test.ts` passa (segunda chamada abre conversa nova).
2. Teste de segunda chamada vermelho: tratado, passa.

## O que foi verificado (rodado)

- `npm ci` e `npx tsc --noEmit`: passam.
- `npm run i18n:lint` (6416 chaves nos dois idiomas) e `node scripts/public-audit.mjs`: passam.
- vitest nos arquivos da área (runner-send-call, runner-conversation, runner-conversation-stall, runner-conversation-screen, activity-calls, qa-conversation-commit): 45 passam, 1 falha.
- A falha se repetiu em duas execuções seguidas do arquivo: não é intermitente.

## Bloqueante

1. `test/activity-calls.test.ts:249` ("keeps one node for several rounds and an excerpt for each round that answered"): recebe `['started','started','finished']` no nó do chamado, esperava `['started','finished']`. O teste foi ajustado nesta entrega (passou a ter mensagem pendente para haver segunda rodada) e a segunda rodada agora usa `resume`; o evento extra de `started` aparece nesse segundo turno. Ou a retomada da sessão não deve abrir novo início no mesmo nó (código), ou a expectativa muda de forma justificada. A causa do segundo `started` não foi isolada; o fato novo é a falha reproduzida no diff desta rodada.

## Não bloqueantes (não verificados)

- Caracterização do relógio de ociosidade (critério 8), teste do retorno `stalled`/`stopped` por `callAgent` e a chave de `screenApi.stop` contra `callStops` seguem sem teste/conferência.
- Vitest completo e `theme-audit` não foram rodados nesta rodada.
- Repositório público: sem nome, host ou segredo; sem campo novo de config; nenhuma escrita nova fora da porta Actions.
