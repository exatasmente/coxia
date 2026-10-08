# O que uma etapa de QA diz que rodou precisa ter respaldo, e o que ela olhou não pode sumir em silêncio

## O que se pede

A issue relata, nas palavras de quem a abriu:

> A QA stage with a sandbox (and a virtual display) can end as "pass" without keeping a single piece of evidence, and nothing tells the agent or the person.
>
> Seen in a real run: the QA agent opened the app on the virtual display, took about a dozen screenshots in `/coxia/out` and looked at each one with `ViewImage`, but never called `SaveEvidence`. Then:
>
> - Its output came with `evidence: []`, and five scenarios marked `executed` with no `commands` and no `evidenceIds`.
> - `backEvidence` turned those scenarios into `read` in the run's record, without telling the agent.
> - The `5_TEST_PLAN.md` and the comment published on the issue still said "passed (executed)" and "checked with the app open in a window", because they come from the agent's own text.
> - The stage folder was removed with the sandbox, so every screenshot was lost. The run screen shows "No evidence in this stage", and nothing reached the code host.

O que deveria acontecer, citado:

> 1. **A claim of execution needs backing.** When a QA stage with a sandbox answers a scenario as `executed` with no command of its own and no evidence id, the answer goes back to the agent for one repair round, as a text outside the schema already does. The agent then keeps the evidence (or cites the commands), or turns the scenario into `read` / `not-run` itself. Only after that round does the app downgrade on its own, and the stage says so in the run's conversation.
> 2. **What is published matches the record.** The test plan written to the cycle folder and the QA comment reflect the scenario results the app recorded (after `backEvidence`), not the agent's text when they differ. A scenario the app downgraded reads as "read" in both.
> 3. **What the agent looked at is not lost silently.** An image in the output folder that the agent opened with `ViewImage` and did not keep is either kept automatically as evidence when the stage concludes, or listed in the run's conversation as "looked at, not kept" before the sandbox is removed. Pick one in the spec and say why.

A aceitação, citada:

> - A QA output with an `executed` scenario and neither commands nor evidence ids gets one repair round; a test covers the round and the downgrade after it.
> - The written `5_TEST_PLAN.md` and the QA comment never call a scenario executed when the run's record says `read`; a test covers it.
> - A QA stage whose agent viewed images in `/coxia/out` without keeping them ends with them kept or reported, never with nothing; a test covers it.
> - Stages without a sandbox behave as today.

## O que muda para quem usa

- Quando uma etapa de QA afirma ter executado um cenário e não aponta nem o comando que fez isso nem uma comprovação guardada, a resposta volta uma vez ao agente da própria etapa, com o motivo, antes de a etapa terminar. O agente tem uma volta para guardar o que viu, apontar o comando que rodou, ou assumir que o cenário foi só lido.
- Se ele não resolver naquela volta, a etapa continua e o registro passa a dizer que aquele cenário foi apenas lido, com a linha que hoje aparece no comentário dizendo que ele foi afirmado como executado sem respaldo. A conversa da execução ganha uma linha dizendo, na hora, qual cenário caiu e por quê. A reprovação da etapa fica como sempre foi: só um cenário que falha manda o trabalho de volta.
- O plano de teste gravado na pasta do ciclo e o comentário que a QA deixa na issue deixam de repetir o que o agente escreveu quando o registro diz outra coisa: os dois passam a dizer, cenário por cenário, o resultado que a execução gravou e como ele foi checado. Um cenário rebaixado aparece como lido nos dois, nunca como executado.
- Uma imagem que o agente abriu e não guardou é guardada pelo app como comprovação da etapa, na hora de a etapa concluir e antes de a pasta da etapa ser apagada: ela aparece na conversa da execução e na tela da etapa, com um título que diz que foi guardada pelo app. Um arquivo que o app não consegue guardar (não é imagem ou passa do teto) aparece na conversa como "visto, não guardado", com o motivo, para o que foi olhado não sumir sem uma palavra.
- Os cenários de uma etapa de QA sem sandbox continuam como hoje: só lidos, sem nenhuma rodada extra.

