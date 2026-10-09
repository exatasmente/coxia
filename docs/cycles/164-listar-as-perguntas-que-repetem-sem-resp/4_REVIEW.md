# Revisão da repetição de perguntas sem resposta nos minutos

Segunda rodada da revisão contra 1_SPEC.md e 2_PLAN.md. O veredito anterior foi **changes** com um único bloqueante: o teste de `previousDayAnswers` não provava que a leitura salta um dia que a pasta guarda sem índice, nem um dia com índice corrompido, nem que a leitura não cria índice para eles. Esta rodada confere só esse item; nada já aceito é reaberto, nem as três sugestões menores (squad em `crossDayRepeats`, nota do `{crossDay}` sem pergunta associada ao turno, linha em branco com a nota vazia) — declaradas no plano como para rodada futura.

## Confirmação do bloqueante

O teste novo em `test/minutes-store.test.ts` ("skips a day the folder holds without a day index and a day with a malformed one, and creates no index for them") monta exatamente os dois casos pedidos:

- um dia que a pasta segura só pelo arquivo antigo do dia, sem índice (`2026-09-29-pre-daily.md`, sem `versions.json`) — o teste confirma que o dia não entra no resultado de `previousDayAnswers` e que nenhum índice é criado para ele;
- um dia com `versions.json` corrompido (`'{ not json'`) — o teste confirma que o dia é omitido e que o arquivo corrompido é lido de volta intacto (nada é reescrito).

O código (`readIndex`, nunca `ensureDay`, com `continue` sobre índice ausente) comporta-se como o plano diz, e o RUN do arquivo confirmou: `npx vitest run test/minutes-store.test.ts` — 28 testes, todos passaram.

## Veredito

Aprovado. O bloqueante da primeira rodada está fechado pelo teste que a revisão pediu, com o comportamento de código conferido e o RUN tocando o teste. Sugestões 2–4 da rodada 1 permanecem não bloqueantes e aguardam rodada futura.

## Não verificado nesta revisão

- Nenhum critério de aceite foi exercitado na tela com o app rodando (sem sessão de interface em qualquer rodada do ciclo; conferido por leitura do render e pelo teste do `dayView`).
- Na revisão em si, só o arquivo do teste tocado é confirmado em RUN; os gates completos (`tsc`, suíte inteira, `i18n:lint`, `theme-audit`, `public-audit`) constam como passados em 3_IMPLEMENTATION.md e não foram rodados nesta revisão.
- Os números da issue (127 na semana; 5–8 nos dias de exemplo) não foram reproduzidos neste ciclo.
