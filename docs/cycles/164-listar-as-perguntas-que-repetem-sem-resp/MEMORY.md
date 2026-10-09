# Memória do ciclo

## Decisões

- Resposta: **Esclarecimento** Critério de repetição fechado por quem abriu a issue: "repetida" vale quando a **mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia** — texto idêntico não é exigido; o teste é a decisão recorrente, não a frase.
- Contexto dos dados (relato de quem abriu, não verificado): nenhuma pergunta repetiu o texto exatamente; assuntos recorrentes reais são as 4 perguntas question-release-assemble de 04/10 (série da #29/#52/#53 e aprovação do PR #62 na release/0.6.1), os bloqueios de checkout duplo de release (padrão da #190, em três dias) e as perguntas de triagem sobre escopo (ex. redução de escopo de 06/10). Os 127 da retro = estágios de pergunta waiting no fim do dia (06 e 07, com 5 a 8 sem resposta, dominam o total); cortar o padrão da #190 e as dependências de triagem ataca a maior parte da recorrência.
- Triagem fechada: pedido de funcionalidade, entendível como escrita. Triage salvo em 0_TRIAGE.md com o critério incorporado.
- Resposta: **Esclarecimento** Critério adotado, com base no que verifiquei nos registros do app: "repetida" vale quando a **mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia** — texto idêntico não é exigido; o teste é a decisão recorrente, não a frase. O que os registros da semana mostram: - Nenhuma pergunta repetiu o texto exatamente. - Assuntos recorrentes reais: as 4 perguntas question-release-assemble de 04/10 (a série da #29/#52/#53 e a aprovação pedida para o PR #62 na release/0.6.1), os bloqueios de checkout duplo de release (o padrão da #190, … <!-- answer:8 -->

## Restrições

- Nenhum código ROda neste repositório de desenvolvimento durante a triagem; o comportamento foi conferido por leitura (src/shared/minutes.ts, src/shared/minutesVersions.ts: o app já guarda perguntas sem resposta por cerimônia e por dia, com diff entre versões do mesmo dia, mas nada compara entre dias).
- Números da issue (127; 5–8 em 06 e 07) vêm dos registros de quem abriu, não verificados por este ciclo.

## Tentado e descartado

- Nada descartado.

## Perguntas abertas

- Onde a lista de repetidas aparece (tela de minutes/documento do dia ou outro lugar).
- O que "endereçar as recorrentes" significa na prática: só listar, ou apontar ação.

## Onde o trabalho está

- Triagem concluída; 0_TRIAGE.md completo na pasta do ciclo. Próxima etapa: refinamento do produto. Squad sugerido: experiencia; prioridade sugerida: priority:medium (como sugestões, quem decide decide).