## Regras

### 1. A rodada de reparo de um cenário sem respaldo

1. **Quando ela acontece.** Numa etapa de QA que tem sandbox, depois de a resposta chegar e de o app conferir os cenários contra o que a sandbox da etapa rodou, se ao menos um cenário ficou como sem respaldo — afirmado como executado e registrado como lido por não citar um comando que o sustente — o app pede ao agente **uma** rodada de reparo antes de aplicar a transição da etapa.
2. **O que o app pergunta.** A rodada diz qual cenário caiu, que ele foi afirmado como executado sem um comando que o sustente, e quais saídas o agente tem. Ela é uma conversa a mais com o mesmo agente da etapa, dentro da mesma etapa e da mesma tentativa, e não uma etapa nova. As ferramentas da etapa continuam à mão do agente: ele ainda pode rodar o que precisar na sandbox e ainda pode guardar comprovação.
3. **O que o agente pode responder.** Para cada cenário sem respaldo: guardar a comprovação que faltava e apontar o comando que o sustenta; ou apontar o comando que sustenta; ou assumir que o cenário foi apenas lido; ou assumir que não chegou a rodar, e o cenário passa a não executado. A resposta inteira volta na mesma forma, com `summary`, `artifacts` (o plano de teste entre eles) e `comment`, para o que for gravado e publicado já sair da rodada de reparo.
4. **Uma rodada, não duas.** A etapa pede no máximo uma rodada de reparo dessas. Uma segunda leva de cenários sem respaldo, depois dela, é rebaixada sem nova pergunta: a etapa não pode girar.
5. **O rebaixamento, depois e dito.** O rebaixamento só acontece depois da rodada: um cenário que continue afirmado como executado sem um comando que o sustente é gravado como lido, com a marca que já existe de afirmado sem respaldo. O registro, o plano de teste gravado, o comentário e a linha na conversa saem todos de um mesmo resultado: depois da rodada de reparo e das conferências que o app já faz.
6. **A conversa diz.** A conversa da execução ganha uma linha, na hora, dizendo qual cenário foi afirmado como executado e não se sustenta, e que passou a ser lido. Um cenário que a rodada de reparo resolveu não gera essa linha do rebaixamento; o que o agente guardou ou o comando que ele apontou já aparecem na própria conversa, como acontece hoje.
7. **A aprovação não muda.** Um cenário rebaixado **não** reprova a etapa nem manda o trabalho de volta; ele fica visível como lido e sem respaldo. A etapa é reprovada por um cenário que falha e cuja severidade manda o trabalho de volta, como hoje. Por que não tratar como pendência: o padrão que escolhe mandar de volta já existe e é a severidade do cenário; fazer o rebaixamento reprovar mudaria o que a etapa significa e poderia travar uma entrega por um erro de anotação no fim do run. O que a mudança garante é que ninguém, nem o agente nem a pessoa, fique sem saber.
8. **Uma etapa, no fim.** A rodada de reparo acontece dentro da mesma etapa, sem novo registro de etapa, sem consumir rodada do limite de devolução e sem contar como tentativa nova. Ela tem o mesmo teto de tempo da etapa (o teto de relógio da etapa vale para a etapa toda, rodada de reparo incluída) e a mesma sandbox, que só é fechada quando a etapa termina.
9. **Etapa sem sandbox não muda.** Sem sandbox, todo cenário é lido e nenhuma rodada de reparo é pedida; o comportamento é o de hoje. Vale também para uma etapa de QA que não tem sandbox e uma que não pôde abrir a sua.
10. **A falha da etapa continua como é.** Uma etapa que falha por outro motivo (o agente não respondeu, acabou o tempo, o teto de passos) não entra em rodada de reparo e falha como hoje.

### 2. O que é publicado passa a bater com o registro

