# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (0_TRIAGE.md). Critério de repetição definido por quem abriu: "repetida" vale quando a mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia; texto idêntico não é exigido — o teste é a decisão recorrente, não a frase.
- 1_SPEC.md completa (refinamento, squad Experiência): seção "Perguntas repetidas sem resposta" nos minutos do dia (tela e documento), comparando com os últimos 7 dias com minutos; item mostra pergunta (texto mais recente), estágio, datas e contagem de dias; repetição vale só entre dias diferentes; dia sem repetição não mostra a seção; minutos antigos não são reescritos; pergunta respondida hoje não entra na lista de hoje.
- 2_PLAN.md completa (plano técnico): pareamento operacionalizado como **ref + stage** (sem modelo); snapshot ganha `stage: string | null` por pergunta sem resposta (índice continua `version: 1`, leitura antiga com fallback para `covered`, ref-only quando stage desconhecido); pareamento nunca cruza squads; seção vai como bloco de dia no fim do dia doc (o arquivo de versão fica intocado); aviso à cerimônia vai no prompt do turno (`turn.main` ganha slot `crossDay`; mesmo-dia via `earlierText`); reuso de turno de dia anterior (`reusableTurn`) não leva o aviso nesta rodada (limitação declarada).
- "Endereçar as recorrentes" decidido na spec: só visibilidade (lista com datas/contagem) mais aviso à rodada de perguntas do dia; ação corretiva fica com a pessoa, fora do escopo.
- Prioridade proposta: priority:medium (decide quem decide). Marco: nenhum.
- Resposta: **Esclarecimento** Critério adotado, com base no que verifiquei nos registros do app: "repetida" vale quando a **mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia** — texto idêntico não é exigido; o teste é a decisão recorrente, não a frase. O que os registros da semana mostram: - Nenhuma pergunta repetiu o texto exatamente. - Assuntos recorrentes reais: as 4 perguntas question-release-assemble de 04/10 (a série da #29/#52/#53 e a aprovação pedida para o PR #62 na release/0.6.1), os bloqueios de checkout duplo de release (o padrão da #190, … <!-- answer:8 -->

## Restrições

- Dados-base conferidos por leitura: instantâneo por versão em `src/shared/minutesVersions.ts` (`unanswered` sem stage hoje; `mergeDay` resolve o dia e já descarta perguntas resolvidas), índices `<date>-pre-daily.versions.json` em `src/main/minutesStore.ts`, `minutes:day` em `src/main/minutes.ts`, tela de dia em `src/renderer/src/screens/MinutesParts.tsx`, prompt do turno em `src/main/agents.ts` (`prepareTurn`) e `src/main/sameDay.ts`.
- `reusableTurn` (reuso de turno de dias anteriores) volta antes do prompt: a extensão do aviso lá ficaria para uma rodada futura.
- Números da issue (127; 5–8 em 06 e 07) vêm do relato de quem abriu, não verificados por este ciclo.
- Janela de 7 dias é decisão de spec proposta (não confirmada pela pessoa); posição da seção no documento gerado é decisão do plano, reversível na revisão.

## Tentado e descartado

- Detecção por semântica de modelo: descartada; pareamento é pelo estágio e assunto, sem chamada a modelo.
- Seção dentro de cada arquivo de versão: descartada — a repetição é fato do dia; o arquivo de versão (uma cerimônia) fica como está, atendendo ao critério de não reescrever histórico.

## Perguntas abertas

- Nenhuma bloqueante. A revisão pode mudar a janela de 7 dias ou a posição da seção no documento gerado.

## Onde o trabalho está

- Plano concluído; 2_PLAN.md na pasta do ciclo (mudanças por arquivo e função, ordem, um teste por comportamento, riscos e decisões). Próxima etapa: implementação (dev), seguindo o plano e os critérios de aceite de 1_SPEC.md; strings novas via t()/word() nos dois catálogos (minutes.*, main.*); CHANGELOG sob [Unreleased]; gates: tsc, vitest, i18n:lint, theme-audit, public-audit.
- Passagem support → product-owner: Refinamento do produto/Planejamento: o pedido é um feature request claro e custódio de dados já existentes (perguntas sem resposta por cerimônia/dia em src/shared/minutes.ts e src/shared/minutesVersions.ts). O critério de repetição já está definido pelo esclarecimento de quem abriu (mesma pergunta-forma: mesmo estágio e assunto, voltando em outro dia; texto idêntico não exigido). Pendências para o refinamento decidir: onde a lista aparece (tela de minutes/documento do dia ou outro lugar) e o que "endereçar as recorrentes" significa na prática (só listar, ou apontar ação). <!-- handoff:16 -->
- Passagem product-owner → pessoa: Implementação: cruzar as perguntas sem resposta guardadas por dia nos instantâneos dos minutos e mostrar a lista de repetidas nos minutos do dia (tela e documento), seguindo as regras e os critérios de aceite de 1_SPEC.md; strings novas nos dois catálogos via t(). Nenhum compromisso com janela de 7 dias: foi decisão de especificação, reversível na revisão. <!-- handoff:25 -->
