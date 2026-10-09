# Exame dos saltos de liberação concluído: 37 saltos, só uma decisão da pessoa

O pedido era entender por que os passos de uma liberação acumulam o estado "pulado" (skipped) antes de a liberação ficar concluída. O exame olhou os registros das liberações citadas na issue e listou todos os passos pulados: 25 em uma liberação, 4 em outra e 8 na terceira — 37 no total.

## O que o exame encontrou

- A maior parte dos saltos não é uma escolha sobre o passo: é rastro mecânico. Quando uma etapa é repetida (portão aprovado de novo, devolução ao planejamento ou cancelamento da execução), as propostas pendentes da tentativa anterior são postas de lado em lote, em segundos, e ficam registradas como puladas.
- Passos recusados pelo próprio script de liberação (branch de liberação com checkout duplicado em outro diretório, tag já existente, tag fora da branch correta, registro de mudanças sem seção de versão) acabam com o mesmo estado "pulado" das decisões — não dá para distinguir recusa de escolha na lista.
- Das 37 ocorrências, apenas uma é uma decisão registrada da pessoa: aprovar pular uma espera de feedback.
- Nenhum portão foi pulado e nenhuma etapa terminou falhada nas três liberações.
- A conta da revisão da equipe na reunion da semana contou números diferentes (dezenas, 6 e 5). O exame adota a contagem do próprio registro (25, 4 e 8) e deixa a diferença registrada como achado, sem reconciliar as duas fontes.

## O que o padrão sugere mudar (a seguir, como pedidos próprios)

1. Gravar quem puxou cada salto no catálogo de ações — hoje isso depende de inferência do contexto.
2. Descartar as propostas da tentativa anterior no momento em que a etapa é repetida, em vez de deixá-las pendentes até um lote de descartes.
3. Dar às recusas do script um estado próprio (falha, com o motivo), separado do salto de decisão.
4. Tratar o caso que se repete nas três liberações: a branch de liberação com checkout em outro diretório de trabalho, que causou 9 das recusas — a própria mensagem de recusa explica o caminho para resolver.

## O que vale saber

- Nada mudou no produto nesta entrega nem na do exame: o resultado é um relatório de leitura, e qualquer mudança nas regras do fluxo nasce como pedido próprio, depois destes achados.
- O exame cobre apenas as três liberações citadas; saltos fora delas (assistente, conflitos, cartões de sugestão) ficam fora do escopo.
- O catálogo de ações não grava autor por salto, então "quem pulou" nas listas é inferência marcada, não certeza.
- Em uma das liberações, um envio necessário não aparece como realizado no registro e ainda assim a execução terminou concluída — ficou registrado como achado, sem atestar o que aconteceu.