11. **A fonte da verdade.** O que o registro da execução tem dos cenários vale sobre o texto do agente: o resultado de cada cenário (**passou / falhou / não rodou**) e a marca de como ele foi checado (executado ou lido), depois das conferências. Em nenhum caso o executado aparece por causa de uma comprovação guardada: citar comprovação não faz um cenário valer como executado, como já é hoje.
12. **O plano de teste.** O `5_TEST_PLAN.md` gravado na pasta do ciclo passa a trazer, para cada cenário, o resultado e a marca de como ele foi checado, tirados do registro: um cenário rebaixado aparece como lido, um cenário assumido pelo agente como não rodado aparece como não rodado. O plano continua sendo um documento do agente: as outras seções que ele escrever ficam como ele escreveu.
13. **O comentário.** O comentário que a QA deixa na issue também passa a refletir o registro: o status dele (aprovado, aprovado com ressalvas, parcial, reprovado) e a lista de cenários que acompanha o comentário saem dos cenários gravados, e não do texto do agente. Um cenário rebaixado nunca é chamado de executado no comentário.
14. **O registro é um só.** O que se grava na execução, o que se escreve no plano de teste e o que vai no comentário são o mesmo conjunto de cenários, calculado uma vez. Não há duas contas diferentes para a mesma coisa.
15. **As palavras são do agente.** O que o agente escreveu sobre o que fez e o que viu continua sendo dele, e não é reescrito; o que passa a vir do registro é o resultado de cada cenário e a marca de como foi checado. Uma seção do padrão de comentário que fale dos cenários executados também passa a dizer só o que o registro sustenta.

### 3. O que o agente olhou e não guardou

16. **A escolha, e por quê.** A imagem que o agente abriu com `ViewImage` e não guardou é **guardada automaticamente** pelo app como comprovação da etapa, no fecho dela e antes de a pasta da etapa ser apagada. A outra opção (apenas listar "visto, não guardado") perde exatamente o que a issue relata: o que o agente olhou some com a etapa, o cenário fica sem comprovação e a pessoa não consegue abrir nem baixar aquela imagem. Guardar é a única das duas que faz a imagem continuar acessível depois que a etapa termina.
17. **Quando.** No fecho da etapa, depois de a resposta do agente chegar e antes de a sandbox da etapa ser removida — a partir da rodada de reparo, quando há uma, para que a comprovação guardada no fecho seja a da resposta que fica registrada. A comprovação assim guardada é da etapa e é publicada na conversa da execução na hora, como qualquer outra.
18. **O que é elegível.** Só o que o agente abriu com `ViewImage` e é um arquivo **de imagem** da pasta de saída da etapa: PNG, JPEG, GIF ou WebP (o tipo é lido do conteúdo, nunca do nome), no teto de tamanho que a comprovação já tem. Imagem que o agente já guardou não é guardada duas vezes. Vale para imagem da pasta de saída e para uma imagem que já é comprovação da etapa.
19. **Como ela é identificada.** Cada comprovação guardada assim leva um título que diz que foi guardada pelo app, e que foi aberta pelo agente durante a etapa; se a ferramenta com que o agente olhou trouxe um texto, ele entra na descrição. A comprovação é um registro comum da execução, com um id como os outros, que o cenário e a saída podem citar.
20. **Quando a guarda não dá certo.** O que o agente abriu e não pôde ser guardado — um texto, um arquivo de outro tipo, uma imagem acima do teto, um registro de comprovação que já não está lá — aparece na conversa da execução como "visto, não guardado", com o motivo, antes de a sandbox ser removida. Nada do que o agente abriu some sem uma linha.
21. **Uma linha para quem olhou.** Quando há imagem guardada no fecho, a conversa da execução diz quantas foram guardadas; quando não há nada a guardar, nenhuma linha é escrita. A linha não é publicada no host de código por si.

### 4. O que continua igual

