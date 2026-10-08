# A etapa que roda no computador guarda a comprovação do que produziu

## O que muda para quem usa

Hoje, uma etapa cujo agente roda comandos no computador (`shell: host`) termina sem
nenhuma comprovação: o que o agente produziu para testar uma interface (capturas, traces,
relatórios) vive numa pasta temporária que o app apaga ao encerrar a etapa, e o agente nem
recebe as ferramentas que guardariam esses arquivos. A execução fica com "No evidence in
this stage", os cenários que dependiam dela voltam como só leitura e nada chega ao host de
código.

Depois desta mudança, quando a etapa de host testa uma interface:

- o agente vê e usa as mesmas duas ferramentas de comprovação que uma etapa com sandbox
  (`SaveEvidence` para guardar um arquivo e `AnnotateImage` para marcar uma imagem);
- o que ele guarda aparece na execução, com id (`ev-1`, `ev-2`…), e um cenário de QA pode
  citar esse id;
- um caminho fora da pasta de saída daquela etapa é recusado, do mesmo jeito que numa
  sandbox;
- uma imagem que o agente abriu e não guardou é guardada como comprovação da etapa antes de
  a pasta sumir (o que não puder ser guardado é dito, com o motivo) — tanto para uma etapa
  com sandbox quanto para a de host, que hoje não guarda nada;
- o que a etapa recebe na descrição da ferramenta passa a nomear a pasta real daquela etapa,
  em vez de um caminho que só existe dentro da sandbox.

Uma etapa de host que não testa interface nenhuma continua exatamente como hoje: nenhuma
pasta de saída é criada, nenhuma ferramenta de comprovação é oferecida e nada muda na
descrição da ferramenta de imagem.

## Regras

1. Uma sessão de host que testa uma interface passa a ter uma pasta de saída própria, e essa
   pasta é a raiz de leitura da comprovação da etapa: um arquivo só pode ser guardado ou
   marcado se estiver dentro dela.
2. `SaveEvidence` e `AnnotateImage` são oferecidas à etapa de host que testa uma interface,
   com as mesmas regras de uma etapa com sandbox: sem `..`, sem link (nem no caminho nem no
   arquivo), tipo lido dos bytes (nunca do nome), teto de tamanho igual, ids `ev-<n>` com o
   mesmo contador da execução.
3. Um caminho fora da pasta de saída do host é recusado, como numa sandbox; a recusa é dita
   com o mesmo motivo que a sandbox usa.
4. A etapa de host recebe a mesma explicação sobre `SaveEvidence` e sobre citar ids que uma
   etapa com sandbox recebe.
5. O tratamento que a #142 acrescenta para imagens vistas e não guardadas roda também para
   uma etapa de host, **antes** de a pasta temporária da sessão ser removida: a imagem é
   guardada como comprovação da etapa, ou é dita como vista e não guardada, com o motivo.
6. Uma etapa de host sem teste de interface (sem pasta de saída) continua como hoje: nenhuma
   pasta, nenhuma ferramenta de comprovação, nenhuma mudança na descrição da ferramenta de
   imagem.
7. As comprovações guardadas por uma etapa de host seguem a escolha do espaço de trabalho de
   onde a comprovação fica (só nos dados do app, ou também na pasta do ciclo e no commit da
   etapa), como as de uma sandbox. Uma cópia que entra no commit precisa estar na pasta de
   comprovações do ciclo.
8. O texto novo que ensina as regras de comprovação e o texto de saída da etapa de host
   entram nos dois catálogos de idioma.

## Decisões de produto (as duas que estavam abertas)

### D1 — Qual pasta é a raiz da leitura da comprovação numa etapa de host

**Decisão:** a comprovação de uma etapa de host é lida da própria pasta de saída que a sessão
cria para ela — a mesma pasta que as ferramentas e o `ViewImage` já conhecem —, e não de uma
pasta de etapa nova criada só para isso.

Motivos:

- É a pasta que o prompt já apresenta à etapa (a que o agente recebe em `COXIA_OUT`), então
  o que o agente vê e o que o app lê são o mesmo lugar, sem um segundo caminho para o agente
  explicar ou alcançar.
- Uma etapa de host que não testa interface não cria pasta nenhuma: a pasta continua a nascer
  só junto com os navegadores ou com a tela virtual, e a regra 6 se cumpre sem exceção.
- A pasta temporária da sessão é apagada quando ela fecha; a comprovação que ficou só lá é
  guardada antes disso (regra 5). A pasta temporária não é a raiz da leitura, é a origem de
  onde se guarda.
- O mesmo contador de ids e a mesma regra de caminho valem para os dois modos, porque os dois
  passam a resolver o caminho contra a pasta de saída que a sessão declarar.

**Fora da decisão:** uma etapa de host cujo agente queira guardar algo que produziu fora da
pasta de saída (um arquivo na pasta de trabalho, por exemplo) continua sem poder guardá-lo
pela ferramenta; a etapa pode mover o arquivo para a pasta de saída antes, como hoje.

### D2 — O que conta como "testar uma interface" numa etapa de host

**Decisão:** uma etapa de host "testa uma interface" quando ela liga pelo menos uma das duas
chaves que o produto de hoje entende como teste de interface: a pasta de navegadores
disponível para a etapa, ou a tela virtual pedida para a etapa de QA. É exatamente a
condição que hoje faz a pasta de saída nascer; nada de novo é acrescentado a ela.

Motivos:

