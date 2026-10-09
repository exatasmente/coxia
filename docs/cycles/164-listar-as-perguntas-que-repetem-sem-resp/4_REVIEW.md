# Revisão da repetição de perguntas sem resposta nos minutos

Revisão técnica contra 1_SPEC.md (critérios 1–6, regras 1–8) e 2_PLAN.md, feita por leitura do diff completo da branch e dos arquivos tocados. Nenhum comando foi rodado nesta etapa: os gates citados pela implementação (`tsc`, `vitest`, `i18n:lint`, `theme-audit`, `public-audit`) são o relato de 3_IMPLEMENTATION.md, não verificados nesta revisão; os critérios de aceite continuam sem sessão de interface.

## O que confere com a especificação

- Regra 1 (repetição só entre dias diferentes) e critério 3: `repeatedUnanswered` parte da lista do dia e ignora o dia corrente nas datas anteriores; teste dedicado em `test/minutes-repeat.test.ts` ("counts a repetition only between different days").
- Regra 2 e critério 1: pareamento por **ref + stage**, textos diferentes pareiam; testes cobrem pareamento com texto diverso e não-pareamento quando o estágio muda.
- Squad: `sameForm` exige o mesmo squad; teste de não-cruzamento entre squads presente.
- Regra 7 e critério 4: pergunta resolvida saída do merge não é contada; teste dedicado.
- Regra 5 e critério 2: lista vazia não renderiza seção na tela nem no documento (`repeated.length` condiciona os dois lados); teste de `writeDayFile` sem repetidas.
- Regra 8 e critério 5: índice mantém `version: 1`; leitura de índice antigo cai para o `covered` da mesma versão ou `null` (pareia pela atividade); teste de documento do dia anterior byte a byte idêntico após salvar hoje.
- Critério 6: chaves novas nos dois catálogos (`minutes.*` e `prompt.sdd.turn.crossDay`), e o teste de catálogos intencionais documenta a mudança de `turn.main`. Conteúdo tela/documento equivalente (pergunta, ref, datas, contagem de dias).
- Aviso à cerimônia: `prepareTurn` injeta `crossDay` no slot de `turn.main` e no fim de `earlierText` no caminho do mesmo dia; dois testes em `test/same-day.test.ts` verificam o texto no prompt, caminho de cartão novo e de mesmo dia.
- CHANGELOG em `## [Unreleased]`; nenhuma cor literal na tela; nenhum nome, host ou número real no que a mudança acrescenta (refs de teste usam `acme#1`/`web#101`, neutros).
- Limitação declarada e respeitada: caminho `reusableTurn` não leva a nota nesta rodada, como o plano diz.

## Achados

1. **Bloqueante** — `previousDayAnswers` promete saltar dias sem índice ou com índice corrompido, e o plano pedia um teste para isso; o teste escrito ("takes at most the 7 most recent days...") confirma só `<= 7` e datas anteriores, nunca que um dia sem índice é omitido (nem que `readIndex` não cria índice para dia vazio). O comportamento de salto é novo e fica sem teste.
2. Sugestão — `crossDayRepeats` pareia sem considerar squad; a definição de pareamento do plano diz que nunca cruza squads. Na prática refs de atividades distintas raramente colidem entre squads, e `Card` não carrega squad, mas o caso de colisão faria a cerimônia de um squad ouvir a repetição do outro.
3. Sugestão — a nota do `{crossDay}` entra no prompt de todo cartão cuja forma repetiu, mesmo que o turno não venha a perguntar nada (a pergunta só se sabe depois do modelo); o texto então fala de "esta decisão" sem pergunta associada. Ruído pequeno.
4. Sugestão — com `crossDay` vazio, o gabarito de `turn.main` rende uma linha em branco dupla entre `{specHint}` e "Monte/Build". Inofensivo, mas limpo seria condicionar o trecho.

## Veredito

Changes: um bloqueante (teste faltando para o salto de dia sem índice, item 1). Tratado o item 1, aprovado; os itens 2–4 são sugestões e não reabrem nesta rodada.

## Não verificado nesta revisão

- Nenhum critério de aceite exercitado na tela com o app rodando (sem sessão de interface nesta etapa; conferência da tela por leitura do render e do teste do `dayView`).
- Gates (`npx tsc --noEmit`, `npx vitest run`, `npm run i18n:lint`, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs`) e `electron-vite build`: não rodados nesta revisão; constam como passados em 3_IMPLEMENTATION.md.
- Os números da issue (127 na semana; 5–8 nos dias de exemplo) não foram reproduzidos neste ciclo.