22. **O que já acontece e continua.** Ver uma imagem deixa a imagem aberta para o agente e não a guarda na hora; guardar continua sendo um pedido do agente; a etapa continua terminando como sempre (a conversa, o commit dos documentos, a transição pelas severidades); a comprovação continua sendo publicada na hora e continua sendo lida da pasta de saída da etapa, nunca de um caminho de fora; e a publicação na conversa continua sendo um registro da execução, sem ir ao host de código por si.
23. **O que continua valendo como comprovação.** As formas aceitas (as imagens do item 18, o texto simples e o PDF), o teto de tamanho, o identificador com a forma `ev-` mais algarismos, onde a comprovação fica guardada (o padrão, só nos dados do app, ou também na pasta do ciclo) e o envio dela ao host de código quando alguém a cita: nada disso muda aqui. Citar uma comprovação nunca faz um cenário valer como executado.

## Fora do escopo

- Ler de volta o texto de dentro de uma imagem, ou adivinhar o que ela mostra para escrever sozinho no plano de teste ou no comentário: o registro de um cenário passa a vir do agente, e só.
- Guardar automaticamente qualquer arquivo da pasta de saída que não seja imagem, ou qualquer arquivo que a etapa não tenha aberto: a varredura do fecho é só do que o agente abriu pelo caminho de imagem.
- Transformar o rebaixamento em reprovação da etapa ou em pendência que trave a entrega: um cenário rebaixado fica visível como lido e sem respaldo, e a etapa continua com o resultado que ela já tinha.
- Tirar o agente da decisão: o agente é quem diz o resultado de cada cenário; a rodada de reparo existe para ele mesmo consertar a anotação, não para o app adivinhar.
- Apagar ou mudar o que já foi publicado no host de código.
- Mudar o que é aceito como comprovação, o teto de tamanho, onde ela fica guardada, ou o envio dela ao host: nada disso muda aqui.
- Mudar o comportamento de uma etapa de QA sem sandbox.

## Aceitação

Cada item é algo que uma pessoa consegue conferir.

1. Numa etapa de QA com sandbox, uma resposta com um cenário afirmado como executado e sem nenhum comando que o sustente faz a etapa pedir **uma** volta ao agente, e a conversa mostra o pedido e a resposta.
2. Naquela volta, o agente guarda a comprovação e aponta o comando: o cenário fica executado no registro, o plano de teste e o comentário dizem o mesmo, e nada é rebaixado.
3. Naquela volta, o agente assume que o cenário foi só lido: o registro, o plano de teste gravado e o comentário dizem lido nos três, e a conversa diz por quê.
4. Se o agente não resolver na volta, o cenário é gravado como lido e sem respaldo, o plano de teste e o comentário não o chamam de executado, e a conversa da execução tem a linha do rebaixamento.
5. Um cenário rebaixado não manda o trabalho de volta nem reprova a etapa; um cenário que falha e cuja severidade manda, sim, como hoje.
6. Os cenários de uma etapa de QA sem sandbox continuam todos como lidos e nenhuma volta extra é pedida.
7. Numa etapa de QA com sandbox, uma imagem aberta pelo agente e não guardada termina guardada como comprovação da etapa, visível na conversa e na tela da etapa, com o título que diz que foi guardada pelo app.
8. Uma imagem aberta acima do teto, um arquivo que não é imagem e uma imagem cuja comprovação já não está lá terminam como "visto, não guardado" na conversa, com o motivo.
9. Uma imagem que o agente guardou durante a etapa não é guardada uma segunda vez no fecho.
10. Uma resposta com três cenários executados sem respaldo faz a etapa pedir uma volta só, e um cenário que volte sem respaldo é rebaixado sem nova pergunta.
11. O plano de teste gravado na pasta do ciclo nunca chama de executado um cenário que o registro tem como lido, e um cenário que o agente assumiu como não rodado aparece como não rodado.

## O que esta etapa não verificou

Esta etapa é de refinamento: leu a issue, a triagem e o código citado, e **não executou nada** — nenhum comando foi rodado, nenhuma tela foi aberta e nenhum run foi reproduzido. Toda afirmação sobre o que existe hoje vem de leitura do código nesta cópia de trabalho; o que não foi lido está dito como não verificado.

O que foi conferido por leitura, contra o código de hoje:

