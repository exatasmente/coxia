# Issues com o rótulo e sem responsável agora aparecem na tela de execuções, com um botão para iniciar cada uma à mão

## O que mudou

Uma issue com o rótulo de gatilho e sem responsável era ignorada em silêncio: só as
issues com o rótulo atribuídas à pessoa eram alcançadas, e a issue sem responsável não
tinha onde aparecer. Agora a tela de execuções ganha uma seção própria no topo, com o
título "Issues com rótulo e sem responsável", que lista as issues abertas do projeto com
o rótulo de gatilho e sem responsável. Cada item traz a referência e o título da issue e
um botão "Iniciar".

Nada começa sozinho a partir dessa lista: só o toque no botão inicia uma execução. A
varredura automática continua exatamente como era — ela segue alcançando só as issues do
rótulo atribuídas à pessoa, e uma issue sem responsável continua sem iniciar por si só.

## Como usar

1. Abrir a tela de execuções. A seção "Issues com rótulo e sem responsável" aparece no
   topo quando existe pelo menos uma issue aberta com o rótulo de gatilho e sem
   responsável.
2. Toque em "Iniciar" no item desejado: a execução daquela issue começa com o mesmo
   caminho manual das outras formas de iniciar.
3. Se a issue já tiver uma execução, o botão do item fica desabilitado e nada acontece;
   para ela, nenhuma execução se duplica por acidente.

## O que vale saber

- A lista é de issues candidatas, lida na hora em que a tela abre; ela não é a lista de
  execuções, que continua abaixo, com os filtros de sempre.
- Não há gesto que crie execução sem ser o botão: abrir, olhar ou navegar pela tela não
  inicia nada.
- Se o início for recusado (por exemplo, a issue está fechada), o motivo aparece na tela
  em vez de falhar em silêncio.
- Quando não há nenhuma issue nessa condição — ou o workspace não tem projeto de issues —
  a seção não aparece; a tela de execuções segue normal, sem erro e sem espaço vazio.
- O que fica como era: a varredura automática e a regra de que um run só começa sozinho
  para uma issue aberta, com o rótulo e atribuída à pessoa.

## Como foi conferido

O código e os textos novos foram conferidos pelos portões do projeto (checagem de tipos,
testes automatizados, lint das traduções e as auditorias de tema e de conteúdo público),
todos aprovados; os testes cobrem a lista (só issues abertas, com o rótulo e sem
responsável) e o início manual com recusa de duplicata. Na tela, a seção foi exercitada
num aplicativo aberto: a issue listada com o botão "Iniciar", o botão desabilitado quando
a issue já tem execução, a recusa ao iniciar mostrada na tela e a seção ausente com a
lista vazia.

Não verificado: a ida do clique até a execução criada (o início foi recusado antes de
criar a execução e o motivo apareceu na tela), o visual no tema escuro e a varredura
automática observada numa janela.
