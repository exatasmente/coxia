# O que se verificou sobre chamar um plugin de uma conversa

Plano de teste da entrega: cada critério de aceite da especificação virou um cenário numerado, com o que fazer, o que se espera e o que de fato se viu. Os números dos cenários são os dos critérios.

## Como se verificou, em uma frase cada

- **No aplicativo em funcionamento** (cenários 1, 4, 8, em parte): a janela do app foi aberta numa pasta de dados descartável, na tela virtual, e conduzida por um navegador controlado; a pessoa escreveu o comando na conversa do fórum e leu-se a resposta ali.
- **Num arnês de caixa preta** (cenários 1–10): um programa descartável importou os módulos verdadeiros do produto — o serviço de plugins, o leitor de declarações, o runtime, a política do navegador, os catálogos — e conduziu a chamada de conversa com dependências falsas (registro de plugins, porta de Ações, linha da conversa, sandbox, requisição). O plugin de verdade rodou como código, com uma sandbox que só executa o comando; nada do produto foi alterado.
- **Nos testes do repositório**: a suíte inteira foi rodada nesta árvore, e todos os arquivos que a mudança toca passaram.

O que não deu para verificar está dito como não verificado, no fim.

## Cenário 1 — chamada numa conversa que não é de execução

**O que fazer:** numa conversa comum, escrever um comando de barra para um plugin ligado que declara o acontecimento da conversa. **O que se espera:** a resposta do plugin aparece na mesma conversa, entre as marcas de material, com as fontes.

**Executado.** No arnês, a conversa `general` escreveu o comando, o plugin rodou e o texto voltou com a cerca de material e o aviso de que não é instrução; a resposta não abriu documento (a conversa não é de uma execução) e o alvo entregue foi a pasta vazia própria (`sandbox/plugin-call`). No aplicativo, o comando chegou ao plugin e a app respondeu na mesma conversa (com o motivo, naquele ambiente, porque a sandbox não sobe ali). Prova: `ev-6`, `ev-7`, `ev-8`.

## Cenário 2 — a mesma chamada numa conversa de execução

**O que fazer:** a mesma chamada numa conversa ligada a uma execução. **O que se espera:** a resposta na conversa, com as fontes; a chamada levando a execução ao plugin; e o mesmo texto gravado como documento na pasta do ciclo (na busca na web, `WEB_SEARCH.md`).

**Executado.** No arnês, a conversa `run-7` levou a execução ao plugin (o plugin recebeu o id da execução), o alvo foi o da execução e a app gravou o documento na pasta do ciclo daquela execução; numa conversa comum, o mesmo plugin não escreveu documento nenhum (o alvo da conversa corta a escrita). A gravação pela busca na web de verdade, com a sandbox de verdade, não foi vista — o documento do cenário é o do runtime, com um plugin de teste. Prova: `ev-6`, `ev-7`.

## Cenário 3 — o acontecimento declarado

**O que fazer:** uma declaração que nomeia o acontecimento da conversa; depois, uma que nomeia um fora do catálogo. **O que se espera:** a primeira aceita, a segunda recusada.

**Executado.** O catálogo fixo lido nesta árvore tem os cinco acontecimentos, com o da conversa entre eles; uma declaração com ele foi aceita e uma com nome inventado foi recusada. Prova: `ev-6`, `ev-7`.

## Cenário 4 — desligado, recusado, sem o acontecimento e sem ajuste

**O que fazer:** chamar um plugin desligado, depois um de declaração recusada, depois um que não declara o acontecimento e depois um com ajuste obrigatório vazio. **O que se espera:** nada rodar e a conversa dizer o motivo.

**Executado.** Os quatro casos foram exercitados no arnês: cada um devolveu uma linha na mesma conversa com o motivo (desligado; declaração recusada, com o motivo da recusa; não responde a chamadas de conversa; falta preencher o ajuste), e em nenhum deles o plugin rodou. Um comando que nenhum plugin atende recebeu uma linha só, sem atrapalhar o resto. No aplicativo, a pessoa viu na conversa a linha de "nenhum plugin atende ao comando" e, depois, o motivo real daquele ambiente. Prova: `ev-6`, `ev-7`, `ev-8`.

