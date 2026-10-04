# Uma só regra para falar com os agentes do time

## O problema

Hoje uma pessoa só consegue chamar um agente do time com `@agente` dentro da thread de uma execução. Em todo o resto do aplicativo o `@` é texto comum e nenhum agente responde — e, num canal, a tela chega a mostrar "Chamado: <agente>" sob a mensagem mesmo quando ninguém foi chamado, enquanto o aviso do compositor diz que ali o `@` não chama. Quem escreve tem de descobrir em que lugares do aplicativo falar com um agente é permitido. A própria issue pede:

> **One rule:** wherever a person can write to the app, `@agent` calls that agent of the team, and the agent answers in the same place.
>
> The person wants to talk to an agent, not to work out where in the app talking to it is allowed.

## O que muda para quem usa

Passa a valer uma regra só: onde a pessoa escreve para o aplicativo, `@agente` chama aquele agente do time, e o agente responde no mesmo lugar, sempre somente leitura.

| Onde a pessoa escreve | Hoje | Depois |
|---|---|---|
| Thread de uma execução | O `@` chama o agente, que responde ali, somente leitura | Igual |
| Canal de um squad | O `@` é texto; a tela diz "Chamado: …" sem agente ter respondido; o aviso diz que ali o `@` não chama | O agente nomeado responde no canal, como na thread de uma execução |
| Canal em que os squads conversam entre si | Idem | O agente nomeado responde ali |
| Conversa geral (thread que a pessoa abriu) | O `@` é texto | O agente nomeado responde na conversa |
| Call diário, aprofundamento, reentrada, handoff de QA, retro e resposta livre de portão | Só o agente do sistema responde; o `@` não chega a ninguém | O agente nomeado responde dentro da cerimônia; o agente do sistema continua conduzindo e retoma depois da resposta |
| Telefone (navegador pareado) | Onde pode escrever, vale o de hoje | Onde pode escrever, vale o de agora |

Num canal, o aviso que dizia que o `@` não chama sai; a tela passa a dizer o que de fato acontece.

## O que cada lugar entrega ao agente

- **Thread de uma execução.** Nada muda: o agente recebe a conversa, os documentos da pasta do ciclo e — quando executa comandos — a cópia descartável do código da execução.
- **Canal de um squad.** O agente recebe a conversa do canal, a missão do squad e os repositórios do escopo do squad para leitura.
- **Canal sem squad e conversa geral.** O agente recebe a conversa e os repositórios do espaço de trabalho para leitura. Não há missão de squad a entregar.
- **Cerimônia.** O cartão ou a issue em discussão é o contexto, junto da conversa da cerimônia.

## Regras

1. Onde a pessoa pode escrever para o aplicativo, `@agente` chama aquele agente do time, e o agente responde no mesmo lugar. Uma regra só, sem exceção de lugar.
2. O agente chamado nunca escreve: responde somente leitura, qualquer que seja a permissão que ele tenha. Não altera arquivos do repositório nem o ramo, e não escreve no rastreador. Uma issue que ele proponha espera em Ações pelo "sim" da pessoa; num espaço de trabalho de teste, a confirmação é recusada.
3. Quando o agente executa comandos, ele o faz sobre uma cópia descartável do código, como na thread de uma execução; o que ele cria nessa cópia é descartado ao fim e nunca chega ao repositório real. Um lugar que não tem repositório (uma conversa geral sem escopo) não dá comandos ao agente, e a resposta diz por quê.
4. Um canal de squad entrega a missão do squad ao agente; um canal sem squad e uma conversa geral não têm missão a entregar.
5. Numa cerimônia, o agente nomeado responde dentro da cerimônia: a resposta é falada como a do agente do sistema e entra nos registros da cerimônia com o nome do agente. O agente do sistema continua conduzindo a cerimônia e retoma depois da resposta.
6. No máximo três agentes por mensagem são atendidos, como hoje; menções além disso não são chamadas.
7. Valem para a resposta os mesmos limites de tempo ocioso e de relógio que valem na thread de uma execução.
8. O que a tela diz bate com o que aconteceu: o rótulo de chamada aparece só quando um agente foi de fato chamado; um `@nome` que não corresponde a nenhum agente do time é dito desconhecido; enquanto o agente trabalha, o lugar mostra que está trabalhando.
9. No telefone (navegador pareado), o mesmo vale em todo lugar onde ele pode escrever.
10. O que já funciona não muda: a thread de uma execução continua respondendo como hoje, e os comentários de etapa e a publicação no rastreador seguem como estão.

