# O cartão da sugestão oferece em cada tela só o que ali funciona, e o caminho "Editar" segue abrindo o editor

## Veredito

Aprovado. As duas sugestões da rodada anterior foram atendidas e conferidas. O cartão da sugestão
passou a consultar se a sessão é a de um navegador pareado e, quando é, oferece somente o caminho de
aceitar; os caminhos de editar e recusar, que dependem da janela do aplicativo, deixaram de aparecer
ali. A forma do arquivo de ações voltou ao padrão do resto do arquivo. O ponto bloqueante que veio das
rodadas anteriores continua corrigido: a retro é gravada antes de as sugestões serem levantadas, e o
pedido de edição chega ao painel de agente numa só leitura, de modo que o caminho "Editar" abre o
editor já preenchido. Nenhum defeito novo apareceu no que esta rodada mudou. Segue como sugestão, não
bloqueante, a observação de que o aceite pode ser acionado pelo canal de aprovação que o navegador
pareado usa quando os efeitos externos estão liberados; é decisão de quem fecha o ciclo.

## O que foi verificado

Tudo abaixo foi conferido por leitura do código e dos documentos desta etapa; os gates foram rodados
nesta árvore e o resultado está registrado no fim.

- **A sugestão sobre a forma foi atendida.** O entorno de `suggestionHooks` e a primeira linha de
  `conflictOf`, que estavam fora do padrão, voltaram à forma do resto do arquivo. Não há mudança de
  comportamento; a verificação é de leitura.
- **A sugestão sobre o cartão no navegador pareado foi atendida.** O cartão passou a consultar a marca
  de sessão de navegador e, quando ela está presente, desenha apenas o botão de aceitar; os botões de
  editar e recusar, e o campo de motivo da recusa, deixaram de ser desenhados ali. Na janela do
  aplicativo os três caminhos continuam iguais. A restrição é a mesma que já valia para o botão do time.
- **A correção desta rodada vem com teste.** O comportamento está guardado por um teste que renderiza o
  cartão nos dois modos e confere que no navegador só o caminho de aceitar aparece, e que na janela os
  três aparecem. O teste foi rodado nesta árvore e passa; o desenvolvimento registrou que ele falha com
  a restrição desfeita.
- **O ponto bloqueante da rodada anterior segue no lugar.** A retro é gravada antes de as sugestões
  serem levantadas, de modo que a leitura do fim da retro já enxerga a retro recém-respondida; e o
  pedido de edição é reduzido a um só valor (aba, squad e rascunho) e gravado de uma vez, de modo que o
  rascunho chega ao painel de agente e o editor abre preenchido. A limpeza do pedido ao trocar de aba
  impede que ele reabra o editor depois de consumido.
- **A leitura continua pura e sem história nova.** As fontes (perguntas que chegam à pessoa, devoluções,
  achados de revisão, cenários de QA, etapas feitas à mão, linha de auditoria de comando e decisões das
  atas) são montadas sem I/O dentro da função, a partir dos arquivos que o aplicativo já grava. Nenhum
  registro novo é introduzido para alimentá-la, e a transcrição das cerimônias não é lida.
- **Sem evidência, sem sugestão; só acima do limiar o modelo é chamado.** Abaixo do limiar ou sem padrão
  repetido, nenhuma chamada de modelo é feita e a tela recebe um motivo.
- **A etapa é sempre existente.** O modelo só pode escolher entre as etapas do espaço de trabalho e o
  resultado é conferido contra essa lista antes de virar cartão; nenhum caminho cria, remove ou reordena
  etapa, e o caminho que move uma execução de fluxo não é tocado.
- **Aceitar cria um agente comum e somente leitura.** O agente nasce com permissão de leitura, sem
  comandos e sem acesso ao host, sem marca de "sugerido"; se a etapa sumiu do ciclo antes do aceite, a
  criação é recusada e a ação fica marcada como falha. O aceite não abre o editor.
- **A decisão fica registrada e a recusa não volta igual.** O registro vai para um arquivo de dados do
  espaço de trabalho, irmão do das ações, sem migração de configuração; guarda o proposto, a evidência, a
  decisão, o motivo, quem decidiu e quando, e o agente criado no aceite. A recusa guarda a impressão
  (papel + etapa + tipo de evidência) e o conjunto de evidência que viu; a mesma impressão só reaparece
  quando há ocorrência nova, e o cartão diz que já foi recusada, quando e o que mudou.
- **Os canais de decisão são só do aplicativo de mesa.** Os canais que pedem, recusam e registram edição
  seguem restritos à janela; a leitura do registro fica aberta.

## Os gates rodados nesta árvore

- A checagem de tipos não acusa erro.
- A suíte inteira passa: 216 arquivos, 3571 testes.
- A auditoria de tema não encontra cor literal nova (as oito ocorrências apontadas são as já existentes).
- A checagem de idiomas vê as mesmas 4031 chaves nos dois idiomas e nenhum texto solto.
- A auditoria pública percorre 867 arquivos e não encontra nada que pertença a empresa ou pessoa.
- O build conclui.

## Sugestões

- **O aceite continua acessível pelo canal que o navegador pareado pode usar.** A proposta espera em
Ações e o canal que executa a aprovação é o mesmo que o navegador pareado pode usar quando a pessoa libera
os efeitos externos; por esse caminho, um navegador pareado pode acionar o aceite da proposta e criar um
agente no time — trabalho local, que o desenho dizia restrito à janela. Não foi verificado por execução;
convém decidir se o aceite da sugestão deve ficar atrás da mesma restrição dos demais canais de decisão.

## O que não foi verificado

- O cartão desenhado num navegador pareado de verdade: foi conferido por render estático do componente,
que não exercita a tela nem o navegador real.
- O caminho "Editar" aberto no aplicativo, de ponta a ponta, com um clique real: foi conferido por tipos,
pelo teste do estado que o pedido produz e por leitura do código; a suíte roda sem navegador, então a tela
não foi renderizada.
- O comportamento do modelo real ao montar a sugestão; os testes usam um modelo simulado e nenhuma
chamada real foi feita.
- O volume real do histórico e o acerto do limiar medido em uso.
- A renderização do cartão numa tela de verdade e o link da evidência para a execução.