## Cenário 5 — sem a rede permitida

**O que fazer:** chamar um plugin que precisa da rede sem permissão. **O que se espera:** o pedido aparece em Ações no lugar da resposta e, permitindo ali, o plugin roda e a resposta chega à conversa.

**Executado.** No arnês, a chamada abriu um pedido em Ações com a conversa, o que foi pedido e sem segurar a execução; a conversa mostrou a linha de espera; o mesmo pedido repetido na mesma conversa continuou sendo um só, e o mesmo pedido noutra conversa abriu um pedido próprio. Permitido o pedido, o plugin rodou, a requisição saiu e a resposta chegou à conversa. A permissão contra uma instância de busca de verdade não foi vista — a porta de Ações e a requisição foram falsas. Prova: `ev-6`, `ev-7`.

## Cenário 6 — a escrita pedida pelo plugin

**O que fazer:** chamar um plugin que pede uma escrita. **O que se espera:** o mesmo pedido em Ações e, sendo a escrita irreversível, o aviso antes de ela sair.

**Parcialmente executado.** No arnês, o plugin que pede uma escrita irreversível, com a rede já permitida, anunciou a escrita depois de a pessoa permitir; a escrita pedida por um plugin que precisa da rede abre o pedido de rede primeiro, na ordem do contrato. A contagem do prazo do aviso e a saída de fato da escrita não foram vistas (a porta de Ações foi falsa). Prova: `ev-6`, `ev-7`.

## Cenário 7 — numa pasta de teste

**O que fazer:** a mesma chamada numa pasta de teste. **O que se espera:** a requisição recusada, nada saindo, e a conversa mostrando a recusa.

**Executado.** No arnês, com a porta de Ações recusando como uma pasta de teste recusa, o plugin que precisa da rede não rodou, nenhuma requisição saiu e a conversa recebeu a recusa. Prova: `ev-6`, `ev-7`.

## Cenário 8 — uma mensagem de barra e, depois, uma menção

**O que fazer:** na mesma conversa, uma mensagem que começa com barra e, em seguida, uma mensagem com menção. **O que se espera:** a primeira chega ao plugin, a segunda ao agente, sem uma mensagem virar as duas coisas.

**Executado.** No arnês, a leitura de uma mensagem foi exercitada com oito textos: só a chamada de barra com pergunta depois do nome do comando é comando; `@` no começo, um caminho como `/usr/lib ...`, o nome com maiúscula, o comando sem pergunta e texto comum não são comando. No aplicativo, a mensagem com barra foi gravada sem menção e a app respondeu na mesma conversa. Prova: `ev-6`, `ev-7`, `ev-8`.

## Cenário 9 — o pedido recusado pelo telefone

**O que fazer:** recusar, a partir do telefone pareado, o pedido que a chamada abriu. **O que se espera:** o plugin não roda e nenhuma resposta de plugin chega à conversa.

**Executado por leitura de política e pelo serviço.** A política deixa o canal de resposta aberto ao navegador; recusado o pedido, nada rodou e a conversa recebeu a linha de que a rede foi recusada. Um pedido dos quatro momentos do ciclo respondido pelo navegador foi recusado pelo serviço (só o computador permite aquele), enquanto o mesmo pedido no computador foi aceito. Isto foi exercitado no arnês, com a origem da chamada marcada; os botões na tela do telefone não foram vistos — não há telefone pareado nesta verificação. Prova: `ev-6`, `ev-7`.

## Cenário 10 — o pedido permitido pelo telefone

**O que fazer:** permitir, a partir do telefone pareado, o mesmo pedido. **O que se espera:** o plugin roda e a resposta chega à conversa com as fontes, igual ao permitido no computador.

**Executado pelo serviço.** O pedido com conversa, respondido com origem de navegador, foi permitido e o plugin rodou, com a resposta entregue à conversa — o mesmo caminho do permitido no computador. Os botões e o cartão de Ações na tela do telefone não foram vistos, porque não há telefone pareado nesta verificação. Prova: `ev-6`, `ev-7`.

