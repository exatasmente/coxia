# Memória do ciclo

## Decisões

- Triagem concluiu: issue 170 é pedido de funcionalidade, compreensível como está; as alegações sobre o código existente (cofre de segredos global sem escopo, sandbox com ambiente vazio e rede off/proxy/open, shell de host sem confinamento, redação por padrão) conferem por leitura do código.
- Squad sugerido: plataforma; prioridade alta considerada razoável (sugestão só).

## Restrições

- Issue é especificação funcional; decisões de design (mais as do bloco "What the person must decide") são do refinamento, não da triagem.
- Diferença a reconciliar no refinamento com o modelo de pedidos de plugin: aqui o valor do segredo tem de chegar ao app testado, dentro de um ambiente que o próprio agente comanda.

## Tentado e descartado

- (nada)

## Perguntas abertas

- Nenhuma; as decisões abertas estão na issue para o refinamento.

## Onde o trabalho está

- 0_TRIAGE.md escrito; nenhuma pergunta à pessoa; comportamento não executado, apenas código lido. Próxima etapa: refinamento do produto.
