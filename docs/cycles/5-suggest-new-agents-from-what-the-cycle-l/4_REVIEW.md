# Revisão: a sugestão de agente que nasce do histórico e espera em Ações

## Veredito

Aprovado com mudanças. O ponto que a revisão anterior apontou como bloqueante foi corrigido — no
fim da retro, a retro é gravada antes de as sugestões serem levantadas, e a retro de um squad passa
a ser encontrada —, e as duas sugestões de então também foram atendidas. A correção do pedido de
edição, porém, anulou o próprio pedido: o rascunho que devia abrir o editor preenchido é descartado
antes de chegar ao painel, de modo que o caminho "Editar" não abre nada. Esse ponto precisa de
correção antes do teste.

## O que foi verificado

Tudo abaixo foi conferido por leitura do código e dos documentos desta etapa; os gates foram
rodados nesta árvore e o resultado está registrado abaixo.

- **O ponto bloqueante anterior foi atendido.** A retro passa a ser gravada antes de as sugestões
  serem levantadas: a leitura do fim da retro já enxerga a retro que acabou de ser respondida, de
  modo que uma sugestão cuja evidência mudou com ela é comparada com o estado atual e não com o
  anterior. A busca da última retro de um squad deixou de exigir que o nome inteiro do arquivo
  coubesse no formato do dia — um arquivo de retro de squad era sempre ignorado e a leitura caía na
  retro do espaço de trabalho inteiro; agora o reconhecimento é pelo sufixo do squad. Os dois
  comportamentos ficaram guardados por teste.
- **A leitura é pura e só usa o que já existe.** As fontes (perguntas que chegam à pessoa,
  devoluções, achados de revisão, cenários de QA, etapas feitas à mão, linha de auditoria de comando
  e decisões das atas) são montadas sem I/O dentro da função, a partir dos arquivos que o aplicativo
  já grava. Nenhum registro novo é introduzido para alimentá-la, e a transcrição das cerimônias não é
  lida.
- **Sem evidência, sem sugestão.** As repetições são agrupadas e só as que passam do limiar (três
  ocorrências, em duas execuções distintas) chegam a pedir o rascunho ao modelo. Com histórico
  insuficiente, nenhuma chamada é feita e a tela recebe um motivo.
- **A etapa é sempre existente.** O modelo só pode escolher entre as etapas do workspace e o
  resultado é conferido contra essa lista antes de virar cartão. Nenhum caminho cria, remove ou
  reordena etapa, e o caminho que move uma execução de fluxo não é tocado.
- **Aceitar cria um agente comum e somente leitura.** O agente nasce com permissão de leitura, sem
  comandos e sem acesso ao host, sem marca de "sugerido"; se a etapa sumiu do ciclo antes do aceite,
  a criação é recusada e a ação fica marcada como falha. O aceite não abre o editor.
- **A decisão fica registrada.** O registro vai para um arquivo de dados do workspace, irmão do das
  ações, sem migração de configuração; guarda o proposto, a evidência, a decisão, o motivo, quem
  decidiu e quando, e o agente criado no aceite.
- **Recusa não volta igual.** A recusa guarda a impressão (papel + etapa + tipo de evidência) e o
  conjunto de evidência que viu; a mesma impressão só reaparece quando há ocorrência nova, e o cartão
  diz que já foi recusada, quando e o que mudou. Isso ficou guardado por teste.
- **A deduplicação voltou ao seu lugar.** A proposta só é deduplicada contra cartões da mesma
  sugestão ainda pendentes ou em execução; quem decide se uma sugestão já decidida pode voltar é a
  regra da recusa. Um cartão já decidido pode voltar sem deixar dois cartões iguais esperando.
- **Os canais de decisão são só do aplicativo de mesa.** Os canais que pedem, recusam e registram
  edição foram marcados como restritos à janela e o teste que fixa essa lista foi atualizado em
  conformidade; a leitura do registro fica aberta.
- **Os gates rodados nesta árvore estão verdes.** A checagem de tipos não acusa erro; a suíte
  inteira passa (214 arquivos, 3564 testes); a auditoria de tema não encontra cor literal nova; a
  checagem de idiomas vê as mesmas 4031 chaves nos dois idiomas e nenhum texto solto; a auditoria
  pública percorre 864 arquivos e não encontra nada que pertença a empresa ou pessoa.
- **Os limites com as frentes vizinhas seguem.** O gancho da retro só levanta sugestões a partir do
  que o histórico mostra; nenhuma melhoria de processo da conversa vira proposta, e nada da
  transcrição é lido.

## O que precisa de correção

**O rascunho da edição é descartado antes de abrir o editor.** Ao receber o pedido de edição, a tela
de Configurações › Time guarda o rascunho e, na linha seguinte, o apaga, na mesma passada. Como as
duas atualizações acontecem juntas, o que sobra é o valor vazio: o painel de agente nunca recebe o
rascunho e o efeito que abriria o editor preenchido não dispara. O pedido já é consumido na origem
(uma vez entregue, não é reenviado), e o painel já guarda o id tratado, então a limpeza na tela é o
que sobra e é o que anula a entrega. O caminho "Editar" da especificação — abrir o editor de agente
em Configurações › Time já preenchido — não abre nada; nada o guarda por teste.

## Sugestões

- O botão de "Sugerir agentes" em Configurações › Time está restrito à janela do aplicativo, mas a
  proposta que ele cria espera em Ações, e o canal que executa a aprovação é o mesmo que o navegador
  pareado pode usar quando a pessoa libera os efeitos externos. Por esse caminho, um navegador
  pareado pode aceitar a proposta e criar um agente no time — trabalho local, que o desenho dizia
  restrito à janela. Não foi verificado por execução; convém decidir se o aceite da sugestão deve
  ficar atrás da mesma restrição dos demais canais de decisão.
- O cartão da sugestão é desenhado também no navegador pareado, onde os botões de recusar e editar
  chamam canais restritos à janela ou uma tela que não existe ali; o botão de aceitar seria o único
  que responderia. Convém esconder do navegador os caminhos que não têm como funcionar, como já se
  faz com o botão do time.

## O que não foi verificado

- O comportamento do modelo real não foi observado; os testes usam um modelo simulado e nenhuma
  chamada real foi feita.
- A renderização do cartão numa tela de verdade e o caminho "editar" de ponta a ponta não foram
  abertos no aplicativo; o defeito apontado acima foi concluído por leitura do código.
- O volume real do histórico e o acerto do limiar escolhido não foram medidos em uso.
- O gancho do fim da retro na retro do espaço de trabalho inteiro não foi exercitado de ponta a
  ponta; os testes cobrem a retro de squad.
