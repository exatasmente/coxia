# A atribuição por responsável aparece onde o gatilho é configurado e lido

## O que muda para quem usa

Uma pessoa que liga o gatilho e põe o rótulo numa issue que ninguém assumiu passa a
entender, nos mesmos lugares onde configura e lê o gatilho, que a execução só começa
sozinha quando a issue está **aberta, com o rótulo e atribuída a ela**. Hoje esses
lugares falam só do rótulo, e a atribuição vive apenas no documento de execução, que a
pessoa não abre para configurar.

O ganho é de entendimento, não de comportamento: nada no app muda de ação. A pessoa
deixa de achar que o rótulo bastava e passa a saber que precisa assumir a issue.

## O que passa a ser dito, em palavras do produto

- **Na configuração documentada do runner**, nos dois idiomas, o gatilho passa a pedir
  três coisas juntas: a issue aberta, o rótulo (padrão `coxia`, caixa não importa) e a
  atribuição à pessoa. O texto aponta para o parágrafo do documento de execução que já
  diz isso, para a pessoa ter o detalhe num lugar só.
- **Na tela de Configurações › Runner**, a dica do campo do rótulo passa a dizer que a
  issue também precisa estar atribuída à pessoa. O aviso de que a caixa não importa
  continua na dica.
- **No documento de provedores de código**, em cada host, passa a estar dito que a
  leitura que alimenta o gatilho é a das issues atribuídas à pessoa, e como cada host
  filtra por responsável (GitHub por `filter=assigned` ou `assignee=<usuário>`, GitLab
  por `scope=assigned_to_me`, Bitbucket por `assignee.uuid` na consulta). Nos dois
  idiomas.

Os três textos precisam ser consistentes entre si e com o documento de execução: a
mesma frase em todo lugar, sem prometer mais do que o comportamento observado.

## Regras

- **Nada de comportamento novo.** O gatilho continua iniciando sozinho só issue aberta,
  com o rótulo e atribuída à pessoa; a alternativa de dispensar a atribuição segue
  descartada, pelos motivos já registrados.
- **Nenhuma tela nova, nenhum aviso novo.** A dica do campo é texto de ajuda; não há
  mensagem nova de erro ou de estado.
- **Todo texto de interface passa pelos catálogos**, com a chave nos dois idiomas
  (`ui.runner.triggerHint` em pt-BR e inglês), mantendo o restante da dica.
- **A documentação descreve o filtro por responsável como regra do gatilho**, no par
  "aberta + rótulo + atribuída", sem afirmar que o responsável é reconferido em todos os
  caminhos de leitura do app (o funil comum do runner acrescenta estado e rótulo sobre a
  lista já "minha"; o reencontro de responsável no funil não foi verificado).
- **A regra pública vale para tudo que for escrito:** sem nome de empresa, pessoa, host
  ou número real de issue; placeholders neutros; a auditoria pública é gate.
- **A entrada do produto fica fora:** o aviso na tela de execuções para issue com o
  rótulo e ninguém atribuído, com um jeito de iniciar à mão, é outra issue (105) e não
  entra aqui.

## Critérios de aceite

Cada item é conferível por uma pessoa, sem ler código.

1. Abrindo a configuração documentada do runner, nos dois idiomas, o gatilho descreve
   as três condições juntas — issue aberta, com o rótulo e atribuída à pessoa — e
   aponta para o documento de execução onde o requisito já está dito.
2. Na tela de Configurações › Runner, a dica do campo do rótulo diz que a issue precisa
   estar atribuída à pessoa e mantém o aviso de que a caixa não importa.
3. Nos catálogos dos dois idiomas, a chave `ui.runner.triggerHint` traz a atribuição e
   o aviso de caixa, sem texto órfão ou divergente entre os idiomas.
4. O documento de provedores de código diz, nos dois idiomas, que a lista que alimenta o
   gatilho é a das issues atribuídas à pessoa, com o filtro de cada host (GitHub, GitLab,
   Bitbucket).
5. Os três textos contam a mesma história: issue aberta, com o rótulo e atribuída à
   pessoa; nenhum deles diz que o rótulo sozinho basta.
6. Nenhuma ação do app mudou: uma issue aberta, com o rótulo e atribuída continua
   iniciando sozinha; uma com o rótulo e sem responsável continua não iniciando.
7. Nada de tela nova, mensagem nova ou aviso novo aparece em nenhum dos dois idiomas.

## Fora do escopo

- O aviso na tela de execuções para uma issue com o rótulo e ninguém atribuído, com um
  jeito de iniciar à mão: fica na issue 105.
- Dispensar a exigência de atribuição, ou transformá-la numa configuração de escopo:
  descartado, e não entra.
- Mudar o comportamento do runner ou o filtro por responsável nos provedores: se
  precisar mudar, é outro trabalho, não este.
- Esconder, desabilitar ou reescrever o campo do rótulo, ou trocar o rótulo padrão.

## Perguntas em aberto

Nenhuma: não falta nada que só quem abriu possa dizer. O pedido nomeia os lugares, o
texto desejado e o escopo revisado; a única ressalva, de quem for escrever, é não
prometer como regra geral um filtro que não foi verificado em todos os caminhos.
