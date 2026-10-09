# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (0_TRIAGE.md). Critério de repetição definido por quem abriu: "repetida" vale quando a mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia; texto idêntico não é exigido — o teste é a decisão recorrente, não a frase.
- 1_SPEC.md completa: seção "Perguntas repetidas sem resposta" nos minutos do dia (tela e documento), janela dos últimos 7 dias com minutos; item mostra pergunta (texto mais recente), estágio, datas e contagem de dias; repetição vale só entre dias diferentes; dia sem repetição não mostra a seção; minutos antigos não são reescritos; pergunta respondida hoje não entra na lista de hoje.
- 2_PLAN.md completa: pareamento operacionalizado como **ref + stage** (sem modelo); snapshot ganha `stage: string | null` por pergunta sem resposta (índice continua `version: 1`); pareamento nunca cruza squads; seção como bloco de dia no fim do dia doc; aviso à cerimônia no prompt do turno (`turn.main` ganha slot `{crossDay}`; mesmo-dia via `earlierText`); reuso de turno de dia anterior (`reusableTurn`) não leva o aviso nesta rodada (limitação declarada).
- Implementação concluída (3_IMPLEMENTATION.md): `repeatedUnanswered` puro em `src/shared/minutesVersions.ts`; `previousDayAnswers`/`dayRepeats`/`crossDayRepeats` em `src/main/minutesStore.ts` (`readIndex`, nunca `ensureDay`); seção no `writeDayFile` ao nível do dia; bloco do dia na tela em MinutesParts.tsx; nota cruzada no `prepareTurn` via `{crossDay}`/`earlierText`; catálogos minutes.pt-BR/minutes.en + turn.main nos dois idiomas; CHANGELOG. O `covered` da versão faz o fallback de estágio em índices antigos. Bloqueante da revisão fechado em 2026-10-09: teste novo em `test/minutes-store.test.ts` prova que `previousDayAnswers` omite o dia que a pasta segura sem índice e o dia com índice corrompido, sem criar índice.
- "Endereçar as recorrentes" decidido na spec: só visibilidade (lista com datas/contagem) mais aviso à rodada de perguntas do dia; ação corretiva fica com a pessoa, fora do escopo.
- Prioridade: priority:medium. Marco: nenhum.
- Resposta: **Esclarecimento** Critério adotado, com base no que verifiquei nos registros do app: "repetida" vale quando a **mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia** — texto idêntico não é exigido; o teste é a decisão recorrente, não a frase. O que os registros da semana mostram: - Nenhuma pergunta repetiu o texto exatamente. - Assuntos recorrentes reais: as 4 perguntas question-release-assemble de 04/10 (a série da #29/#52/#53 e a aprovação pedida para o PR #62 na release/0.6.1), os bloqueios de checkout duplo de release (o padrão da #190, … <!-- answer:8 -->

## Restrições

- `reusableTurn` volta antes do prompt: a extensão do aviso lá ficaria para uma rodada futura.
- Números da issue (127; 5–8 em 06 e 07) vêm do relato de quem abriu, não verificados por este ciclo.
- Janela de 7 dias é decisão de spec (reversível); posição da seção no documento gerado (fim do arquivo do dia) é decisão do plano, reversível.

## Tentado e descartado

- Detecção por semântica de modelo: descartada; pareamento é pelo estágio e assunto, sem chamada a modelo.
- Seção dentro de cada arquivo de versão: descartado — a repetição é fato do dia; o arquivo de versão fica como está.

## Perguntas abertas

- Nenhuma bloqueante.

## Onde o trabalho está

- Revisão (4_REVIEW.md): veredito **changes** por um bloqueante — teste de `previousDayAnswers` sem cobrir o salto de dia sem índice. Tratado em 2026-10-09: teste novo em `test/minutes-store.test.ts` cobre o salto (dia só com o arquivo antigo do dia, dia com `versions.json` corrompido) e a não-criação de índice; `npx vitest run test/minutes-store.test.ts` (28 testes) e `npx tsc --noEmit` passaram na tentativa. Próxima etapa: revisão confere só esse item, sem reabrir o aceito.
- Sugestões da revisão não tratadas (não bloqueiam, para rodada futura): `crossDayRepeats` pareia sem conferir squad; a nota `{crossDay}` entra no prompt mesmo quando o turno não perguntará nada; `crossDay` vazio rende linha em branco dupla no template de `turn.main`.
- Gates completos da implementação (relato de 3_IMPLEMENTATION.md, tentativa da retomada): `npx tsc --noEmit`, `npx vitest run` (312 arquivos, 4899 testes), `npm run i18n:lint` (4809 chaves), `node scripts/theme-audit.mjs` e `node scripts/public-audit.mjs` — passaram. A tentativa do teste novo rodou só o arquivo de teste e o typecheck. `electron-vite build` é do CI, não rodado.
- Critérios de aceite de tela não exercitados com o app rodando (nenhuma sessão de interface no ciclo); conferidos por leitura do render e pelos dados do `dayView`.
- Passagens históricas: support → product-owner (feature request, critério definido por quem abriu); product-owner → pessoa (implementar conforme 1_SPEC.md, strings via t()); tl-experiencia → pessoa (ordem de 2_PLAN.md, testes por comportamento, gates, .novoice funcional); revisão → dev-experiencia (bloqueante do teste de `previousDayAnswers`, tratado).
- Passagem support → product-owner: Refinamento do produto/Planejamento: o pedido é um feature request claro e custódio de dados já existentes (perguntas sem resposta por cerimônia/dia em src/shared/minutes.ts e src/shared/minutesVersions.ts). O critério de repetição já está definido pelo esclarecimento de quem abriu (mesma pergunta-forma: mesmo estágio e assunto, voltando em outro dia; texto idêntico não exigido). Pendências para o refinamento decidir: onde a lista aparece (tela de minutes/documento do dia ou outro lugar) e o que "endereçar as recorrentes" significa na prática (só listar, ou apontar ação). <!-- handoff:16 -->
- Passagem product-owner → pessoa: Implementação: cruzar as perguntas sem resposta guardadas por dia nos instantâneos dos minutos e mostrar a lista de repetidas nos minutos do dia (tela e documento), seguindo as regras e os critérios de aceite de 1_SPEC.md; strings novas nos dois catálogos via t(). Nenhum compromisso com janela de 7 dias: foi decisão de especificação, reversível na revisão. <!-- handoff:25 -->
- Passagem tl-experiencia → pessoa: Implementação (dev): seguir 2_PLAN.md na ordem (minutesVersions.ts → minutesStore.ts → tela + catálogos → aviso ao prompt do turno → CHANGELOG), com um teste por comportamento listado no plano e os critérios de aceite de 1_SPEC.md como alvo; gates: npx tsc --noEmit, npx vitest run, npm run i18n:lint, node scripts/theme-audit.mjs e node scripts/public-audit.mjs. Lembrete: workerVoice (.novoice) deve continuar funcionando, e reuso de turno de dia anterior (reusableTurn) não leva o aviso nesta rodada — limitação declarada no plano. <!-- handoff:38 -->
- Passagem tl-experiencia → dev-experiencia: Revisão concluída por leitura do diff completo contra 1_SPEC.md e 2_PLAN.md (nenhum comando rodado nesta etapa). O pareamento por ref+estágio, a exclusão de repetições no mesmo dia, o squad, a pergunta resolvida, os catálogos nos dois idiomas, o aviso ao prompt do turno, a não-rewrita de dias antigos e o CHANGELOG conferem com a especificação e o plano. Um bloqueante: o teste de `previousDayAnswers` não prova que salta dias sem índice nem que não cria índice (comportamento novo do plano, sem teste). Três sugestões menores (squad não conferido na nota da ceramônia, nota disparada mesmo sem perg… <!-- handoff:93 -->