## As decisões que a issue deixava em aberto

A issue pedia para fixar três pontos no refino. A recomendação de cada um vai abaixo, para o aceite no portão.

1. **Um nome falado chama um agente, ou só o `@` digitado?** Só o `@` chama — digitado, ou vindo da transcrição de uma fala que produza o `@`. Uma frase em linguagem natural ("pergunta ao developer") não chama ninguém. Motivo: uma regra só é o que a issue pede, e rotear por linguagem natural é ambíguo e muda de comportamento com a transcrição.
2. **O que um agente lê num canal sem squad?** A conversa do canal e os repositórios do espaço de trabalho, para leitura; não há missão de squad a ler. Num canal de squad, além disso, a missão do squad.
3. **Respostas num canal são espelhadas no rastreador?** Não. Uma conversa de canal é entre pessoas e agentes do time e permanece interna, como a postagem de uma pessoa hoje. O que já é publicado (os comentários de etapa de uma execução) não é tocado, e a resposta de uma cerimônia vai para os registros da cerimônia, não para o rastreador.

## Fora do escopo

- Um nome falado em linguagem natural chamar um agente: só o `@` chama.
- Espelhar respostas de canal no rastreador, ou publicar a conversa de um canal.
- Abrir uma execução nova quando um agente é chamado fora de uma execução; a conversa fica onde foi escrita, e não nasce uma execução sem issue.
- Mudar o que a thread de uma execução já faz, os comentários de etapa e a publicação no rastreador.
- Escolher, editar ou restringir quais agentes do time podem ser chamados em cada lugar: qualquer agente do time pode ser chamado onde a pessoa escreve.
- O estado de "trabalhando" enquanto o agente responde é pedido por outra issue; esta mudança o mostra onde ele já existir e não o constrói (ver Perguntas em aberto).

## Aceitação

Cada item abaixo é algo que uma pessoa consegue conferir no aplicativo.

1. Numa conversa geral, escrever `@developer` faz o developer responder ali, somente leitura; nada é escrito no repositório nem no rastreador.
2. Num canal de squad, `@agente` faz o agente responder no canal; a resposta reúne a conversa e a missão do squad, e o agente lê os repositórios do escopo do squad.
3. Num canal sem squad ou numa conversa geral, o agente responde sem missão; onde não há repositório, o agente não executa comandos e a resposta diz por quê.
4. Em cada cerimônia que aceita texto (call diário, aprofundamento, reentrada, handoff de QA, retro e resposta livre de portão), `@agente` faz o agente responder dentro da cerimônia: a resposta é falada como a do agente do sistema e entra nos registros com o nome do agente; o agente do sistema retoma depois.
5. O rótulo "Chamado: <agente>" aparece só quando um agente foi de fato chamado; um `@nome` sem agente do time é dito desconhecido; enquanto o agente trabalha, o lugar mostra que está trabalhando.
6. Um agente que executa comandos os executa sobre uma cópia descartável; o que ele cria some ao fim e não chega ao ramo.
7. Uma issue proposta por um agente chamado fora de uma execução espera em Ações e só existe com o "sim"; num espaço de trabalho de teste, a confirmação é recusada.
8. Uma mensagem com mais de três menções atende só as três primeiras; as demais não são chamadas.
9. No navegador pareado, em todo lugar onde ele pode escrever, o mesmo acontece.
10. A thread de uma execução continua respondendo como hoje, e os avisos que diziam que o `@` não chama num canal deixam de existir.

## Prioridade e marco propostos

- **Prioridade: P1.** É uma promessa central do produto — falar com um agente onde se escreve — e corrige um rótulo que hoje afirma ter chamado um agente que ninguém chamou; não é perda de dado nem risco de segurança, o que o deixaria em P0.
- **Marco: 0.6.0** (a próxima versão menor depois da 0.5.0), por ser mudança ampla e visível para quem usa. A lista de marcos do rastreador não foi alcançada nesta etapa, então o marco fica como proposta a confirmar.

## Perguntas em aberto

- O estado de "trabalhando" enquanto o agente responde é pedido por uma issue irmã e não é construído aqui; esta mudança o mostra onde ele já existir. Enquanto aquela peça não estiver pronta, o "trabalhando" pode não aparecer em todos os lugares, e isso está dito como não verificado.
- De onde sai a cópia descartável do código quando o agente executa comandos fora de uma execução (um canal ou uma cerimônia não têm worktree próprio) é decisão do plano técnico; o comportamento exigido aqui é só o do item 3 das regras.