- O app rebaixa sozinho: um cenário afirmado como executado só se sustenta citando um comando da própria etapa, e a passagem precisa de um comando que terminou com código de saída 0; sem comando, ele é gravado como lido e recebe a marca de sem respaldo, e nada disso avisa o agente nem escreve uma linha na conversa.
- A resposta da etapa é lida uma vez só: depois da conferência dos cenários o app escreve os documentos, faz o commit e aplica a transição. Não existe hoje nenhuma segunda chamada ao modelo por causa do conteúdo da resposta; a única volta que existe é de formato, no motor aberto, e para a resposta que não segue o formato.
- O plano de teste é gravado como o agente o escreveu, e o comentário é montado a partir do texto que o agente mandou, com o resumo como reserva; o comentário de QA acrescenta um bloco sobre os cenários executados e os sem respaldo, e um bloco dos cenários que falharam sem bloquear, sem reescrever o texto do agente.
- Guardar comprovação é uma chamada separada de ver a imagem: ver devolve a imagem ao agente e não guarda nada; guardar lê o arquivo da pasta de saída da etapa, confere o tipo pelo conteúdo, respeita um teto de tamanho e grava a comprovação com um id compatível com "ev-" seguido de algarismos. Também foi lido que apagar uma comprovação é ação da pessoa, nunca de um agente.
- A pasta da etapa é apagada quando a sandbox da etapa é fechada, e o fecho acontece antes de o app ler ou commitar qualquer coisa da etapa; uma imagem olhada e não guardada não tem hoje nenhum outro caminho para sobreviver.
- A etapa de QA sem sandbox tem todos os cenários gravados como lidos, e a rodada de reparo que a issue pede não existe para ela hoje.
- A comprovação guardada pode ser publicada na conversa da execução, e uma imagem aberta como comprovação de outra etapa ou um identificador inexistente é recusado com o motivo.

O que esta etapa **não** verificou, e que planejamento e desenvolvimento precisam conferir no código antes de contar com isso:

- Se o ciclo de vida da sandbox da etapa permite uma segunda chamada ao agente dentro dela. O que foi lido é que a sandbox é fechada quando a etapa termina, e que a etapa termina depois de uma resposta; não foi lido o caminho que faria uma segunda chamada caber ali, nem como o teto de silêncio e o teto de relógio da etapa contam esse tempo.
- Se o cabeçalho de um documento de etapa (o título e a primeira lista, que o app normaliza para o documento não repetir a referência, o título e o endereço da issue) pode engolir uma lista de cenários escrita logo abaixo do título. Não verificado.
- Se a imagem que o agente olhou de fato passa por um caminho que a torne recuperável no fecho da etapa. Não foi lido um registro de cada imagem que o agente abriu com a ferramenta que mostra uma imagem da pasta de saída; se esse registro não existir, ele é trabalho a fazer antes de a guarda automática valer. É a parte de maior risco desta entrega.
- Se o motor aberto e o motor do outro lado devolvem ao executor um ponto onde uma segunda chamada ao agente cabe com o mesmo conjunto de ferramentas e a mesma sandbox.
- Se a linha de "visto, não guardado" e a linha do rebaixamento são textos novos a criar no catálogo, em quais chaves, e se algum teste de catálogo trava a lista.
- Quantas leituras diferentes da pasta de saída da etapa existem (a ferramenta que mostra a imagem e a que guarda), e se a automática repete a mesma conferência de caminho, de link e de tamanho.
- Nada disto foi exercitado; nenhum host, modelo ou sandbox real foi usado nesta etapa.

## Perguntas em aberto

1. **Como o app sabe qual imagem o agente olhou.** A guarda automática do fecho depende de o app saber quais imagens da pasta de saída passaram pela ferramenta que mostra uma imagem. Se isso só puder ser sabido por um registro que a ferramenta deixe, é uma linha a mais no ciclo da etapa; se tiver de sair do conteúdo do arquivo, uma imagem enorme ou repetida muda o custo e o comportamento. É decisão de projeto, a confirmar no plano, e a spec fixa o resultado ("guardada ou dita como vista e não guardada, nunca em silêncio"), não o meio.

