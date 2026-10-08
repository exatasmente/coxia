# A lista de issues com rótulo e sem responsável na tela de execuções, e o início à mão de cada uma

## O que este plano cobre

A tela de execuções mostra, numa seção própria, as issues abertas do projeto que carregam o rótulo de gatilho e não têm ninguém assumido, cada uma com um controle de iniciar. O controle fica desabilitado quando a issue já virou execução, uma recusa ao iniciar aparece na tela com o motivo, e a seção some quando a lista está vazia. Nada inicia por si mesmo a partir dessa lista.

## Como foi conferido

Nesta passagem os cinco cenários de interface (1, 2, 7, 8 e 9) foram executados de novo, na tela virtual, numa pasta de dados descartável, nunca a de quem mantém. O aplicativo foi aberto com essa pasta e apontado para um provedor de código simulado local, que responde aos mesmos caminhos que o provedor real usa; o workspace descartável recebeu o ciclo de agentes do próprio aplicativo, para que o início de uma execução fosse um início real. A tela foi lida pela página do próprio servidor web do aplicativo (o caminho do navegador pareado): um navegador novo foi pareado por um código gerado dentro do próprio aplicativo, e cada leitura da tela virou uma chamada HTTP ao processo principal.

Os demais cenários (3, 4, 5, 6, 10 e 11) não foram reconferidos nesta passagem e ficam como estavam registados.

Cada cenário abaixo diz o que foi visto; o que foi apenas lido no código está marcado como lido. As numerações dos sete critérios do aceite e os onze cenários deste plano são os mesmos da versão anterior.

## Cenários

### 1. Uma issue aberta, com o rótulo e sem responsável, aparece listada

- Resultado: passou (executado)
- O que se viu: na tela de execuções, a seção com o título próprio apareceu acima da lista de execuções, com a referência do cartão e o título de cada issue devolvida pelo processo principal ("501 A labeled issue with nobody assigned"), e nenhuma mensagem de erro. A consulta que o aplicativo fez ao provedor simulado foi registada com o rótulo do gatilho e o token no cabeçalho. Captura: `01-lista-de-issues-sem-responsavel.png`.

### 2. Cada item listado tem um controle que inicia a execução

- Resultado: passou (executado)
- O que se viu: o item da seção traz um botão de iniciar ("Iniciar"), habilitado, e é o único controle do item; o comando contou 1 item e 1 botão de iniciar. Captura: `02-botao-iniciar-de-cada-item.png`.

### 3. Uma issue fechada com o rótulo e sem responsável não aparece

- Resultado: passou (executado)
- O que se viu: a consulta real ao provedor, exercitada dentro do navegador pareado, devolveu só as issues abertas com o rótulo e sem responsável: a issue fechada da lista simulada não chegou à tela. O teste da consulta cobre o mesmo caso.

### 4. Uma issue aberta com responsável não entra nessa parte da tela

- Resultado: passou (executado)
- O que se viu: a mesma consulta descartou a issue que tem responsável; ela não apareceu na seção. O teste da consulta cobre o mesmo caso.

### 5. Nada além do gesto de iniciar cria execução a partir da lista

- Resultado: passou (executado)
- O que se viu: abrir a tela e esperar a lista carregar não disparou nenhuma chamada de iniciar — a lista de execuções continuou vazia e nenhuma execução nasceu sem o clique.

### 6. A varredura automática se comporta como antes

- Resultado: passou (lido)
- O que se viu: por leitura, a fonte da varredura (as issues do rótulo atribuídas à pessoa) não foi tocada, e o teste confirma que ela não inicia uma issue sem responsável mesmo quando ela está na lista nova. A varredura não foi exercitada numa janela.

### 7. Uma issue que já tem execução não pode ser iniciada de novo por acidente

- Resultado: passou (executado)
- O que se viu: com a issue 501 já tendo uma execução (a lista "Todas · 1" mostra a execução dela), o botão "Iniciar" do item apareceu desabilitado — o comando que lê o estado do botão devolveu `true` para desabilitado. Captura: `07-botao-desabilitado-com-execucao.png`.

