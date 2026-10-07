# Revisão: a plataforma carrega plugins, mas a permissão concedida não chega ao uso e o resultado de um plugin não chega ao ciclo

## O que foi revisado

O código desta árvore de trabalho, contra a spec (`1_SPEC.md`), o plano (`2_PLAN.md`), as regras de fronteira do squad (a porta única de escrita externa, a sandbox por etapa, o que o navegador pareado pode chamar e a migração de configuração) e a decisão da pessoa que fechou o contrato de permissão: um plugin pode pedir escrita e pedir rede, e o pedido é dela; o que ela permite vale até ser retirado, e continua valendo quando o plugin é religado.

Lido nesta etapa, com os pontos de chamada: a seção `plugins` da configuração e o degrau 12→13 (`migrations.ts:265-269`, ligado em `STEPS`); a leitura e a validação da declaração; o serviço (`src/main/plugins/module.ts`, `read.ts`, `runtime.ts`); a abertura da sandbox por etapa (`executor.ts:233-275`, `sandbox/index.ts:168-206`, `sandbox/policy.ts`); a porta única de Ações (`actions.ts:383`, `:490-554`, `:1136-1159`); a fonte que o gate ganhou (`gate.ts:102-121`); a política do navegador pareado (`webPolicy.ts:11,21,52-65`); o disparo dos quatro acontecimentos (`runner/service.ts:350-357`, `:375-377`, `:511`, `:810`; `runner/module.ts:109`); o exemplo do kit (`docs/plugins/example-web-search/search.sh`); e a leitura e a escrita de documentos do ciclo (`cycleFolder.ts:76-90`, `:133-138`).

Portões: não foram reexecutados nesta passada. O resultado citado é o da execução anterior desta revisão nesta mesma árvore. Nada foi aberto em tela e nenhum plugin de verdade rodou.

## O que a mudança entrega de verdade

- A seção `plugins` (esquema 13) existe, com o espelho no esquema, o valor neutro e o degrau que só escreve a seção vazia quando falta; um arquivo sem plugins continua abrindo.
- A declaração é lida e validada por uma função pura, com recusa e motivo por defeito, sem carregador nativo.
- O catálogo de acontecimentos é fixo e separado do canal de interface, e os quatro acontecimentos são disparados no lugar onde já acontecem, com um gancho que lança sem derrubar a execução.
- O script do plugin roda pela mesma abertura de sandbox que a etapa usa, com a política do espaço de trabalho e nos mesmos modos.
- O pedido de escrita entra na mesma lista de Ações e espera o "sim"; num espaço de trabalho de teste é recusado sem ser registrado.
- O tipo de documento que um plugin declara aparece na pasta da execução e é somado à lista que o gate percorre, sem tocar no leitor dos tipos de hoje.

O que segue reprovado vem de o serviço **ler** o que a pessoa decidiu, mas nenhum ponto de uso **consultar** o que ela concedeu, e de o resultado de um plugin não ter um caminho de volta para o ciclo.

## O que impede a entrega de estar de pé

1. **A concessão de rede nunca é consultada.** A sandbox de um plugin recebe o `runner.sandbox` do espaço de trabalho como ele está (`runtime.ts:41-46`); a lista de destinos que o plugin declarou não é somada a ela, e o valor que a pessoa concedeu é gravado, listado e não lido em nenhum ponto de execução. Conceder rede a um plugin, hoje, não muda nada do que ele alcança.
2. **A concessão de escrita nunca é consultada.** O pedido entra na porta única sempre que o plugin imprime algo, qualquer que seja a decisão da pessoa; e a aprovação carimba o pedido como aprovado e auditado sem que nada seja escrito, o que é uma linha de auditoria sobre um efeito que não aconteceu.
3. **Nada liga o resultado de um plugin ao ciclo.** O texto que volta da sandbox é guardado em memória e o aplicativo não o aplica em lugar nenhum; nenhum caminho do aplicativo escreve um documento de plugin na pasta da execução.
4. **A lista que o gate ganhou aponta para uma pasta que não tem os arquivos.** Ela procura os nomes declarados na raiz da pasta do ciclo, e o documento que aparece ali está dentro de uma subpasta.
5. **A importação de configuração apaga as escolhas dos plugins.** A lista é reescrita a partir do disco a cada gravação; o espaço de trabalho que não é o que está aberto tem a pasta de plugins no diretório de dados e não a dele, então a lista sai vazia, e um trabalho qualquer do aplicativo que grave a configuração basta para o interruptor parecer não valer.
6. **A fronteira do navegador pareado é aberta por omissão.** A política só fecha o que está em listas conhecidas e qualquer outro canal é permitido — inclusive um canal que existe e não foi classificado. Um dos canais que decidem as escritas externas cai nessa omissão.
7. **O pedido de escrita não é representado na tela.** Só o registro de auditoria ganhou rótulo; o pedido aparece na lista de Ações sem resumo, sem frase de "o que vai acontecer" e sem distinção de um conflito.

## O que a resposta da pessoa acrescenta ao contrato

- **A permissão é durável e sobrevive ao religar.** Não há "uma vez" nem "só na sessão" como valores a mais na lista: o que é concedido é durável até ser retirado, e desligar e religar um plugin não a apaga. Um estado com prazo só se justifica para o pedido que ainda espera resposta, não para o que já foi concedido.
- **Um pedido que não é reversível não pode ser usado sem estar na lista de permissões**, e a pessoa pode acrescentá-lo no momento em que o plugin pede; pedidos desse tipo precisam de um intervalo de aviso antes de executar, e nesse intervalo ela pode bloquear ou retirar.
- **O plugin pede enquanto não for permitido**, então a recusa não pode virar um pedido novo a cada acontecimento observado: a lista precisa dizer uma vez que aquela escrita não está autorizada.
- O que a resposta descreve é um pedido que a pessoa vê antes de o efeito acontecer, com prazo e possibilidade de retirada; a entrega de hoje não tem nenhuma dessas peças.

## O que não foi verificado

- O aplicativo em tela: nenhuma parte desta revisão abriu a janela, ligou um plugin ou viu a lista; a ausência de tela vem da leitura do renderer.
- Um plugin de verdade rodando numa sandbox real, e o comportamento no macOS e no Windows: os testes usam uma sandbox falsa e só o caminho puro é comum.
- A execução completa de um ciclo com um plugin ligado, do acontecimento até um documento na pasta e uma proposta na porta única.
- O disparo real chegando ao serviço de plugins a partir do módulo do runner.
- Os portões nesta passada: não foram reexecutados.
- As duas perguntas que o registro da issue deixou em aberto continuam sem resposta e não foram reabertas: quais são "os outros itens" que dependem desta plataforma, e o que este espaço de trabalho considera "permissão explícita" de um plugin para projetos e pastas do host.
