# As imagens da documentação agora são tiradas do próprio aplicativo

## O que mudou

- O README e as páginas de documentação deixam de prometer capturas de tela e passam a mostrar imagens reais do aplicativo: a tela do dia, uma cerimônia em andamento, a fila de ações, o assistente de configuração e o celular pareado. Cada uma existe em português e em inglês.
- As imagens são tiradas de um espaço de trabalho fictício, criado na hora por um comando. Nenhuma pessoa, empresa, endereço ou número de atividade real aparece nelas.
- Duas execuções seguidas das capturas, neste computador, produziram os mesmos arquivos, byte a byte.
- Uma etapa de um ciclo pode pedir uma tela virtual, como a etapa de QA já recebe. Isso é opcional e vem desligado: os ciclos que já existem não mudam.
- O fluxo de release ganhou uma etapa que refaz as imagens antes de o corte ser pedido. O que mudou nas imagens aparece no pull request do release, para a pessoa revisar como qualquer outra mudança. O corte da versão continua como era e continua esperando o "sim".
- A conferência automática do projeto agora reprova uma imagem sem uso, um uso sem imagem e uma lista que não bate com a pasta.

## Como usar

1. Para refazer as imagens, crie o espaço de trabalho fictício numa pasta vazia, aponte o aplicativo para ela e rode o comando de captura. É preciso o aplicativo já construído, os navegadores instalados e um computador Linux.
2. Para uma etapa pedir tela, ligue o campo de tela na etapa do ciclo.
3. No release, a etapa nova roda sozinha na hora certa; confira as imagens alteradas no pull request.

## O que vale saber

- O comando se recusa a escrever numa pasta que já tem um espaço de trabalho, e nunca toca nos dados reais de quem usa o aplicativo.
- A captura só funciona em Linux. Em outro sistema, ela recusa e diz isso.
- Se as telas mudarem depois de a etapa do release rodar, a decisão de rodá-la de novo é da pessoa; do contrário, as imagens ficam como estão até o próximo release.
- Na imagem em inglês da cerimônia, o título e a pauta aparecem em português. Na imagem em inglês do assistente, a lista de passos pula o passo 3.
- Não foi verificado: uma etapa com tela rodar as capturas e guardar as imagens, um release de verdade refazer as imagens, e a igualdade byte a byte em outro computador.
