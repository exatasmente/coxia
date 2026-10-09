# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (0_TRIAGE.md). Critério de repetição definido por quem abriu: "repetida" vale quando a mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia; texto idêntico não é exigido — o teste é a decisão recorrente, não a frase.
- 1_SPEC.md completa (refinamento, squad Experiência): os minutos do dia ganham a seção "Perguntas repetidas sem resposta", comparando com os últimos 7 dias com minutos; item mostra pergunta (texto mais recente), estágio, datas e contagem de dias; repetição vale só entre dias diferentes; dia sem repetição não mostra a seção; minutos antigos não são reescritos; pergunta respondida hoje não entra na lista de hoje.
- "Endereçar as recorrentes" decidido na spec: só visibilidade (lista com datas/contagem) mais aviso à rodada de perguntas do dia de que a pergunta já voltou; ação corretiva (roteiro, prompt de triagem) fica com a pessoa e fora do escopo.
- Prioridade proposta: priority:medium (apoia-se em dados já guardados, melhora cerimônias sem bloquear nada; quem decide decide). Marco: nenhum proposto.
- Resposta: **Esclarecimento** Critério adotado, com base no que verifiquei nos registros do app: "repetida" vale quando a **mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia** — texto idêntico não é exigido; o teste é a decisão recorrente, não a frase. O que os registros da semana mostram: - Nenhuma pergunta repetiu o texto exatamente. - Assuntos recorrentes reais: as 4 perguntas question-release-assemble de 04/10 (a série da #29/#52/#53 e a aprovação pedida para o PR #62 na release/0.6.1), os bloqueios de checkout duplo de release (o padrão da #190, … <!-- answer:8 -->

## Restrições

- Nenhum código rodou neste repositório; comportamento conferido por leitura de src/shared/minutes.ts e src/shared/minutesVersions.ts: perguntas sem resposta são guardadas por cerimônia e instantâneo por dia, com diff apenas entre versões do mesmo dia; nada compara entre dias.
- Números da issue (127; 5–8 em 06 e 07 com cerimônias de 5 a 8 sem resposta) vêm do relato de quem abriu, não verificados por este ciclo.
- Janela de 7 dias é decisão de spec proposta (não confirmada pela pessoa).

## Tentado e descartado

- Detecção por semântica de modelo: descartada; pareamento é pelo estágio e assunto, sem chamada a modelo (fora do escopo da spec).

## Perguntas abertas

- Nenhuma bloqueante. A revisão da spec pode mudar a janela de 7 dias ou o aviso à cerimônia do dia.

## Onde o trabalho está

- Refinamento concluído; 1_SPEC.md completa na pasta do ciclo. Próxima etapa: implementação (dev), guiando-se pelas regras e pelos critérios de aceite da spec; strings novas via t() nos dois catálogos.
- Passagem support → product-owner: Refinamento do produto/Planejamento: o pedido é um feature request claro e custódio de dados já existentes (perguntas sem resposta por cerimônia/dia em src/shared/minutes.ts e src/shared/minutesVersions.ts). O critério de repetição já está definido pelo esclarecimento de quem abriu (mesma pergunta-forma: mesmo estágio e assunto, voltando em outro dia; texto idêntico não exigido). Pendências para o refinamento decidir: onde a lista aparece (tela de minutes/documento do dia ou outro lugar) e o que "endereçar as recorrentes" significa na prática (só listar, ou apontar ação). <!-- handoff:16 -->
