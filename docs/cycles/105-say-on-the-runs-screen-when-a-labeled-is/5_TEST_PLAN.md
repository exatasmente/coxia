# A lista de issues com rótulo e sem responsável na tela de execuções, e o início à mão de cada uma

## O que este plano cobre

A tela de execuções mostra, numa seção própria, as issues abertas do projeto que carregam o rótulo de gatilho e não têm ninguém assumido, cada uma com um controle de iniciar. O controle fica desabilitado quando a issue já virou execução, uma recusa ao iniciar aparece na tela com o motivo, e a seção some quando a lista está vazia. Nada inicia por si mesmo a partir dessa lista.

## Como foi conferido

Foi aberta uma janela do aplicativo sobre uma tela virtual, com uma pasta de dados descartável própria (nunca a de quem mantém). A tela de execuções foi conduzida e fotografada a cada passo. Para levar à tela exatamente os casos pedidos, a resposta que o processo principal daria foi substituída por uma resposta de teste com um item já em execução e um item sem execução; a mesma tela foi conduzida com a lista cheia, com a lista de um item já iniciado e com a lista vazia. Cada cenário abaixo diz o que foi visto na janela; o que foi apenas lido no código está marcado como lido.

## Cenários

### 1. Uma issue aberta, com o rótulo e sem responsável, aparece listada

- Resultado: passou (executado)
- O que se viu: na tela de execuções, a seção com o título próprio apareceu acima da lista de execuções, com o item da issue que o processo principal devolveria (a referência do cartão e o título), e nenhuma mensagem de erro.

### 2. Cada item listado tem um controle que inicia a execução

- Resultado: passou (executado)
- O que se viu: cada item da seção traz um botão de iniciar, habilitado; é o único controle do item.

### 3. Uma issue fechada com o rótulo e sem responsável não aparece

- Resultado: passou (lido)
- O que se viu: por leitura, a consulta exige a issue aberta, então uma issue fechada não entra na lista; o teste da consulta cobre o caso. Não foi exercitado numa janela.

### 4. Uma issue aberta com responsável não entra nessa parte da tela

- Resultado: passou (lido)
- O que se viu: por leitura, a consulta exige a lista de responsáveis vazia; o teste da consulta cobre o caso. Não foi exercitado numa janela.

### 5. Nada além do gesto de iniciar cria execução a partir da lista

- Resultado: passou (executado)
- O que se viu: abrir a tela e navegar até ela não disparou nenhuma chamada de iniciar (a lista de chamadas de iniciar estava vazia antes do clique); a chamada só apareceu depois do clique no botão do item.

### 6. A varredura automática se comporta como antes

- Resultado: passou (lido)
- O que se viu: por leitura, a fonte da varredura (as issues do rótulo atribuídas à pessoa) não foi tocada, e o teste confirma que ela não inicia uma issue sem responsável mesmo quando ela está na lista nova. Não foi exercitado numa janela.

### 7. Uma issue que já tem execução não pode ser iniciada de novo por acidente

- Resultado: passou (executado)
- O que se viu: com a lista contendo uma issue que já aparece entre as execuções da tela, o botão daquele item apareceu desabilitado, enquanto o botão do item novo continuou habilitado.

### 8. Uma recusa ao iniciar mostra o motivo na tela

- Resultado: passou (executado)
- O que se viu: ao usar o botão de um item cujo início o código de hospedagem recusa, a seção passou a mostrar a mensagem de recusa, marcada como alerta para quem usa leitor de tela, sem falhar em silêncio.

### 9. A seção se esconde quando a lista está vazia

- Resultado: passou (executado)
- O que se viu: com a lista vazia, a seção não foi renderizada e a tela de execuções seguiu normal, sem erro nem seção vazia. O mesmo foi visto no workspace descartável, cuja lista real veio vazia: a tela de execuções apareceu sem a seção.

### 10. A mudança é leitura e fica dentro da fronteira de segurança

- Resultado: passou (lido)
- O que se viu: por leitura, o canal novo é classificado como leitura aberta ao navegador pareado e não fica atrás do interruptor de efeitos externos; a mudança não acrescenta nenhuma escrita no host, e o iniciar continua sendo o caminho manual já existente. Os testes de política do navegador fixam os canais servidos e as leituras feitas ao provedor.

### 11. O controle de iniciar leva à execução criada

- Resultado: não executado (lido)
- O que se viu: por leitura, o mesmo manipulador que inicia a execução leva a tela à execução devolvida; não foi exercitado numa janela, porque o código de hospedagem do teste de interface recusa o início (é o mesmo caminho do cenário 8).

## Não verificado

- O fluxo visual num workspace com a pasta de navegadores e a tela virtual configuradas: a configuração em uso não as tem, então a janela testada não foi a que o prompt de QA descreve para testar interface. O comportamento da seção em si foi exercitado na janela, mas não por meio de uma sandbox de QA.
- O caminho real de leitura do provedor de código (a consulta ao host) não foi exercitado numa janela: a lista servida à tela foi a de teste. As consultas ao provedor estão cobertas pelos testes da mudança.
- A contagem de cenários executados que o relatório do app deriva de comandos não foi exercitada: a configuração desta execução não lista comandos e é o próprio aplicativo em execução que está sob teste, então nada foi medido por comando aqui.
- O tema escuro da seção não foi conferido; as capturas foram feitas no tema claro.
