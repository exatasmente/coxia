# O painel de conflito sai da tela de desbloqueio

## Que tipo de issue é

Pedido de funcionalidade (enhancement). Não relata comportamento errado: pede que uma parte da tela de desbloqueio mude de lugar. A tela de desbloqueio existe para a conversa sobre um bloqueio e as saídas dele; hoje ela também hospeda a ferramenta de resolver conflito, e o pedido é que o bloqueio passe a apontar para essa ferramenta em vez de embuti-la. A própria issue se declara parte do item "o conflito sai da tela; o bloqueio aponta para ele" de um trabalho maior sobre o papel das cerimônias.

O comentário de quem abriu mantém o pedido e o encolhe: retirar o painel de conflito da tela de desbloqueio, deixar o bloqueio apontar para o botão que já existe na tela de Hoje, e levar junto os textos e a marca de lugar que ficarem órfãos. Segundo o mesmo comentário, a retirada não depende de migração de configuração.

## Dá para entender como está escrita

Dá. A issue aponta a evidência e o comentário de quem abriu fixa o escopo. Foi conferido apenas por leitura do código e dos documentos do ciclo; nada foi executado e nenhuma tela foi aberta, então a remoção em si não foi verificada. O que a leitura mostrou:

- A tela de desbloqueio hoje mostra uma seção com o botão de resolver conflito, dentro de uma condição de haver alguma requisição de merge em conflito do card, com os textos "... com conflito" e a nota que explica que a resolução é preparada numa cópia de trabalho e que nada é enviado sem confirmação.
- O mesmo botão já é oferecido em dois lugares da tela de Hoje: na linha da lista do que precisa de atenção, ao lado do item que descreve o bloqueio, e entre os botões de ação da linha de atividade do card.
- A marca de lugar que separa os pontos onde o botão aparece tem três valores; o valor reservado à tela de desbloqueio é usado somente por esse painel. Ou seja, ao retirar o painel ele fica sem uso.
- Os dois textos do painel existem nos dois catálogos de idioma e têm cópias espelhadas nos arquivos de catálogo usados pelos testes; a leitura desses textos só foi encontrada no painel da tela de desbloqueio.
- Nenhum teste verificado afirma que a tela de desbloqueio mostra o painel nem que a marca de lugar vale "tela de desbloqueio"; os testes vizinhos cobrem a origem do dado do conflito e o botão da tela de Hoje.

## Comportamento esperado, pelo que o pedido diz

Depois da mudança, a tela de desbloqueio deixa de mostrar o painel de conflito; quem quiser resolver o conflito chega ao botão que já existe na tela de Hoje, e a linha do bloqueio passa a apontar para lá. Não há alteração na forma como um conflito é resolvido em si, nem na detecção de qual requisição está em conflito.

O pedido se limita ao lugar do painel. A issue maior que o abriga prevê, além disso, que sinais de bloqueio que hoje vivem fora das cerimônias passem a chegar à conversa de desbloqueio; isso é outro item da série, irmão deste, e não faz parte desta retirada.

## O que falta

Nada que só quem abriu possa dizer. O relato traz a tela, a evidência e o escopo fechado no comentário. A origem do dado de conflito e o botão de Hoje foram lidos no código e batem com o que a issue descreve.

## Issues que parecem duplicadas ou relacionadas

Nenhuma duplicada. Relacionadas:

- A issue que abriga este pedido, sobre o papel das cerimônias: este pedido é o item "o conflito sai da tela" dela; o documento funcional daquela série nomeia exatamente este movimento, e o plano técnico dela declara que os itens de "tirar de dentro" não foram tocados, ou seja, nada foi antecipado aqui.
- A issue recente sobre o botão de resolver conflito nunca aparecer: trata da detecção de qual requisição está em conflito e dos pontos onde o botão aparece, e o plano dela decidiu não mexer na tela de desbloqueio nem no componente do botão. Aquela correção é anterior a esta retirada; se for feita antes, o painel ainda existe para ser retirado depois com o mesmo gesto.
- Os documentos daquela correção também descrevem, num roteiro de teste, que a tela de desbloqueio mostrava o painel; esse roteiro precisará ser ajustado quando o painel sair, mas é efeito de documentação, não uma issue à parte.

## Prioridade (sugestão)

Sugiro manter priority:low, como está. É uma retirada pequena, sem mudança de comportamento para quem usa o app além de onde o botão aparece, sem migração de configuração; o valor está no arrumado da série, não na urgência.

## Riscos que a retirada não resolve sozinha (para a próxima etapa conferir, não são decisão desta)

- Se algum controle de escrita externa estiver preso ao painel, ele sai junto com a ferramenta; a issue manda verificar isso. Na leitura, o botão de conflito apenas prepara a resolução e abre a tela do conflito, e a aprovação da escrita vive em outro fluxo; ainda assim, a etapa seguinte deve confirmar que nada de proteção de escrita fica órfão.
- Os textos que saírem dos catálogos têm cópias espelhadas nos arquivos usados pelos testes; o ajuste precisa acompanhar as duas pontas para os portões de idioma e de catálogo não quebrarem.
