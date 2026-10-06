# Um plugin alcança um serviço externo pelo aplicativo, com configurações e chave guardada

## O que se pede

A issue pede que um plugin consiga falar com um serviço externo **pelo aplicativo**: o
plugin descreve a requisição, o aplicativo a faz (pondo a chave guardada quando a
requisição precisa de uma) e devolve a resposta ao plugin. O plugin nunca vê o valor de
uma chave, e nada do que ele pede sai sem a permissão da pessoa. É o que destrava as
integrações que vêm depois da plataforma de plugins: um registro de horas, um gerenciador
de issues, um webhook de chat, uma instância própria de busca.

Decisões da pessoa já tomadas na conversa que abriu a issue:

- **O aplicativo faz a chamada pelo plugin**; o plugin não recebe a chave nem como
  variável de ambiente.
- O primeiro uso é a busca na web dos agentes numa **instância própria de SearXNG**
  (issue da busca), que costuma morar em `localhost` ou na rede local — onde a sandbox
  do plugin não chega (o proxy recusa endereço privado).

## O que muda para quem usa

- **Configurações de plugin.** Um plugin pode declarar configurações (um texto, uma URL,
  uma chave). A pessoa as preenche na lista de plugins, no computador. Uma configuração
  do tipo chave vai para o cofre de segredos, por referência: o valor nunca aparece na
  configuração, numa exportação, no log, na auditoria nem para o plugin.
- **Requisições feitas pelo aplicativo.** Um plugin declara as requisições que pode
  pedir: o método, o endereço (fixo ou montado a partir de uma configuração de URL) e,
  quando for o caso, onde a chave entra. Durante a execução ele pede uma delas; o
  aplicativo confere que ela é uma das declaradas, faz a chamada e devolve a resposta.
- **O contrato de permissão continua o mesmo.** Uma requisição de leitura é a "rede" do
  plugin; uma de escrita é a "escrita" dele: uma vez, nesta sessão, sempre ou recusar;
  escrita irreversível só "sempre", anunciada com prazo. Tudo o que sai fica na
  auditoria. Num espaço de trabalho de teste, nada é pedido e nada sai.
- Um espaço de trabalho sem plugins se comporta como hoje.

## Regras

1. **Só o declarado.** Uma requisição que o plugin pede tem de bater com uma das que ele
   declarou: mesmo método, mesmo destino (esquema, host e porta) e caminho dentro do
   declarado. Fora disso é recusada, com o motivo.
2. **Destino de configuração é da pessoa.** Um destino montado a partir de uma
   configuração de URL só existe depois de a pessoa preenchê-la; é o único jeito de um
   plugin chegar a um endereço local ou privado.
3. **A chave nunca chega ao plugin.** O aplicativo põe o valor no cabeçalho ou no
   parâmetro que a declaração diz, só na hora da chamada; a resposta devolvida ao plugin
   é mascarada e tem o valor da chave retirado.
4. **Leitura é rede, escrita é escrita.** As requisições de leitura são feitas durante a
   execução do plugin e dependem da permissão de rede dele, pedida antes de rodar, como
   hoje. As de escrita são juntadas e, depois da execução, seguem o caminho da escrita
   de hoje: saem, são anunciadas com prazo ou viram pedido.
5. **Limites.** Um número máximo de rodadas e de requisições por execução, um tempo
   máximo por chamada e um tamanho máximo de resposta; passou do limite, o motivo é dito
   e o plugin segue sem aquela resposta.
6. **Auditoria.** Cada requisição feita pelo aplicativo vira uma linha: plugin, método,
   destino, situação, sem o valor de chave e sem o corpo.
7. **Navegador pareado.** Preencher configuração e chave de plugin é só no computador.

## Fora do escopo

- Um plugin em JavaScript ou outra linguagem com runtime próprio (o plugin continua um
  script de shell; veja o plano para como ele lê uma resposta JSON).
- Um catálogo de integrações prontas: esta issue entrega o canal, não os plugins de
  horas, de issues ou de chat.
- OAuth ou qualquer fluxo de login interativo: a chave é um valor que a pessoa cola.

## Aceitação

1. Um plugin com uma configuração de URL e uma de chave aparece na lista com os campos;
   preencher a chave grava no cofre e a configuração guarda só a referência.
2. Um plugin pede uma requisição declarada; com a permissão, o aplicativo a faz, com a
   chave no lugar declarado, e o plugin recebe a resposta sem o valor da chave.
3. Uma requisição não declarada, para outro destino ou outro método, é recusada com o
   motivo, e nada sai.
4. Uma requisição de escrita segue o contrato de permissão de hoje e, aprovada, fica na
   auditoria; num espaço de trabalho de teste é recusada.
5. Um destino local só é alcançado quando vem de uma configuração preenchida pela pessoa.
6. Exportar a configuração não leva configuração nem chave de plugin; importar não as
   altera.
7. Sem plugins, nada muda.

## Verificação

Só leitura do código desta árvore (`release/0.7.0` com a plataforma de plugins):
`src/main/plugins/` (serviço, execução e permissão), `src/shared/plugins/` (declaração e
decisão pura), `src/main/actions.ts` (porta única, `audited`), `src/main/secrets-core.ts`
(`resolve` é o único que devolve valor), `src/main/sandbox/proxy.ts` (recusa de endereço
privado), `src/main/sandbox/session.ts` (a sessão roda vários comandos em fila). Nada foi
executado.
