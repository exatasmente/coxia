# Revisão, rodada 2: mescla da release e decisões da persona

Veredito: **aprovado**. Nenhum achado bloqueante.

## Bloqueantes da rodada anterior

A rodada 1 não deixou bloqueantes, só sugestões. Elas seguem como sugestões e não foram reabertas.

## O que foi conferido (leitura do código)

- `src/main/auditoria.ts` `recordWrite`: `chain` e `tampered` do chamador são descartados. O carimbo do ato da persona (`actor`, `door`, `id`, `said`, `basis`) vem só do ato aberto, e a máscara dele vale para alvo, campos e resultado. A cadeia é calculada sobre a linha já carimbada e mascarada, o que combina com a verificação de `listAudit`, que recalcula sobre o corpo lido. A resolução da mescla é coerente.
- `src/main/actions.ts` `recordDecision`: grava `by: 'persona'` quando há ato aberto e `PERSON_WHO.by` quando não há. Isso corrige o `by: 'person'` fixo que o teste da release apontou.
- `src/main/runner/service.ts` `gateBy`: a decisão da pessoa no portão grava `who.by`; a aprovação do app grava `auto-step` com a política. Conforme o plano.
- `src/renderer/src/auditModel.ts` `whoOf` e os testes novos: leitura do relato; o arquivo não foi reaberto nesta rodada.

## Sugestões (não bloqueiam)

1. `src/main/runner/service.ts:526`: `askCommand` ainda grava `by: 'person'` fixo. Se a persona puder responder a essa pergunta, a linha dirá que foi a pessoa. Usar `who.by` quando houver o caminho.
2. As da rodada 1 continuam: interruptores de agente e de squad sem `policy-change` (cobrir com a #269) e o limite de 64 KB em `lastChain`.

## Não verificado

- Não rodei tsc, vitest, build nem as auditorias. Os resultados citados vêm de 3_IMPLEMENTATION.md (ev-7). Os 4 testes de navegador falham por falta de `@playwright/mcp` no ambiente.
- Que a branch fica 0 commits atrás de `origin/release/0.11.0` depois do commit de merge do app.
- A tela do log não foi aberta no app.
- Não li o diff inteiro da mescla (160 commits da release); li só os pontos citados.
- A lista de passos autônomos não foi conferida contra o texto completo da spec, que veio truncado.