## Se algo aqui se revelar impossível

Se a guarda automática não tiver base no ciclo de vida da etapa, a saída honesta é a outra opção da issue — dizer na conversa o que foi olhado e não guardado —, nunca deixar a imagem sumir em silêncio. É a única parte deste documento cuja mudança de rumo seria aceitável, e ela precisa ser dita na entrega.

## Prioridade e marco propostos

- **Prioridade: a mais alta dos níveis configurados** (a issue já veio com `priority:high`, e esta etapa concorda com ela; o nome exato do rótulo é o que o espaço de trabalho escreve no host). Motivo: é comportamento errado em uso real, e o que ele atinge é a confiança no registro da execução — a etapa se diz aprovada sem comprovação, o que é publicado na issue diverge do que a execução gravou, e o que o agente olhou some com a pasta da etapa. O custo é contido, nada do conserto depende de fora, e as duas partes mais visíveis (o documento, o comentário e a imagem guardada) se apoiam em capacidades que o app já tem. A prioridade final é da pessoa.
- **Marco: nenhum proposto.** A lista de marcos do rastreador não foi lida nesta etapa (`tracker: read` existe, mas esta etapa não leu o host), e nada na mudança a amarra a uma versão: é correção de comportamento, sem capacidade nova nem configuração nova. Se o espaço de trabalho tiver um marco para correções de confiança do runner, é onde ela cabe.

## Como o comentário desta etapa foi montado

As seções deste comentário para a issue saem deste documento: o que se pede cita a issue; o que muda para quem usa é a seção homônima; a aceitação são os itens da seção "Aceitação"; o que fica fora é a seção "Fora do escopo"; e as perguntas em aberto são as de baixo. O que só quem programa precisa está em "Para quem programa", no fim deste documento.

## Para quem programa

O que só quem mexe no código precisa. Nada disto foi exercitado nesta etapa: é leitura de código.

