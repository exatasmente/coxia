# Revisão: a sugestão de agente que nasce do histórico e espera em Ações

## Veredito

Aprovado com mudanças. A entrega faz o que a especificação pede — lê só o histórico já
gravado, exige repetição acima de um limiar, mostra a evidência com link, não aplica nada
sem a decisão da pessoa, cria um agente comum somente leitura no aceite e guarda a decisão
fora do repositório —, mas um ponto precisa de correção antes do teste: no fim da retro, a
sugestão é levantada antes de a retro ser gravada, e isso pode fazer uma sugestão que veio
com evidência nova (e que o cartão diria ter sido recusada antes) sumir em silêncio.

## O que foi verificado

Tudo abaixo foi conferido por leitura do código e dos documentos desta etapa; nada foi
executado.

- **A leitura é pura e só usa o que já existe.** As seis fontes (perguntas que chegam à
  pessoa, devoluções, achados de revisão, cenários de QA, etapas feitas à mão, linha de
  auditoria de comando e decisões das atas) são montadas sem I/O dentro da função, a partir
  dos arquivos que o aplicativo já grava. Nenhum registro novo é introduzido para
  alimentá-la, e a transcrição das cerimônias não é lida.
- **Sem evidência, sem sugestão.** As repetições são agrupadas e só as que passam do limiar
  (três ocorrências, em duas execuções distintas) chegam a pedir o rascunho ao modelo. Com
  o histórico insuficiente, nenhuma chamada é feita e a tela recebe um motivo.
- **A etapa é sempre existente.** O modelo só pode escolher entre as etapas do workspace e o
  resultado é conferido contra essa lista antes de virar cartão. Nenhum caminho cria, remove
  ou reordena etapa, e `runs:migrateFlow` não é tocado.
- **Aceitar cria um agente comum e somente leitura.** O agente nasce com permissão de
  leitura, sem comandos e sem acesso ao host, sem marca de "sugerido"; se a etapa sumiu do
  ciclo antes do aceite, a criação é recusada. O aceite não abre o editor.
- **A decisão fica registrada.** O registro vai para um arquivo de dados do workspace, irmão
  do das ações, sem migração de configuração; guarda o proposto, a evidência, a decisão, o
  motivo, quem decidiu e quando, e o agente criado no aceite.
- **Recusa não volta igual.** A recusa guarda a impressão (papel + etapa + tipo de evidência)
  e o conjunto de evidência que viu; a mesma impressão só reaparece quando há ocorrência nova,
  e o cartão diz que já foi recusada, quando e o que mudou.
- **Os canais de decisão são só do aplicativo de mesa.** Os três canais que decidem ou pedem
  sugestão foram marcados como restritos à janela e o teste que fixa essa lista foi
  atualizado em conformidade; a leitura do registro fica aberta.
- **Os limites com as frentes vizinhas seguem.** O gancho da retro só levanta sugestões a
  partir do que o histórico mostra; nenhuma melhoria de processo da conversa vira proposta
  (isso é da outra frente), e nada da transcrição é lido.

## O que precisa de correção

**A retro é levantada antes de ser gravada.** No fim da conversa de uma retro, as sugestões
são montadas e registradas antes de a própria retro ser gravada, e usam um filtro pelo squad
que lê a última retro de cada squad ainda no estado anterior. Numa retro de squad, a leitura
de "a última retro" pode devolver uma retro antiga do mesmo squad, e a evidência que a recusa
deve comparar sai de um conjunto errado. O efeito é que uma sugestão que mudou de estado por
causa de evidência nova — justamente a que o cartão anunciaria como "já recusada antes, o que
mudou" — pode deixar de ser oferecida sem mensagem. A correção é levantar as sugestões
depois de a retro ser persistida.

## Sugestões

- A regra de não repetir a mesma proposta só considera propostas pendentes ou em execução, e
trata uma proposta já decidida como reapresentável quando a evidência é nova. Isso é o que a
regra pede, mas permite que, num período longo, uma evidência que era nova no momento da
recusa deixe de ser considerada nova e a sugestão passe a ser silenciosa em vez de reaparecer.
- O pedido de edição enviado do cartão não é limpo depois de consumido, de modo que a mesma
  sugestão pode reabrir o editor já preenchido quando a tela é apenas revisitada; convém
  limpar o pedido depois de entregue.

## O que não foi verificado

- Não foram executados os gates (tipos, testes, tema, i18n, auditoria pública) nesta etapa;
  os gates verdes são relato do desenvolvimento, não conferidos aqui.
- O comportamento do modelo real não foi observado; os testes usam modelo simulado.
- A renderização do cartão numa tela de verdade e o caminho "editar" de ponta a ponta não
  foram abertos no aplicativo.
- O volume real do histórico e o acerto do limiar escolhido não foram medidos em uso.
