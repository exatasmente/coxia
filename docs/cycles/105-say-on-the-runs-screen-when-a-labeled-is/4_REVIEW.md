# Issues com rótulo e sem responsável: listagem e início manual na tela de execuções (segunda revisão)

## O que a mudança faz

A tela de execuções passa a mostrar, numa seção própria, as issues abertas do projeto que carregam o rótulo de gatilho e não têm ninguém assumido. Para cada uma há um botão de iniciar que abre a execução daquela issue à mão. O botão fica desabilitado para uma issue que já virou execução, e um início que o host recuse (issue fechada, branch existente, duplicada) mostra o motivo na tela em vez de falhar em silêncio. Quando a lista está vazia ou não há projeto de issues, a seção some sem erro.

## O bloqueante da revisão anterior

A revisão anterior apontou como bloqueante a falta da linha de CHANGELOG sob `## [Unreleased]` para uma mudança visível ao usuário. A linha foi adicionada na seção `### Added`, antes da versão publicada, em estilo Keep a Changelog e sem referência interna de issue. O bloqueante está resolvido.

## Como o comportamento se compara ao aceite

Os sete critérios do aceite são atendidos pela implementação, conferidos por leitura do código e pelos testes:

1. Uma issue aberta, com o rótulo de gatilho e sem responsável aparece listada na tela de execuções (o filtro exige aberta, com o rótulo e sem assignee).
2. Há um controle de iniciar por item, e usá-lo chama o mesmo caminho manual de iniciar por referência que cria a execução daquela issue.
3. Issue fechada com o rótulo não entra na lista (o filtro exige estado aberto).
4. Issue com responsável não entra nessa parte da tela (ela já cobre o escopo da varredura automática).
5. Nada na lista inicia por si mesmo: a leitura nova é só leitura, e a única forma de começar é o gesto explícito de iniciar.
6. A varredura automática se comporta como antes: continua lendo apenas as issues atribuídas à pessoa, então uma issue com o rótulo e sem responsável nunca inicia sozinha — coberto por teste que confirma que a varredura não inicia uma issue sem assignee mesmo quando ela está na lista nova.
7. Uma issue que já tem execução não pode ser iniciada de novo por acidente: o botão é desabilitado para a ref já presente nas execuções e, mesmo assim, o caminho de iniciar recusa uma segunda execução sem confirmação — coberto por teste.

## Fronteira de segurança

A mudança acrescenta apenas leituras. O canal novo serve a lista enxuta (número, referência, título e endereço) e é classificado na política do navegador pareado como leitura aberta, como os demais canais de leitura das execuções; não fica atrás do interruptor de efeitos externos e não é restrito à janela. Nada do que a mudança acrescenta escreve no host: o início continua sendo a ação explícita da pessoa pelo caminho manual, e a varredura automática não foi alterada. O teste que ancora os canais servidos pelo módulo e as leituras que o módulo faz do provedor foi atualizado para incluir o canal novo e a leitura por rótulo, e passa.

## Verificações desta revisão

Foram conferidas por leitura do código e pela execução dos gates:

- A checagem de tipos passou.
- A lint das traduções passou (as chaves novas estão nos dois catálogos, nenhuma sem uso ou sem tradução).
- O audit de temas e o audit de repositório público passaram.
- Os testes da lista nova e da política web passam (14 no total), cobrindo o filtro da consulta (só issues abertas, com o rótulo e sem responsável), a comparação do rótulo sem diferenciar maiúsculas, a varredura que não inicia issue sem responsável mesmo estando na lista nova, e o início manual com recusa de duplicata.

## Regras da documentação conferidas contra o código

Quatro arquivos da documentação do projeto citam código que esta branch alterou. Todos foram lidos contra o código atual e seguem verdadeiros, sem nada que os tornasse enganosos:

- A regra do suporte cita a cadeia de escalada de perguntas; a branch acrescentou um método de leitura à interface de issues, sem tocar na cadeia.
- A regra do runner descreve a varredura automática como as issues atribuídas à pessoa; a nova leitura não a altera.
- A regra de segurança afirma que os canais de execuções são todos abertos ao navegador pareado exceto dois; o canal novo é leitura aberta, e o teste que ancora os canais o classifica assim.
- A regra de lançamento pede a linha de changelog sob `## [Unreleased]` para mudança visível ao usuário, agora presente.

## O que ficou em aberto

- O fluxo visual da seção (a lista, o botão desabilitado, o motivo de recusa) não foi exercitado num app rodando; foi conferido por leitura do código e pelos gates, mas não por interação com uma janela aberta. Fica para o QA. A suíte completa também não foi rodada nesta passada, só os testes da mudança e os gates; a falha ambiental de um teste de sandbox com a interface gráfica, que não toca arquivos desta mudança, não foi reexercitada.

## Conclusão

A implementação está de acordo com a spec e o plano técnico, respeita a fronteira de segurança e não muda a varredura automática. O único bloqueante da revisão anterior (a linha de CHANGELOG) foi resolvido. Veredito: approved.