- **A rodada de reparo de um cenário sem respaldo.** É o eixo da mudança: quando a conferência dos cenários deixa pelo menos um cenário afirmado como executado e sem respaldo, o app pergunta de novo ao mesmo agente, uma vez, antes de a etapa fechar, com o mesmo conjunto de ferramentas e a mesma sandbox, e só depois grava o resultado. A escolha de onde essa pergunta cabe (dentro da etapa, entre a resposta e o fecho da sandbox, sem virar etapa nova) é do plano; a spec fixa o "uma vez" e o "antes do fecho".
- **O que hoje está lido no código:** o rebaixamento é feito na conferência dos cenários contra os comandos da etapa, com a função pura de `src/shared/runs/output.ts:204-214` chamada em `src/main/runner/executor.ts:747-752`; o resultado é usado para gravar os artefatos (linhas 758-767), para o registro da QA (`recordQa`, `src/main/runner/service.ts:693-694`) e para o comentário, através do `stageEnded` (`src/main/runner/publish.ts:599-608`).
- **Uma rodada de reparo dentro da etapa é trabalho novo.** Hoje o executor monta o prompt, chama o motor, lê a resposta, confere e escreve; a sandbox é fechada no `finally` de `runStage` (perto da linha 734) e de `executeStage` (linha 438). O que existe de reparo hoje é de formato, dentro do loop do motor aberto (`src/main/engine/open/loop.ts:460-462,543-549`), e morre ali: não há no executor um ponto que pergunte de novo nem uma mensagem do app para o agente na conversa. Não foi lido o caminho que faria a segunda chamada caber ali; ver "O que esta etapa não verificou".
- **As chaves de texto a criar:** o motivo e a saída da rodada de reparo; a linha do rebaixamento na conversa; a lista de "visto, não guardado" na conversa e o motivo de cada um; a linha de quantas imagens foram guardadas no fecho. Todas entram nas duas famílias (`main.*` e `prompt.*`) quando falarem com a pessoa ou com o agente, e passam pela conferência do comentário (`src/shared/runs/comment.ts:108-269`), que recusa, entre outras coisas, primeira pessoa, nome de ferramenta e a palavra "fórum".
- **A fonte única do que se publica.** `resultWord` (`src/main/runner/publish.ts:574-581`), `notesTail` (583-588) e `evidenceTail` (590-597) já são tirados dos cenários gravados; `renderComment` (`src/shared/runs/comment.ts:56-78`) usa o texto do agente por seção, com o resumo como reserva. A mudança é o executor gravar o `5_TEST_PLAN.md` e o `comment` já normalizados a partir dos cenários gravados, e o comentário deixar de dizer executado onde o registro diz lido — inclusive na seção do padrão que fala dos cenários executados.
- **O que precisa ser corrigido na entrega, de passagem.** O comentário sobre a classificação de um comando (o do modo aplicativo) tem um erro de digitação; ele fica na mesma passagem que esta issue mexe e seria suspeito num revisor apressado. Fora isso, o comentário do módulo de comprovação fala de um teto de tamanho que difere do teto em uso nos dois módulos de comprovação, e a conferência pública isenta o arquivo que carrega esse valor por um falso positivo. Não foi lido nenhum lugar do código em uso cujo cálculo dê aquele teto; fica como ponto a limpar quando esta issue passar por ali, não como afirmação de que o comportamento está errado.
- **Onde a comprovação é guardada e publicada.** `evidenceToolsOf` monta as ferramentas com um `onKept` que o executor já usa para acumular ids e publicar (`src/main/runner/executor.ts:563-585`); a varredura do fecho reaproveita esse mesmo caminho, com um título próprio, e usa a mesma função de guarda que lê a pasta de saída (conferência de caminho, de link e de tamanho) e o mesmo módulo que decide se o arquivo é imagem.
- **O que hoje está lido sobre as ferramentas de imagem.** Ver uma imagem devolve os bytes ao agente e não guarda nada (`EvidenceTools`/`view`, em `src/main/evidence/handlers.ts:145-155`); guardar é uma chamada separada (`save`, no mesmo arquivo), e o que ela grava vem do arquivo lido da pasta de saída da etapa, com o tipo conferido pelo conteúdo e um teto de tamanho, num armazenamento com id no formato `ev-` mais algarismos.
- **Uma anotação de correção.** O documento de triagem diz que o esquema que pede a um cenário os campos de comprovação e de comandos está num trecho de linhas de um arquivo compartilhado; lido no código, esse trecho é a descrição que acompanha o esquema, e o esquema de QA monta o cenário com esses campos a partir da mesma definição. A afirmação segue verdadeira no essencial: o esquema de QA pede esses campos, e a leitura da resposta os aceita.
- **Uma referência de linha da triagem que não bate.** O achado da triagem sobre a leitura da resposta de uma etapa aponta um trecho de linhas que, no código desta cópia, é a função que lê um comentário e a descrição do pull request; a leitura da resposta inteira está mais acima no mesmo arquivo. O achado da triagem continua verdadeiro: a resposta de uma etapa de QA é lida uma vez, com os cenários e a marca de execução, e é o executor que decide o que fica gravado.
- **Testes.** Os testes de hoje do assunto são o rebaixamento sozinho (`test/runs-scenario.test.ts:126-144`); a rodada de reparo, a fidelidade do documento e do comentário e as imagens vistas e não guardadas não têm teste. É nestes arquivos, ou em um vizinho do mesmo assunto, que os testes do critério de aceite entram.
- **Regras do repositório que a entrega precisa respeitar:** a conferência pública (sem nome real, host, número de issue ou credencial em texto, código, teste, mensagem de commit ou nome de ramo); as duas famílias de catálogo e o lint de internacionalização; os testes não alcançam modelo, host nem rede, e usam os ajudantes de teste; nada de `npm run dist`; e uma mudança visível ao usuário entra no `CHANGELOG.md` sob `## [Unreleased]`.