## As provas

| Cenário | Comprovação |
|---|---|
| 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 | `ev-6`, `ev-7` (o arnês de caixa preta, duas passagens) |
| 1, 4, 8 (na tela) | `ev-8` (a captura da conversa no aplicativo) |
| — (gates e suíte) | `ev-9`, `ev-10` |

## Os gates e a suíte

Rodados nesta árvore nesta etapa: a checagem de tipos passou limpa; a suíte inteira rodou com 415 arquivos e 6944 casos, com 6898 verdes, 41 pulados e 5 vermelhos, **todos em arquivos que a mudança não toca** (dois arquivos do navegador do aplicativo por faltar uma dependência neste computador, um por falta de disco, um por estouro de prazo e um de escrita de caminhos); a auditoria do repositório público passou em 1606 arquivos; o lint de idiomas passou com 5491 chaves nos dois idiomas; a auditoria de tema passou com as mesmas 14 cores literais de arquivos anteriores. Todos os arquivos que a mudança toca passaram na mesma passagem.

## O que não foi verificado

- **A sandbox de verdade.** Neste computador a sandbox do aplicativo não sobe (o núcleo não permite os namespaces que ela precisa). Por isso, no aplicativo, nenhuma chamada chegou a rodar um plugin de verdade: a conversa respondeu com o motivo real. O comportamento do plugin rodando foi visto no arnês, com uma sandbox que só executa o comando.
- **A gravação do documento pela busca na web de verdade**, ligando execução, sandbox e busca na web: vista só em pedaços (o documento que o runtime grava, e o alvo certo entregue).
- **A permissão em Ações contra uma instância de busca de verdade**: a porta de Ações e a requisição foram falsas no arnês.
- **Os botões na tela do telefone pareado** (cenários 9 e 10): não há telefone pareado nesta verificação; o que decide foi exercitado no serviço e na política.
- **A tela de plugins mostrando o rótulo do acontecimento novo**: a chave existe nos dois catálogos e passou no lint de idiomas, mas o rótulo na tela não foi visto.
- **A resposta com as fontes de uma busca real**: o texto com fontes foi o de um plugin de teste, não o da busca na web.

## Resultado dos cenários