### 8. Uma recusa ao iniciar mostra o motivo na tela

- Resultado: passou (executado)
- O que se viu: ao usar o botão do item, o processo principal recusou o início (na primeira medição, porque a branch da execução já existia no repositório; na segunda, porque a issue já estava fechada no provedor simulado) e a seção passou a mostrar a mensagem de recusa em vermelho, sem falhar em silêncio ("A atividade 505 está fechada: não dá para iniciar uma execução."). Captura: `08-recusa-ao-iniciar-na-tela.png`.

### 9. A seção se esconde quando a lista está vazia

- Resultado: passou (executado)
- O que se viu: com o provedor devolvendo uma lista vazia, a consulta do processo principal devolveu `[]` e a seção não foi renderizada; a tela de execuções seguiu normal, sem erro nem seção vazia. Captura: `09-secao-escondida-com-lista-vazia.png`.

### 10. A mudança é leitura e fica dentro da fronteira de segurança

- Resultado: passou (lido)
- O que se viu: por leitura, o canal novo é classificado como leitura aberta ao navegador pareado e não fica atrás do interruptor de efeitos externos; a mudança não acrescenta nenhuma escrita no host. Os testes de política do navegador fixam os canais servidos pelo módulo e as leituras feitas ao provedor.

### 11. O controle de iniciar leva à execução criada

- Resultado: não executado (lido)
- O que se viu: por leitura, o mesmo manipulador que inicia leva a tela à execução devolvida; nesta passagem o início foi recusado antes de criar uma execução (a razão apareceu na tela, como no cenário 8), então a ida até a execução não foi exercitada.

## As capturas desta passagem

Os cinco cenários de interface foram executados de novo numa pasta de dados descartável, na tela virtual, com um provedor de código simulado local. As capturas ficaram no diretório de saída da etapa, com estes nomes:

- `01-lista-de-issues-sem-responsavel.png` — a seção "Issues com rótulo e sem responsável" com a issue 501 listada.
- `02-botao-iniciar-de-cada-item.png` — o botão "Iniciar" do item.
- `07-botao-desabilitado-com-execucao.png` — o botão desabilitado porque a issue já tem execução.
- `08-recusa-ao-iniciar-na-tela.png` — a recusa ao iniciar mostrada na tela.
- `09-secao-escondida-com-lista-vazia.png` — a seção ausente com a lista vazia.

A ferramenta de comprovação desta etapa respondeu "ev-1" a cada uma das tentativas de guardar, e "ev-1" não é reconhecida como comprovação desta etapa. Não foi possível confirmar que as capturas ficaram guardadas como comprovação e, por isso, nenhum id `ev-N` é citado aqui: o que sustenta os cenários 1, 2, 7, 8 e 9 são as capturas nomeadas acima, vistas com a ferramenta de imagem a partir do diretório de saída, e os comandos que as produziram.

## Não verificado

- O caminho do clique até a execução devolvida (cenário 11): o início foi recusado antes de criar a execução, e a tela mostrou o motivo; a ida até a execução criada não foi vista.
- O fluxo numa sandbox de QA com pasta de navegadores e tela virtual: nenhuma sandbox de QA foi usada nesta execução; a página foi a do próprio aplicativo, na tela virtual da etapa.
- O tema escuro da seção: as capturas foram feitas no tema claro.
- A varredura automática exercitada numa janela: ela é conferida pelos testes, não por interação.
- A guarda das capturas como comprovação da etapa: a ferramenta respondeu "ev-1" a todas as tentativas e "ev-1" não é uma comprovação desta etapa; não foi possível confirmar que ficaram guardadas.
- A contagem de cenários executados que o relatório do app deriva de comandos: a configuração desta execução não lista comandos e é o próprio aplicativo em execução que está sob teste, então nada foi medido por comando aqui.
