# Revisão: o caminho "Editar" abre o editor e a entrega fecha

## Veredito

Aprovado. O ponto bloqueante da rodada anterior foi corrigido e conferido: o pedido que o cartão de
sugestão envia para Configurações › Time passou a ser lido como um estado único (aba, squad e rascunho)
e gravado em uma só escrita, de modo que o rascunho chega ao painel de agente e o editor abre preenchido
com nome, papel, etapa e prompt. A limpeza do pedido ao trocar de aba impede que ele reabra o editor
numa visita posterior que não pediu edição. A correção está no diff desta rodada e guardada por teste.
Nada novo e bloqueante apareceu no que esta rodada mudou; as duas observações de fronteira do navegador
pareado seguem como sugestão, como já vinham das rodadas anteriores.

## O que foi verificado

Tudo abaixo foi conferido por leitura do código e dos documentos desta etapa; os gates foram rodados
nesta árvore e o resultado está registrado no fim.

- **O ponto bloqueante da rodada anterior foi atendido.** O efeito que recebe o pedido de navegação não
grava mais o rascunho e o apaga na mesma passada: o pedido é reduzido a um só valor (a aba, o squad e o
rascunho que ele carrega) por uma função pura, e esse valor é gravado de uma vez. O rascunho sobrevive
até o painel de agente, que abre o editor já preenchido; o caminho "Editar" da especificação volta a
funcionar. O pedido continua sendo consumido na origem, uma vez.
- **O pedido é limpo depois de consumido.** Ao trocar de aba (por clique e por teclado), o rascunho
pendente é descartado, de maneira que voltar à aba Team não reabre o editor com um pedido que já foi
entregue. O painel também guarda qual pedido tratou, o que evita que uma re-renderização por outro motivo
reabra o editor.
- **A correção vem com teste.** O caminho "Editar" ficou guardado por um teste que monta o pedido, confere
que o rascunho chega ao estado que a seção entrega ao painel e que não há uma segunda escrita que o anule,
e confere que o pedido é lido uma só vez. O desenvolvimento registrou que, com o defeito reintroduzido, o
teste falha; com a correção, passa.
- **As correções das rodadas anteriores seguem no lugar.** A retro é gravada antes de as sugestões serem
levantadas, de modo que a leitura do fim da retro já enxerga a retro recém-respondida; a busca da última
retro de um squad reconhece o arquivo pelo sufixo do squad, sem exigir que o nome inteiro caiba no formato
do dia; e a deduplicação da proposta olha apenas os cartões da mesma sugestão ainda pendentes ou em
execução.
- **A leitura continua pura e sem história nova.** As fontes (perguntas que chegam à pessoa, devoluções,
achados de revisão, cenários de QA, etapas feitas à mão, linha de auditoria de comando e decisões das atas)
são montadas sem I/O dentro da função, a partir dos arquivos que o aplicativo já grava. Nenhum registro
novo é introduzido para alimentá-la, e a transcrição das cerimônias não é lida.
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
decisão, o motivo, quem decidiu e quando, e o agente criado no aceite. A recusa guarda a impressão (papel +
etapa + tipo de evidência) e o conjunto de evidência que viu; a mesma impressão só reaparece quando há
ocorrência nova, e o cartão diz que já foi recusada, quando e o que mudou.
- **Os canais de decisão são só do aplicativo de mesa.** Os canais que pedem, recusam e registram edição
seguem restritos à janela; a leitura do registro fica aberta.

## Os gates rodados nesta árvore

- A checagem de tipos não acusa erro.
- A suíte inteira passa: 215 arquivos, 3569 testes.
- A auditoria de tema não encontra cor literal nova (as oito ocorrências apontadas são as já existentes).
- A checagem de idiomas vê as mesmas 4031 chaves nos dois idiomas e nenhum texto solto.
- A auditoria pública percorre 865 arquivos e não encontra nada que pertença a empresa ou pessoa.
- O build conclui.

## Sugestões

- **O aceite continua acessível pelo canal que o navegador pareado pode usar.** A proposta espera em
Ações e o canal que executa a aprovação é o mesmo que o navegador pareado pode usar quando a pessoa libera
os efeitos externos; por esse caminho, um navegador pareado pode aceitar a proposta e criar um agente no
time — trabalho local, que o desenho dizia restrito à janela. Não foi verificado por execução; convém
decidir se o aceite da sugestão deve ficar atrás da mesma restrição dos demais canais de decisão.
- **O cartão da sugestão é desenhado também no navegador pareado.** Ali, os botões de recusar e editar
chamam canais restritos à janela ou uma tela que não existe; o botão de aceitar seria o único que
responderia. Convém esconder do navegador os caminhos que não têm como funcionar, como já se faz com o
botão do time.
- **Duas imperfeições de forma em `actions.ts`:** há uma linha em branco dupla antes de `conflictOf` e a
primeira linha dessa função ficou colada à declaração. Não afeta comportamento; é só forma.

## O que não foi verificado

- O caminho "Editar" aberto no aplicativo, de ponta a ponta, com um clique real: foi conferido por
tipos, pelo teste do estado que o pedido produz e por leitura do código; a suíte roda sem navegador, então
a tela não foi renderizada.
- O comportamento do modelo real ao montar a sugestão; os testes usam um modelo simulado e nenhuma
chamada real foi feita.
- O volume real do histórico e o acerto do limiar medido em uso.
- A renderização do cartão numa tela de verdade.
