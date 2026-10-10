# O que se conferiu nesta revisão

A entrega foi comparada com a especificação e o plano da pasta, lendo o diff do código, os catálogos de texto, a tela do cartão de Ações e os testes. Os gates que a mudança toca foram rodados de novo nesta árvore: a checagem de tipos passou limpa, o lint de idiomas passou com as mesmas 5491 chaves nos dois idiomas, a auditoria do repositório público passou nos 1605 arquivos, e os 272 testes dos onze arquivos que a mudança toca passaram. Nenhum critério de aceite foi executado no aplicativo em funcionamento — isso continua na etapa de verificação.

## O que confere com o que foi pedido

- A chamada tem a forma decidida: uma mensagem aparada que começa com barra, com o id de um plugin antes do primeiro espaço e uma pergunta não vazia depois; mais nada é chamada (`src/shared/plugins/calls.ts`). `@` continua nomeando agente, e a mesma mensagem não é lida das duas maneiras: quem grava a mensagem zera a menção quando ela é comando, e a resposta de uma pergunta de execução não a consome (`src/main/forum.ts`, `src/main/runner/service.ts`).
- O evento novo entrou no catálogo fixo e a leitura da declaração não mudou, então uma declaração com o evento novo é aceita e um evento fora do catálogo continua recusado (`src/shared/plugins/events.ts`).
- A resposta volta para a mesma conversa como material: sai como linha de autoria do aplicativo, com o texto entre as marcas de material e o aviso de que não é instrução (`main.forum.code.plugin.answered`), e o assinante novo nunca a lê de volta como chamada (`src/main/plugins/conversation.ts`).
- Numa conversa de execução a chamada leva a execução e o alvo da execução, então o documento é gravado na pasta do ciclo; em qualquer outra conversa o alvo é uma pasta vazia própria e nada é escrito (o campo novo `documents: false` corta a gravação).
- O contrato de permissão continua o mesmo: sem a rede, o pedido abre em Ações e a conversa diz que espera; permitido ali, a resposta chega; uma escrita irreversível é anunciada antes de sair; uma pasta de teste recusa antes de qualquer pedido.
- A recusa por estar desligado, por ter a declaração recusada ou por faltar ajuste obrigatório chega à conversa com o motivo, e um comando que nenhum plugin atende recebe uma linha só.
- O telefone pareado pode permitir o pedido que a chamada de conversa abriu, e o serviço recusa um pedido dos quatro momentos do ciclo respondido pelo navegador (`src/main/plugins/module.ts`, canal aberto em `src/main/webPolicy.ts`).

## O que ficou fora

Nada do diff ficou sem leitura. O que não foi exercitado: o aplicativo em funcionamento (nenhum critério de aceite rodou), o documento real gravado pela combinação execução, sandbox e busca na web, a permissão em Ações contra uma instância de busca verdadeira, e os botões na tela do telefone (o repositório não tem teste de componente).

## Achados

Nenhum achado bloqueia. Quatro sugestões, na conversa da issue.