- A issue fixa o resultado ("uma etapa de host sem teste de interface, sem pasta de saída,
  continua como hoje") e não fixa o critério; manter o critério atual é o caminho que não
  muda o que já funciona.
- Hoje a pasta de saída só nasce com navegadores ou tela virtual ligados, e é isso que faz
  uma etapa de host ter "interface para testar": ligar a pasta sem nenhuma das duas daria a
  uma etapa que hoje não testa nada uma ferramenta a mais e um texto a mais, mudando o que
  ela recebe sem que ninguém tenha pedido para testar.
- Com isso, uma etapa de host sem as duas chaves continua com a descrição de hoje,
  e uma etapa com pelo menos uma delas passa a receber a ferramenta de comprovação e o texto
  novo — o mesmo que uma etapa com sandbox.

**Consequência aceita:** numa máquina com "Virtual display for QA" desligado e nenhuma pasta
de navegadores, uma etapa de QA de host nunca tem pasta de saída, então nunca guarda
comprovação — como hoje. Quem quiser comprovação numa etapa de host liga uma das duas
chaves.

## Fora do escopo

- Como o app decide se uma etapa "testa uma interface" a partir de outra coisa que não as
  duas chaves de hoje (o agente dizer que vai testar, o texto do pedido da etapa, um
  marcador novo).
- Uma pasta de saída permanente por etapa para o modo host (uma pasta que sobreviva ao fim da
  etapa independentemente das ferramentas).
- Mudar o layout ou o nome dos arquivos já guardados, ou o contador de ids de uma execução.
- Mudar as regras de uma etapa com sandbox: elas continuam valendo como estão; o que entra é
  a etapa de host passar a valer igual.
- Levar para o host as outras facilidades de uma etapa com sandbox que não são comprovação
  (por exemplo, receber um arquivo do app).
- A nota de lançamento da mudança: ela entra em `CHANGELOG.md`, sob `## [Unreleased]`, na
  etapa que implementa ou no fecho do ciclo — não é documento deste refino.
- Ligar ou desligar, por padrão, as duas chaves do teste de interface: elas continuam como
  estão.

## Critérios de aceite

Cada um diz o que fazer e o que se vê. Onde está dito "coberto por teste", o critério exige
um teste automatizado.

1. **Uma etapa de host que testa uma interface guarda comprovação.**
   Numa etapa de host com navegadores ou tela virtual ligados, o agente guarda um arquivo que
   ele produziu na pasta de saída. Vê-se: a comprovação aparece na execução com id
   (`ev-1`…), com o tipo lido dos bytes, e a etapa pode citar esse id no que responde.
   Coberto por teste: o arquivo guardado aparece na execução e um cenário pode citá-lo.

2. **A ferramenta de comprovação recusa um caminho fora da pasta de saída do host.**
   Numa etapa de host com teste de interface, o agente pede para guardar um arquivo de fora
   da pasta de saída (um caminho absoluto fora dela, um caminho com `..`, ou um link).
   Vê-se: a recusa, com o motivo, sem que nada seja guardado — a mesma recusa que uma etapa
   com sandbox dá para o mesmo caso. Coberto por teste.

3. **O que foi visto e não guardado não se perde no host.**
   Numa etapa de host com teste de interface, o agente abre uma imagem da pasta de saída e
   não a guarda. Vê-se: ao fim da etapa, a imagem está guardada como comprovação da etapa
   (ou, quando não pôde ser guardada, aparece na conversa da execução o motivo), e isso
   acontece antes de a pasta temporária da sessão ser removida. Coberto por teste.

4. **Uma etapa de host sem teste de interface continua como hoje.**
   Numa etapa de host sem navegadores e sem tela virtual ligados, o agente roda comandos.
   Vê-se: nenhuma pasta de saída é criada, `SaveEvidence`/`AnnotateImage` não são oferecidas,
   e o texto que a etapa recebe não menciona comprovação nem a pasta de saída. Coberto por
   teste.

5. **O que a etapa lê sobre a pasta de saída nomeia a pasta real.**
   Numa etapa de host com teste de interface, a descrição da ferramenta de imagem e o texto
   que a etapa recebe sobre comprovação nomeiam a pasta real daquela etapa, e não um caminho
   fixo que só existe dentro de uma sandbox. Coberto por teste.

6. **Uma etapa com sandbox não muda.**
   Numa etapa com sandbox, um passo de teste da interface (arquivo guardado a partir de
   `/coxia/out`, pergunta do texto que a etapa recebe) e as recusas de caminho continuam
   iguais ao que são hoje. Coberto por teste.

7. **As duas línguas dizem o mesmo.**
   A verificação de catálogos do repositório passa: toda chave de texto nova existe e está
   traduzida nos dois idiomas. Executável pela pessoa rodando a verificação do repositório.

8. **A mudança é contada a quem usa.**
   Ao fim da implementação, `CHANGELOG.md` tem, sob `## [Unreleased]`, a linha do que mudou
   para o usuário, sem referência interna (sem número de issue, sem nome de arquivo ou
   função). Executável a olho.

## Perguntas em aberto

Nenhuma bloqueante. Duas coisas não foram verificadas e não viram afirmação:

- O comportamento do modo host não foi exercitado por quem escreveu esta especificação (nem
  execução, nem tela, nem comando); tudo o que está dito como existente foi lido no código
  desta cópia, e o que a especificação pede é o que **deve** acontecer, não o que foi visto
  acontecer.
- O caminho de uma etapa de host que roda **de novo** sobre uma comprovação já guardada não
  foi lido. Uma etapa de host que roda de novo continua abrindo uma sessão nova (a pasta de
  saída dela é nova e temporária); o que precisa valer é que ela receba as mesmas
  ferramentas, os mesmos ids por execução e o mesmo tratamento de fecho, exatamente como uma
  etapa com sandbox que roda de novo.
- A #142 precisa estar mesclada antes desta mudança, porque as duas mexem no mesmo ponto do
  executor; se a #142 não estiver na base, a implementação precisa dizer isso e não pode
  tratar o host como um caso à parte dela.
