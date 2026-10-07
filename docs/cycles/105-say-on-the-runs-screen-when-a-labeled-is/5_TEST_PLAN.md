# A lista de issues com rótulo e sem responsável na tela de execuções, e o início à mão de cada uma

## O que este plano cobre

A tela de execuções mostra, numa seção própria, as issues abertas do projeto que carregam o rótulo de gatilho e não têm ninguém assumido, cada uma com um controle de iniciar. O controle fica desabilitado quando a issue já virou execução, uma recusa ao iniciar aparece na tela com o motivo, e a seção some quando a lista está vazia. Nada inicia por si mesmo a partir dessa lista.

## Como foi conferido

Uma janela do aplicativo foi aberta com a tela virtual deste computador, apontando para uma pasta de dados descartável (nunca a de quem mantém) e servida pela própria resposta do processo principal, que por sua vez leu um host de código simulado local. A tela de execuções foi conduzida e fotografada a cada passo, e cada chamada que a tela fez ao processo principal foi observada. Cada cenário abaixo diz o que foi visto na janela; o que foi apenas lido no código está marcado como lido.

## Cenários

### 1. Uma issue aberta, com o rótulo e sem responsável, aparece listada

- Resultado: passou (executado)
- O que se viu: na tela de execuções, a seção com o título próprio apareceu acima da lista de execuções, com a referência do cartão e o título de cada issue devolvida pelo processo principal, e nenhuma mensagem de erro.

### 2. Cada item listado tem um controle que inicia a execução

- Resultado: passou (executado)
- O que se viu: cada item da seção traz um botão de iniciar, habilitado, e é o único controle do item.

### 3. Uma issue fechada com o rótulo e sem responsável não aparece

- Resultado: passou (executado)
- O que se viu: a consulta real ao host de código, exercitada dentro da janela, devolveu só as issues abertas com o rótulo e sem responsável: a issue fechada da lista simulada não chegou à tela. O teste da consulta cobre o mesmo caso.

### 4. Uma issue aberta com responsável não entra nessa parte da tela

- Resultado: passou (executado)
- O que se viu: a mesma consulta descartou a issue que tem responsável; ela não apareceu na seção. O teste da consulta cobre o mesmo caso.

### 5. Nada além do gesto de iniciar cria execução a partir da lista

- Resultado: passou (executado)
- O que se viu: abrir a tela e esperar a lista carregar não disparou nenhuma chamada de iniciar (a lista de execuções continuou vazia); nenhuma execução nasceu sem o clique.

### 6. A varredura automática se comporta como antes

- Resultado: passou (lido)
- O que se viu: por leitura, a fonte da varredura (as issues do rótulo atribuídas à pessoa) não foi tocada, e o teste confirma que ela não inicia uma issue sem responsável mesmo quando ela está na lista nova. A varredura não foi exercitada numa janela.

### 7. Uma issue que já tem execução não pode ser iniciada de novo por acidente

- Resultado: passou (lido)
- O que se viu: por leitura, o botão é desabilitado para uma referência que já aparece entre as execuções da tela, e o caminho de iniciar recusa uma segunda execução sem confirmação; o teste cobre a recusa. Não foi exercitado numa janela nesta passagem.

### 8. Uma recusa ao iniciar mostra o motivo na tela

- Resultado: passou (executado)
- O que se viu: ao usar o botão de um item cujo início o processo principal recusou, a seção passou a mostrar a mensagem de recusa, marcada como alerta para quem usa leitor de tela, sem falhar em silêncio.

### 9. A seção se esconde quando a lista está vazia

- Resultado: passou (executado)
- O que se viu: com a lista vazia, a seção não foi renderizada e a tela de execuções seguiu normal, sem erro nem seção vazia.

### 10. A mudança é leitura e fica dentro da fronteira de segurança

- Resultado: passou (lido)
- O que se viu: por leitura, o canal novo é classificado como leitura aberta ao navegador pareado e não fica atrás do interruptor de efeitos externos; a mudança não acrescenta nenhuma escrita no host. Os testes de política do navegador fixam os canais servidos pelo módulo e as leituras feitas ao provedor.

### 11. O controle de iniciar leva à execução criada

- Resultado: não executado (lido)
- O que se viu: por leitura, o mesmo manipulador que inicia leva a tela à execução devolvida; nesta janela o início não chegou a criar uma execução (a razão da recusa apareceu na tela, como no cenário 8), então a ida até a execução não foi exercitada.

## Não verificado

- O caminho do clique até a execução devolvida (cenário 11): a janela usada recusou o início antes de criar a execução, e a tela mostrou o motivo; a ida até a execução criada não foi vista.
- O fluxo numa sandbox de QA com pasta de navegadores e tela virtual: nenhuma sandbox foi usada nesta execução; a janela foi a do próprio aplicativo, com a tela virtual deste computador e uma pasta de dados descartável.
- O tema escuro da seção: as capturas foram feitas no tema claro.
- A contagem de cenários executados que o relatório do app deriva de comandos: a configuração desta execução não lista comandos e é o próprio aplicativo em execução que está sob teste, então nada foi medido por comando aqui.
