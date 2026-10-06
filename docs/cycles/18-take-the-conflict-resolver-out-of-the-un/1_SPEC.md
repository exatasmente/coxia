# O caminho do conflito sai da conversa de desbloqueio

## O que se pede

O pedido, nas palavras de quem abriu:

> Unblock is the conversation about a blocker and its ways out. The embedded conflict resolver is a tool: the blocker should link to it instead.

E o escopo fixado no comentário do pedido:

> Mantida, pequena: tirar o painel de conflito de `Deep.tsx` e deixar o bloqueio apontar para o botão que já existe em Hoje; os textos e o lugar `deep` que ficarem órfãos saem junto. Não depende de migração (as outras mudanças da série foram juntadas em #101).

## O que muda para quem usa

Hoje a tela de desbloqueio, além da conversa sobre o bloqueio e das saídas dele, mostra um painel com o botão que prepara e abre a resolução de um conflito. Duas coisas ao mesmo tempo no mesmo lugar: a conversa e a ferramenta.

Depois da mudança, a tela de desbloqueio volta a ser só a conversa. Quem chega lá por causa de um bloqueio continua vendo qual é o bloqueio e as saídas propostas, mas o botão de resolver conflito não aparece mais ali dentro.

O botão não some do app: ele passa a ser oferecido apenas onde já é oferecido hoje, na tela de Hoje — na linha do que precisa de atenção, junto ao item que descreve o bloqueio, e entre os botões de ação da linha de atividade do card. Chegar a ele, a partir do bloqueio, é a linha do bloqueio apontar para lá.

Nada muda na resolução do conflito em si, nem em como o app percebe que uma requisição está em conflito, nem na confirmação antes de qualquer escrita para fora.

## Regras

- A conversa de desbloqueio não hospeda mais o botão que prepara a resolução de conflito, em nenhuma situação.
- O botão continua sendo oferecido nos pontos da tela de Hoje onde já é oferecido hoje.
- É a linha do bloqueio que aponta para o botão, não um botão novo.
- O caminho de conflito já existente não é alterado: perceber qual requisição está em conflito e preparar a resolução seguem iguais.
- A confirmação antes de qualquer escrita para fora continua valendo onde quer que a resolução seja iniciada.
- Os textos que só existiam nesse painel, e a marca de lugar que só ele usava, deixam de existir no app; o que os usa em espelho (catálogos de idioma e cópias dos testes) sai junto, para os portões de idioma continuarem verdes.
- Nenhuma configuração precisa ser migrada por causa desta retirada. A cerimônia que governa o botão de conflito continua sendo uma chave de configuração lida antes de ele aparecer.

## Fora do escopo

- Mudar como o conflito é resolvido, quem o resolve ou quando.
- Mudar a detecção de qual requisição está em conflito.
- Criar um botão novo em qualquer tela.
- Mudar os pontos da tela de Hoje onde o botão aparece.
- Migração de configuração (as demais mudanças da série foram juntadas em outro item).
- Fazer sinais de bloqueio que hoje vivem fora das cerimônias passarem a chegar à conversa de desbloqueio: isso é outro item irmão deste, não esta retirada.

## Critérios de aceite

1. Abrir a conversa de desbloqueio de um card que tem requisição em conflito: a conversa aparece e o painel de conflito, com o botão, não aparece em lugar nenhum dela.
2. Na tela de Hoje, o botão de resolver conflito continua exatamente onde estava: na linha do que precisa de atenção, junto ao item do bloqueio, e na linha de atividade do card. Nenhum dos dois pontos muda de lugar nem perde o botão.
3. O item de bloqueio na lista do que precisa de atenção passa a levar ao ponto onde o botão está, em vez de levar à tela de desbloqueio por causa do painel.
4. Resolver um conflito continua funcionando do começo ao fim: preparar a resolução, abrir a resolução e passar pela confirmação antes de qualquer escrita para fora, sem mudança nesse caminho.
5. Os textos que só apareciam nesse painel não aparecem mais em nenhuma tela, nos dois idiomas, e os portões de idioma e de catálogo continuam verdes.
6. Nenhum ajuste de configuração é pedido a quem usa o app por causa desta retirada.
7. Os testes passam sem nenhuma afirmação de que a tela de desbloqueio mostra o painel de conflito.

## Perguntas em aberto

Nenhuma. O pedido e o comentário de quem o abriu fecham o escopo: o que sai, o que fica e o que fica de fora estão ditos acima.

## Prioridade e marco

- Prioridade proposta: manter **low**, como já está. É uma retirada pequena, sem mudança de comportamento para quem usa o app além de onde o botão aparece, e sem migração de configuração; o valor está em arrumar a série, não na urgência.
- Marco proposto: nenhum. A retirada é pequena e de arrumado; não há entrega que a peça para quem usa o app.
