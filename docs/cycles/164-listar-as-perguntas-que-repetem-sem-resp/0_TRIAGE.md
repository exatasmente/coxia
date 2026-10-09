# Perguntas repetidas sem resposta entre cerimônias de dias diferentes

## Tipo
Pedido de funcionalidade. Não é bug: o comportamento descrito não é defeito de algo prometido; é uma visão nova que cruza as perguntas sem resposta de cerimônias de dias diferentes e aponta as que se repetem.

## Dá para entender como está
Sim, como pedido. A issue traz o problema (muitas perguntas ficam sem resposta nas ceremônias por voz), um exemplo com números (127 perguntas sem resposta na semana; de 5 a 8 sem resposta em cerimônias de 06 e 07 de outubro) e o que seria (comparar os dias de 06 e 07, listar as perguntas repetidas e endereçar as recorrentes). Não verificado: os números citados são fatos do ambiente de quem abriu; este trabalho não os reproduziu.

## Critério de repetição (esclarecido por quem abriu)
Submetido por quem abriu a issue: "repetida" vale quando a **mesma pergunta-forma (mesmo estágio e mesmo assunto) volta para decisão em outra execução, em outro dia** — texto idêntico não é exigido; o teste é a decisão recorrente, não a frase.

O que os registros da semana mostraram, segundo quem abriu (não verificado por este trabalho):
- Nenhuma pergunta repetiu o texto exatamente.
- Assuntos recorrentes reais: as 4 perguntas question-release-assemble de 04/10 (a série da #29/#52/#53 e a aprovação pedida para o PR #62 na release/0.6.1), os bloqueios de checkout duplo de release (o padrão da #190, aparecidos em três dias) e as perguntas de triagem sobre escopo (ex. a redução de escopo de 06/10).
- Os 127 da retro são estágios de pergunta que ficaram waiting no fim do dia; as cerimônias de 06 e 07 (5 a 8 sem resposta) dominam o total.
- Quem abriu indica que cortar o padrão da #190 e as dependências de triagem ataca a maior parte da recorrência.

## Como foi conferido no código

- Leitura de `src/shared/minutes.ts`: o app já identifica, por cerimônia, as perguntas que ficaram sem resposta e as grava nos minutos.
- Leitura de `src/shared/minutesVersions.ts`: cada pre-daily guarda um instantâneo do dia, com lista de perguntas sem resposta, e o arquivo já calcula o que mudou entre versões do mesmo dia (perguntas novas, resolvidas) e monta a visão do dia inteiro.

As telas de minutes e os textos de catálogo mostram perguntas sem resposta por dia, mas nada compara as perguntas sem resposta entre dias de datas diferentes nem aponta repetição. O pedido se apoia em dados que o app já guarda; a peça que falta é o cruzamento entre dias.

## O que falta

- Onde a lista aparece: dentro da tela de minutes/documento do dia, ou em outro lugar.
- O que "endereçar as recorrentes" significa na prática: só listar a repetição, ou sugerir ação (por exemplo, ajustar o roteiro das cerimônias para não repetir a pergunta; quem abriu já indicou os padrões #190 e as dependências de triagem como os de maior impacto).

(O critério de repetição, que antes estava aqui como pendência, ficou definido pelo esclarecimento acima.)

## Sugerido (não decisões)

- Prioridade sugerida: priority:medium — melhora o conteúdo das cerimônias sem bloquear nada hoje, apoiada em dados que já existem, e ataca a maior fonte de perguntas waiting identificada por quem abriu.
- Squad: experiencia; a saída é o que a pessoa vê nas telas e nos textos das cerimônias, não o runtime.

## Duplicadas e relacionadas

- Nenhuma duplicada identificada: não há outra issue aberta sobre listar perguntas sem resposta entre dias (lista das pastas de ciclos conferida; nada no rastreador local indica outra).
- Relacionadas citadas pelo esclarecimento, por causa comum de recorrência: a série das #29/#52/#53, o PR #62 e o padrão da #190. Não conferidas em detalhe por este trabalho.
- Relacionada por tema: o prompt dos retro prompts (catálogo de textos) já pede olhar "perguntas deixadas sem resposta"; a visão nova daria a esse aviso dados concretos.
