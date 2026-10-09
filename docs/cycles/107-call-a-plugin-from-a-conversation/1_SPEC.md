# Uma conversa pede a um plugin e a resposta volta ali mesmo

## O que muda para quem usa

Hoje um plugin só trabalha nos quatro momentos do ciclo de uma execução, e mensagem ou menção de conversa nunca chega a um. Depois desta mudança, uma pergunta escrita numa conversa — por uma pessoa ou por um agente — alcança o plugin escolhido e a resposta volta ali mesmo: na mesma conversa, entre as marcas de material, junto das fontes, e nunca escrita como ordem a quem lê.

A chamada tem forma própria e fixa: uma mensagem que começa com barra e traz o nome do comando é comando para o plugin, e o `@` continua nomeando agente da equipe. As duas leituras não se misturam — uma mensagem é uma coisa ou a outra, jamais as duas.

Na prática troca-se esperar o fim da etapa por perguntar na hora. A busca na web é o primeiro plugin a ganhar isso e passa também a responder dentro da conversa, mantendo o caminho que já usa no fim da etapa. Quando a conversa é a de uma execução, a resposta não fica só na conversa: o mesmo texto também é gravado como documento na pasta do ciclo daquela execução.

O que muda na permissão é quem pode dizer sim: o pedido que essa chamada abrir pode ser permitido também a partir do telefone pareado, e não só a partir do computador — hoje só o computador permite; recusar o pedido e bloquear a escrita já cabem aos dois. O resto do combinado fica como está: rede e escrita continuam virando pedido em Ações, e a pasta de teste não libera nada.

## As regras

1. Toda chamada leva ao plugin o que foi pedido, a conversa onde foi feita e, quando essa conversa pertence a uma execução, essa execução.
2. O catálogo fixo de eventos do kit ganha o evento da chamada feita de uma conversa; só é chamado por ele o plugin que declarar esse evento, e declaração que nomeie um evento fora do catálogo continua sendo recusada.
3. A chamada a um plugin se escreve com uma barra antes do nome do comando, numa mensagem da conversa; menção com `@` continua nomeando apenas agente da equipe, e a mesma mensagem não é lida das duas maneiras.
4. A resposta volta para a mesma conversa, entre as marcas de material e junto das fontes, nunca como instrução a quem lê — o mesmo formato da resposta de uma menção. Quando a conversa pertence a uma execução, o mesmo texto também vira documento na pasta do ciclo dessa execução.
5. O contrato de permissão continua o mesmo: rede e escrita viram pedido em Ações, e a resposta sai de lá; uma escrita irreversível é anunciada antes de sair; uma pasta de teste não libera requisição nem escrita. A esse pedido, o telefone pareado também pode responder permitindo — hoje só o computador permite — além de recusar o pedido e bloquear a escrita, que já podia.
6. Um plugin desligado, recusado ou sem ajuste obrigatório preenchido não é chamado, e a conversa diz o motivo.

## O que fica de fora

- Os quatro momentos do ciclo continuam disparando sozinhos os plugins que observam cada um; nada muda em quem os aciona.
- O caminho que a busca na web já usa — perguntas deixadas em arquivo e resposta em documento no fim da etapa — continua como está; esta mudança acrescenta a chamada pela conversa, não substitui.
- O que já acontece entre agentes chamados com menção permanece o mesmo: a chamada espera a resposta, uma chamada de volta a quem já está na troca é recusada e cada resposta tem teto de chamadas.
- O controle de repetição entre agentes — avisar assunto repetido, avisar ação repetida que outro já fez e perguntar se deve continuar ou finalizar antes de encerrar — fica de fora desta mudança e será pedido em questão própria.
- Permitir pelo telefone vale para o pedido que a chamada de conversa abrir; os pedidos que se abrem nos quatro momentos do ciclo continuam sendo respondidos só no computador.
- Ligar, ajustar e permitir o plugin nos seus ajustes continua nos mesmos lugares de hoje; nenhuma tela de configuração muda por esta mudança.
- Nenhum caminho de escrita novo para plugin e nenhum plugin novo: a busca na web é só a primeira a usar a chamada.

## Critérios de aceite

1. Chamada escrita com barra a um plugin ligado, com ajuste preenchido e rede permitida, numa conversa que não é de execução — vê-se a resposta do plugin aparecer na mesma conversa, entre as marcas de material, com as fontes.
2. A mesma chamada numa conversa de execução — vê-se a resposta aparecer ali, na conversa, com as fontes, com a chamada levando a execução ao plugin, e o mesmo texto gravado também como documento na pasta do ciclo da execução (na busca na web, `WEB_SEARCH.md`).
3. O evento de conversa declarado na declaração de um plugin — vê-se a declaração aceita; um evento fora do catálogo continua sendo recusado.
4. Chamada a um plugin desligado, depois a um recusado, depois a um sem ajuste obrigatório — vê-se nada rodar e a conversa mostrar o motivo, sem atrapalhar o resto da conversa.
5. Chamada sem a rede permitida — vê-se o pedido aparecer em Ações no lugar da resposta e, quando a pessoa permite ali, o plugin rodar e a resposta chegar à conversa.
6. Escrita pedida pelo plugin — vê-se o mesmo pedido em Ações e, sendo a escrita irreversível, o aviso antes de ela sair.
7. A mesma chamada numa pasta de teste — vê-se a requisição externa recusada, sem nada sair, e a conversa mostrar a recusa.
8. Na mesma conversa, uma mensagem que começa com barra e, em seguida, uma mensagem com menção — vê-se a primeira chegar ao plugin e a segunda ao agente, cada resposta no seu lugar, sem uma mensagem virar as duas coisas.
9. O pedido que a chamada abriu, recusado a partir do telefone pareado — vê-se o plugin não rodar e nenhuma resposta de plugin chegar à conversa.
10. O mesmo pedido permitido a partir do telefone pareado — vê-se o plugin rodar e a resposta chegar à conversa com as fontes, igual ao que acontece com o permitido no computador.

> O comportamento atual descrito aqui foi conferido pela leitura do programa nesta etapa. A capacidade nova ainda não existe, então nenhum destes critérios foi executado.

## Perguntas em aberto que bloqueiam

Nenhuma: nenhuma decisão de desenho mantém esta especificação travada.
