# Fila de sugestões fechada com decisão registrada e um defeito do app encaminhado

## O que aconteceu

O ciclo investigou as execuções do agente de sugestões e fechou o quadro que a issue descrevia:

- **As 8 execuções com falha do lote de 07/10 compartilham uma única causa** — a sugestão não estava mais à espera quando a execução tentou aplicá-la. Essa parte tem investigação própria encaminhada e fica fora deste ciclo.
- **A fila de sugestões à espera de decisão tem 10 cartões, não 6** como a issue dizia: 6 do lote de 07/10 (worktree-gate, pr-opener, ambient, fechamento, test-runner, checker) e 4 do lote de 09/10 (review-unifier, re-revisor, despachante, reparo). A contagem foi confirmada lendo os cartões gravados no app.
- **A decisão aprovada pelo mantenedor foi recusar as 10 em bloco**, cada uma com o mesmo motivo: propostas de lotes antigos, cuja evidência já descreve um estado do ciclo que passou; a condução do ciclo cobre o que cada uma propunha, e nenhuma vira agente da equipe.
- **Ao tentar gravar a decisão, apareceu um defeito do app**: cartões de sugestão gerados numa sessão anterior não podem mais ser aceitos, editados nem recusados — todos os caminhos respondem o erro "a sugestão não está mais esperando". O defeito foi confirmado no código (a proposta fica só na memória da sessão e se perde quando o app reinicia, embora o cartão persista e contenha tudo o que seria preciso para recuperar a decisão) e reproduzido em teste controlado.

## O encaminhamento

O conserto do defeito tem issue própria, queCalling documenta o problema e o caminho de conserto (recuperar a proposta do próprio cartão quando a memória não a tiver, cobrindo recusa, edição e aceite, relacionada à issue das execuções failed). O fechamento da fila de sugestões fica pendente desse conserto: depois que ele entrar, o caminho já aprovado vale como está — abrir a tela de sugestões, recusar os 10 cartões um por vez com o motivo fixo registrado na nota de fechamento e reabrir a tela conferindo que nenhum deles continua à espera. A issue então se encerra pendente desse conserto, com nota de fechamento registrando a contagem confirmada, a decisão e o encaminhamento.

## O que vale saber

- Nenhuma linha de código mudou neste ciclo: a entrega é a condução do fechamento, e o conserto é a issue nova.
- Nada foi aceito ou criado: como a decisão é recusar todas, nenhuma sugestão dos dois lotes vira agente.
- A contagem de 10 cartões vem da leitura dos cartões gravados; a conferência na tela viva do app, antes das recusas e depois delas, acontece quando o fechamento rodar após o conserto.