- Cenário 1 — chamada numa conversa que não é de execução: passou (executado na sandbox) — No arnês, a conversa common escreveu /comando com pergunta, o plugin (JavaScript de verdade, com a sandbox que só executa o comando) rodou e a resposta voltou na mesma conversa entre as marcas <data> e o aviso de material, sem documento e com o alvo da pasta vazia própria (sandbox/plugin-call). No aplicativo, na tela virtual, a pessoa escreveu /demo-search na conversa do fórum e a app respondeu ali mesmo: com o plugin ligado, chamou-o e reportou o motivo real daquele ambiente.
- Cenário 2 — a mesma chamada numa conversa de execução: passou (executado na sandbox) — No arnês, a conversa run-7 levou a execução ao plugin (o plugin recebeu runId=7 e stage), o alvo foi o da execução e a app gravou o documento na pasta do ciclo dela (o arquivo DEMO.md foi lido do disco, com o texto do plugin e o rótulo do acontecimento). Numa conversa comum o mesmo plugin não escreveu documento nenhum, e writePluginDocument com documents:false devolveu null. A gravação pela busca na web de verdade, ligando execução, sandbox e busca, não foi vista.
- Cenário 3 — o acontecimento declarado no catálogo fixo: passou (executado na sandbox) — O catálogo fixo lido nesta árvore tem os cinco acontecimentos, com conversation-called; a leitura da declaração aceitou uma declaração com o acontecimento novo e recusou uma com nome inventado.
- Cenário 4 — desligado, recusado, sem o acontecimento, sem ajuste, comando desconhecido: passou (executado na sandbox) — Quatro casos exercitados no arnês: cada um devolveu uma linha na mesma conversa com o motivo (o plugin está desligado; a declaração foi recusada, com o motivo; o plugin não responde a chamadas feitas de uma conversa; falta preencher o ajuste obrigatório "Search address"), e em nenhum o plugin rodou. Um comando que nenhum plugin atende recebeu uma linha só. No aplicativo, a pessoa viu a linha de que nenhum plugin atende ao comando e, depois, o motivo real.
- Cenário 5 — sem a rede permitida, o pedido em Ações: passou (executado na sandbox) — No arnês, a chamada ao plugin que precisa da rede abriu um pedido em Ações com a conversa, o que foi pedido e holdsRun:false (não segura a execução); a conversa mostrou a linha de espera; o mesmo pedido repetido na mesma conversa continuou sendo um só, e o mesmo pedido noutra conversa abriu um pedido próprio. Permitido o pedido pelo computador, o plugin rodou, a requisição saiu e a resposta chegou à conversa. A permissão contra uma instância de busca de verdade não foi vista (a porta de Ações e a requisição foram falsas).
- Cenário 6 — a escrita pedida pelo plugin: não rodou (executado na sandbox) — No arnês, o plugin que pede uma escrita irreversível, com a rede já permitida, fez o pedido de rede primeiro e depois o de escrita, na ordem do contrato. A contagem do prazo do aviso e a saída de fato da escrita não foram vistas: a porta de Ações foi falsa e o aviso com prazo é do cartão, que a sandbox deste ambiente não chega a exercitar. Fica como não verificado, não como falha.
- Cenário 7 — a mesma chamada numa pasta de teste: passou (executado na sandbox) — No arnês, com a porta de Ações recusando como uma pasta de teste recusa, o plugin que precisa da rede não rodou, nenhuma requisição saiu (a contagem de requisições não subiu) e a conversa recebeu a recusa no lugar da resposta.
- Cenário 8 — uma mensagem de barra e, depois, uma menção: passou (executado na sandbox) — A leitura de uma mensagem foi exercitada com oito textos: só a barra com o id do plugin e pergunta não vazia é comando; @ no começo, um caminho como /usr/lib ..., o nome com maiúscula, o comando sem pergunta, /nome=1 e texto comum não são comando; espaços em volta são aparados. No aplicativo, a mensagem com barra foi gravada e respondida na mesma conversa, e a menção @ continua nomeando agente (a leitura é a mesma função pura para todos).
- Cenário 9 — o pedido recusado pelo telefone pareado: passou (executado na sandbox) — A política do canal de resposta lida nesta árvore deixa-o aberto ao navegador (a antiga lista só-do-computador não o contém mais). No arnês, respondido com origem de navegador: o pedido da conversa foi permitido e o do ciclo foi recusado pelo serviço com o aviso de que só a janela do app o faz, enquanto o mesmo pedido do ciclo no computador foi aceito. Recusado o pedido da conversa, o plugin não rodou e a conversa recebeu a linha de recusa. Os botões na tela do telefone não foram vistos (não há telefone pareado nesta verificação).
- Cenário 10 — o pedido permitido pelo telefone pareado: passou (executado na sandbox) — No arnês, o pedido aberto por uma conversa, respondido com origem de navegador, foi permitido e o plugin rodou, com a resposta entregue à conversa — o mesmo caminho do permitido no computador. O cartão de Ações na tela do telefone e os seus botões não foram vistos, porque não há telefone pareado nesta verificação.
- A suíte e os gates do repositório nesta árvore: passou (executado na sandbox) — Rodados nesta etapa: npx tsc --noEmit limpo; npx vitest run com 415 arquivos e 6944 casos (6898 verdes, 41 pulados, 5 vermelhos, todos em arquivos que a mudança não toca: dois do navegador do app por @playwright/mcp ausente, um por disco baixo, um por estouro de prazo e um de escrita de caminhos); public-audit 1606 arquivos limpo; i18n:lint 5491 chaves, 0 achados; theme-audit 14 cores literais anteriores. Todos os arquivos que a mudança toca passaram na mesma passagem (plugins-service, plugins-core, plugins-web-policy, plugin-runtime, plugin-write, plugin-requests, plugin-grants, web-search-plugin, forum-store, runner-lifecycle, ui-i18n).
