# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (0_TRIAGE.md). Critério de repetição definido por quem abriu: "repetida" vale quando a mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia; texto idêntico não é exigido — o teste é a decisão recorrente, não a frase.
- 1_SPEC.md completa: seção "Perguntas repetidas sem resposta" nos minutos do dia (tela e documento), janela dos últimos 7 dias com minutos; item mostra pergunta (texto mais recente), estágio, datas e contagem de dias; repetição vale só entre dias diferentes; dia sem repetição não mostra a seção; minutos antigos não são reescritos; pergunta respondida hoje não entra na lista de hoje.
- 2_PLAN.md completa: pareamento operacionalizado como **ref + stage** (sem modelo); snapshot ganha `stage: string | null` por pergunta sem resposta (índice continua `version: 1`); pareamento nunca cruza squads; seção como bloco de dia no fim do dia doc; aviso à cerimônia no prompt do turno (`turn.main` ganha slot `{crossDay}`; mesmo-dia via `earlierText`); reuso de turno de dia anterior (`reusableTurn`) não leva o aviso nesta rodada (limitação declarada).
- Implementação concluída (3_IMPLEMENTATION.md): conforme o plano — `repeatedUnanswered` puro em `src/shared/minutesVersions.ts`; `previousDayAnswers`/`dayRepeats`/`crossDayRepeats` em `src/main/minutesStore.ts` (`readIndex`, nunca `ensureDay`); seção no `writeDayFile` ao nível do dia, só com repetidas; bloco do dia na tela em MinutesParts.tsx; nota cruzada no `prepareTurn` via `{crossDay}`/`earlierText`; catálogos minutes.pt-BR/minutes.en + turn.main nos dois idiomas. O `covered` da versão faz o fallback de estágio em índices antigos.
- "Endereçar as recorrentes" decidido na spec: só visibilidade (lista com datas/contagem) mais aviso à rodada de perguntas do dia; ação corretiva fica com a pessoa, fora do escopo.
- Prioridade proposta: priority:medium (decide quem decide). Marco: nenhum.
- Resposta: **Esclarecimento** Critério adotado, com base no que verifiquei nos registros do app: "repetida" vale quando a **mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia** — texto idêntico não é exigido; o teste é a decisão recorrente, não a frase. O que os registros da semana mostram: - Nenhuma pergunta repetiu o texto exatamente. - Assuntos recorrentes reais: as 4 perguntas question-release-assemble de 04/10 (a série da #29/#52/#53 e a aprovação pedida para o PR #62 na release/0.6.1), os bloqueios de checkout duplo de release (o padrão da #190, … <!-- answer:8 -->

## Restrições

- `reusableTurn` volta antes do prompt: a extensão do aviso lá ficaria para uma rodada futura.
- Números da issue (127; 5–8 em 06 e 07) vêm do relato de quem abriu, não verificados por este ciclo.
- Janela de 7 dias é decisão de spec (reversível na revisão); posição da seção no documento gerado é decisão do plano, reversível na revisão.
- Os critérios de aceite de tela não foram exercitados com o app rodando (sem sessão interativa de interface nesta etapa); o comportamento foi conferido pelos testes de dados, typecheck e theme-audit.

## Tentado e descartado

- Detecção por semântica de modelo: descartada; pareamento é pelo estágio e assunto, sem chamada a modelo.
- Seção dentro de cada arquivo de versão: descartada — a repetição é fato do dia; o arquivo de versão (uma cerimônia) fica como está, atendendo ao critério de não reescrever histórico.

## Perguntas abertas

- Nenhuma bloqueante. A revisão pode mudar a janela de 7 dias ou a posição da seção no documento gerado.

## Onde o trabalho está

- Implementação concluída e gates rodados nesta tentativa: `npx tsc --noEmit` (0 erros), `npx vitest run` (312 arquivos, 4899 testes passando), `npm run i18n:lint` (4809 chaves nos dois idiomas), `node scripts/theme-audit.mjs` e `node scripts/public-audit.mjs` — todos passaram. `electron-vite build` pertence ao CI, não rodado aqui.
- Testes novos: test/minutes-repeat.test.ts (núcleo puro), extensões em minutes-versions, minutes-store, same-day e gitlab-catalogs-unchanged (motivo do `{crossDay}` nos dois catálogos).
- Próxima etapa: revisão/QA, contra 1_SPEC.md (critérios 1–6) e 3_IMPLEMENTATION.md. Pendência declarada: sessão interativa da tela dos minutos não foi feita; números da issue não reproduzidos.
- Passagem support → product-owner: Refinamento do produto/Planejamento: o pedido é um feature request claro e custódio de dados já existentes (perguntas sem resposta por cerimônia/dia em src/shared/minutes.ts e src/shared/minutesVersions.ts). O critério de repetição já está definido pelo esclarecimento de quem abriu (mesma pergunta-forma: mesmo estágio e assunto, voltando em outro dia; texto idêntico não exigido). Pendências para o refinamento decidir: onde a lista aparece (tela de minutes/documento do dia ou outro lugar) e o que "endereçar as recorrentes" significa na prática (só listar, ou apontar ação). <!-- handoff:16 -->
- Passagem product-owner → pessoa: Implementação: cruzar as perguntas sem resposta guardadas por dia nos instantâneos dos minutos e mostrar a lista de repetidas nos minutos do dia (tela e documento), seguindo as regras e os critérios de aceite de 1_SPEC.md; strings novas nos dois catálogos via t(). Nenhum compromisso com janela de 7 dias: foi decisão de especificação, reversível na revisão. <!-- handoff:25 -->
- Passagem tl-experiencia → pessoa: Implementação (dev): seguir 2_PLAN.md na ordem (minutesVersions.ts → minutesStore.ts → tela + catálogos → aviso ao prompt do turno → CHANGELOG), com um teste por comportamento listado no plano e os critérios de aceite de 1_SPEC.md como alvo; gates: npx tsc --noEmit, npx vitest run, npm run i18n:lint, node scripts/theme-audit.mjs e node scripts/public-audit.mjs. Lembrete: workerVoice (.novoice) deve continuar funcionando, e reuso de turno de dia anterior (reusableTurn) não leva o aviso nesta rodada — limitação declarada no plano. <!-- handoff:38 -->
