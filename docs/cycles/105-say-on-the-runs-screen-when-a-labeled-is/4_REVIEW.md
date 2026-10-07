# Issues com rótulo e sem responsável: listagem e início manual na tela de execuções

## O que a mudança faz

A tela de execuções passa a mostrar, numa seção própria, as issues abertas do projeto que carregam o rótulo de gatilho e não têm ninguém assumido. Para cada uma há um botão de iniciar que abre a execução daquela issue à mão. O botão fica desabilitado para uma issue que já virou execução, e um início que o host recuse (issue fechada, branch existente, duplicada) mostra o motivo na tela em vez de falhar em silêncio. Quando a lista está vazia ou não há projeto de issues, a seção some sem erro.

## Como o comportamento se compara ao aceite

Os sete critérios do aceite são atendidos pela implementação:

1. Uma issue aberta, com o rótulo de gatilho e sem responsável aparece listada na tela de execuções.
2. Há um controle de iniciar por item, e usá-lo começa a execução daquela issue.
3. Issue fechada com o rótulo não entra na lista (o filtro exige aberta).
4. Issue com responsável não entra nessa parte da tela (ela já cobre o escopo da varredura automática).
5. Nada na lista inicia por si mesmo: a leitura nova é só leitura, e a única forma de começar é o gesto de iniciar, que passa pelo mesmo caminho manual de sempre.
6. A varredura automática se comporta como antes: continua consultando apenas as issues atribuídas à pessoa, então uma issue com o rótulo e sem responsável nunca inicia sozinha.
7. Uma issue que já tem execução não pode ser iniciada de novo por acidente: o botão é desabilitado e, mesmo assim, o caminho de iniciar recusa uma segunda execução sem confirmação.

## Fronteira de segurança

A mudança acrescenta apenas leituras. O canal novo serve a lista enxuta (número, referência, título e endereço) e é classificado na política do navegador pareado como leitura aberta, como os demais canais de leitura das execuções; não fica atrás do interruptor de efeitos externos e não é restrito à janela. Nada do que a mudança acrescenta escreve no host: o início continua sendo a ação explícita da pessoa pelo caminho manual, e a varredura automática não foi alterada. O teste que ancora os canais servidos pelo módulo e as leituras que o módulo faz do provedor foi atualizado para incluir o canal novo e a leitura por rótulo, e passa.

## Verificações

Foram conferidas por leitura do código e pela execução dos gates:

- A checagem de tipos passou.
- A lint das traduções passou (as chaves novas estão nos dois catálogos, nenhuma sem uso ou sem tradução).
- O audit de temas e o audit de repositório público passaram.
- O build do renderer passou.
- O novo arquivo de teste cobre: o filtro da consulta (só issues abertas, com o rótulo e sem responsável), a comparação do rótulo sem diferenciar maiúsculas, a varredura que não inicia issue sem responsável mesmo estando na lista nova, e o início manual com recusa de duplicata. Passa.
- O teste da política web passa, incluindo o canal novo.
- A suíte completa roda com todas as verificações passando, exceto duas em um arquivo de sandbox com a interface gráfica, que dependem de um sandbox real e de um caminho de navegadores disponível na máquina; esse arquivo não toca nenhum arquivo desta mudança e falha por motivo de ambiente. Rodando esse arquivo isolado, a falha se repete no mesmo ponto.

## O que ficou em aberto

- Falta a linha de CHANGELOG sob ## [Unreleased]: a mudança é visível ao usuário e a regra do projeto pede a linha ali. Não foi adicionada nesta entrega.
- O fluxo visual da seção (a lista, o botão desabilitado, o motivo de recusa) não foi exercitado num app rodando; foi conferido por leitura do código e pelo build, mas não por interação com uma janela aberta.

## Conclusão

A implementação está de acordo com a spec e o plano técnico, respeita a fronteira de segurança e não muda a varredura automática. Há um item a corrigir antes de considerar pronto: adicionar a linha de CHANGELOG sob ## [Unreleased] para a mudança visível ao usuário.
