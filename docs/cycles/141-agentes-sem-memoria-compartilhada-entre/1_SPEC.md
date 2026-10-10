# A memória das atividades deixa de ser de uma execução só

## O que se pede

Nas palavras de quem abriu:

> Um QA estava com uma atividade em teste e não sabia disso, respondendo ao usuário que não tinha teste em andamento.
>
> O app passa a manter uma memória compartilhada das atividades, transversal a runs, que qualquer agente consulta para saber o que está em andamento, o que cada agente está fazendo no ciclo e onde parou.

E as regras, também citadas:

> - A memória é lida por qualquer agente e atualizada ao longo do ciclo.
> - Persiste entre reinícios.
> - Não está presa ao worktree de um único run — é compartilhada entre atividades.
> - Fica fora do escopo deste produto como implementá-la/armazená-la (etapa de planejamento).

## O que muda para quem usa

- Perguntar a um agente por uma atividade em andamento passa a ter resposta: ele diz em que etapa aquela atividade está, quem a está trabalhando, onde ela parou e o que já foi decidido. Deixa de responder que não há trabalho quando há um atribuído.
- A resposta vale em qualquer lugar onde a pessoa escreve: a conversa de uma execução, o canal de um squad, a conversa geral e a conversa direta de um agente. Antes, um agente chamado na conversa de uma execução só sabia dessa execução, e um chamado fora dela não sabia de nenhuma.
- Perguntar por um agente específico também tem resposta: em que atividade ele está agora e onde parou nela.
- Fechar e reabrir o aplicativo não apaga essa memória: uma atividade retomada continua de onde parou, e quem perguntar depois do reinício recebe a mesma resposta de antes.
- Vários agentes chamados ao mesmo tempo, por pessoas diferentes, enxergam o mesmo estado, e não apenas o das atividades iniciadas na mesma sessão.
- Uma atividade que nunca terminou continua aparecendo como em andamento — mesmo que a execução dela tenha falhado, sido cancelada ou tenha chegado ao fim sem o trabalho estar concluído no rastreador.

## Regras

1. **Uma frente por atividade.** Cada atividade (uma issue no rastreador, identificada pela referência dela) tem uma frente própria na memória compartilhada, e essa frente existe enquanto a atividade existir. Uma atividade com duas execuções — uma devolvida e recomeçada, ou reaberta depois do fim — continua sendo uma frente só, e nunca duas.
2. **O que a frente diz.** A frente de uma atividade traz, no mínimo: a referência e o título da atividade; onde ela está agora (a etapa do ciclo, ou que está entre etapas, ou que terminou); o agente que a está trabalhando e qual foi o último agente a mexer nela; as decisões já tomadas e as perguntas em aberto; onde o trabalho parou, incluindo o último recado deixado para a etapa seguinte; e um instante da última atualização.
3. **Atualizada ao longo do ciclo.** A frente é atualizada quando a atividade começa, quando cada etapa dela começa e termina, quando a pessoa responde ou devolve o trabalho, quando um recado é deixado para a próxima etapa, quando a execução pergunta e quando ela é cancelada. Ao fim de uma atividade, a frente registra onde ela parou (em espera de integração, integrada, cancelada) e o que ficou aberto.
4. **Qualquer agente lê, nenhum agente escreve.** Todo agente que responde ou trabalha consulta a memória compartilhada; ele nunca a escreve. Quem escreve é o aplicativo, a partir do que acontece na execução, de modo que duas atividades que avançam no mesmo instante não se apaguem.
5. **Sempre consultada, nunca por acaso.** Um agente chamado numa mensagem consulta a memória antes de responder, e o texto que ele recebe diz, em palavras simples, que a memória é material de consulta e não instrução (como todo material de fora).
6. **Consulta por atividade e por agente.** De uma pergunta feita numa conversa, o agente tira o que ela nomeia — a referência ou o título de uma atividade, o nome de um agente, ou nada (todas as atividades) — e recebe a frente inteira do que foi nomeado. Ele não recebe as frentes de todas as atividades em toda mensagem: o que ele não precisou saber não ocupa o texto dele.
7. **Sem atividade nomeada, o que está em andamento.** Quando a pergunta não nomeia nada, o agente recebe as atividades que estão em andamento agora, cada uma em poucas linhas (referência, título, etapa, agente, onde parou), e é avisado de que pode abrir a frente inteira de uma delas nomeando-a.
8. **A criação não se perde.** A frente de uma atividade nasce quando a primeira execução dela começa. Uma criação interrompida antes disso — o aplicativo fechado no meio, a primeira execução removida — deixa um registro mínimo da referência, e não um nada: quem perguntar depois ainda encontra vestígio de que aquela atividade existiu.
9. **Uma frente antiga não vira mentira.** Uma frente cuja última atualização é de muito tempo (semanas) pode ser dita como provavelmente encerrada, junto do que ela registrava; ela nunca é apagada sozinha e nunca é apresentada como trabalho de agora.
10. **Fora do worktree.** A memória não mora na pasta do ciclo, nem no worktree, nem na ramificação da execução, e por isso não aparece no pull request nem nos commits da atividade. Ela vive no que é do aplicativo naquele computador e não é publicada no rastreador.
11. **Persiste entre reinícios.** Fechar e reabrir o aplicativo não apaga nem reinicia a memória. Uma atividade retomada depois do reinício é descrita com o que a memória guardava antes.
12. **Miniaturas de sessão, por agente.** Além das frentes por atividade, a memória guarda, por agente, onde ele parou por último (a atividade, a etapa, o instante), para responder "o que fulano está fazendo?" mesmo quando o que ele estava fazendo não é a atividade perguntada.
13. **Consulta sem chamada de modelo.** A pessoa consegue ver a memória compartilhada sem gastar uma chamada de modelo — na tela que já lista as execuções e numa consulta do aplicativo.
14. **Pode ser corrigida.** O que o aplicativo escreveu pode ser corrigido pela pessoa, como a pessoa já corrige a memória de uma execução; o registro diz que a correção foi da pessoa, e a correção vale para quem consultar depois.
15. **As mesmas regras de sempre.** Só a pessoa e o aplicativo escrevem; o texto que veio de fora entra mascarado e é marcado como material, não instrução; nada de credencial na memória; a memória não é apagada para caber (o que é antigo e encerrado é resumido, e o que fica aberto permanece).

## Fora do escopo

- **Como a memória é feita ou guardada** (formato, arquivo ou base, caminho, migração do que existe hoje): é do planejamento, não desta especificação.
- **Fazer a memória compartilhada substituir a memória de uma execução.** A memória da execução continua como é, dentro da pasta do ciclo dela, com a forma e o teto que tem.
- **Duas atividades conversando entre si, pedidos entre squads e mensagens entre execuções diferentes.** Mudar isso é outra entrega.
- **Trocar as mensagens entre agentes durante uma etapa.** Um agente que trabalha e recebe, manda e chama outro durante a etapa continua como ficou na entrega anterior.
- **Um resumo automático por modelo** de tudo o que aconteceu no ciclo, e **um painel novo** para navegar as atividades: a consulta fica onde a pessoa já olha hoje.
- **Publicar a memória no rastreador** ou levá-la nos commits e no pull request.
- **Decidir quantas entradas a memória guarda e o que ela faz quando cresce muito** além do que as regras 9 e 15 exigem.
- **Vários espaços de trabalho na mesma máquina e vários computadores** compartilhando a mesma memória.

## Critérios de aceite

Cada um é uma conferência que uma pessoa faz.

1. **O QA que não sabia do teste.** Com uma atividade em teste, a pessoa pergunta na conversa da execução dela o que está acontecendo; o agente responde em que etapa a atividade está e quem a está trabalhando. Perguntado **fora** daquela execução — no canal do squad, na conversa geral ou na conversa direta do QA —, o QA responde o mesmo, nomeando a atividade e a etapa, e não que não há trabalho em andamento.
2. **Depois de reiniciar.** Com pelo menos uma atividade em andamento, a pessoa fecha e reabre o aplicativo. Sem reiniciar nada à mão, ela pergunta a um agente o que está em andamento: as mesmas atividades aparecem, com a mesma etapa e o mesmo "onde parou", e um agente que estava com uma tarefa a retoma em vez de recomeçá-la.
3. **Em paralelo, o mesmo estado.** Duas pessoas (ou a pessoa e um agente) perguntam a dois agentes diferentes, ao mesmo tempo e em conversas diferentes, o que está em andamento: os dois relatam a mesma lista, com a mesma etapa e o mesmo agente por atividade. Ao fim de uma etapa de uma das atividades, a próxima pergunta dos dois já mostra a etapa nova; alguém que pergunta depois de dois ciclos diferentes recebe as duas atividades.
4. **Nem worktree nem execução.** Com duas atividades em andamento em worktrees diferentes, uma pergunta num lugar sem worktree (canal do squad ou conversa geral) responde pelas duas. Remover a execução de uma atividade (o worktree e a ramificação) não apaga o que a memória dizia dela.
5. **Sem chamada de modelo.** A memória compartilhada é visível na tela que lista as execuções e numa consulta do aplicativo, sem nenhuma chamada de modelo ser feita, e a lista traz, por atividade, a referência, o título, a etapa, o agente e o "onde parou".

## Perguntas em aberto

1. **Escopo da primeira entrega.** Cumprir os quatro critérios da issue pede as frentes por atividade, as miniaturas por agente e a consulta numa tela (ou consulta equivalente). Entregar tudo isto de uma vez, ou entregar primeiro as frentes e a consulta por atividade (critérios 1, 2 e 4) e deixar as miniaturas por agente e as conversas de fora de uma execução para a entrega seguinte? **Recomendação:** tudo de uma vez — os critérios 1 e 3 falam de um agente chamado em qualquer lugar, e um agente chamado fora de uma execução é justamente o caso que não funciona com menos.
2. **Crescimento sem fim.** A memória não pode ser apagada para caber (regra 15), mas nada hoje diz o que ela faz quando uma pessoa mantém centenas de atividades ao longo de meses. Resumir o que está encerrado e antigo, guardar só as frentes abertas com as encerradas resumidas, ou deixar crescer — a decisão é de produto e muda o desenho.
3. **Onde a pessoa edita.** A pessoa já corrige a memória de uma execução na tela da execução. Mostrar o que é compartilhado na mesma tela e deixar editar ali, ou tratar a correção como uma operação de manutenção em Configurações — a escolha cai na conversa, não no comportamento.
4. **Nota de lançamento.** A mudança é visível para quem usa? Se sim, o lançamento diz o que mudou (a memória que atravessa atividades); se o que a pessoa enxerga for só a resposta dos agentes, o texto do lançamento fala disso. Confirmar antes de publicar.

Nada aqui bloqueia o desenho técnico: as quatro perguntas são de escopo, tamanho, casa da edição e nota de lançamento, e o comportamento das regras acima vale com qualquer resposta.

## Como foi conferido

Por leitura, nesta etapa: a issue como chegou e a triagem já registrada; os documentos do produto sobre o runner (a memória da execução, as menções e perguntas, a autonomia e o reinício) e sobre os ciclos; a especificação da entrega que criou a memória da execução; e o código que hoje guarda essa memória, monta o texto de uma etapa, responde uma menção e guarda o estado de uma execução.

Confirmado por leitura:

- A memória que existe hoje é um arquivo de nome fixo dentro da pasta do ciclo, no worktree de uma execução, lido e reescrito pelas etapas daquela execução, versionado com ela; a pessoa pode corrigi-lo na tela da execução.
- Um agente chamado numa conversa recebe o fio da conversa e, quando o lugar é a conversa de uma execução, os documentos da pasta do ciclo **daquela** execução; fora dela, nenhum documento de atividade. Não há, hoje, nenhum estado das atividades que atravesse execuções, sobreviva a um reinício do aplicativo e seja lido por um agente de outra execução.
- O estado que o aplicativo mantém por execução (a etapa atual, o estado da execução, o histórico de cada etapa, as perguntas abertas, os recados deixados para a etapa seguinte) e a lista de execuções existem, e é deles que a memória compartilhada pode ser montada; a conversa de cada execução guarda as respostas da pessoa e os recados por etapa.
- Numa mesma mensagem, vários agentes nomeados podem ser chamados ao mesmo tempo, em conversas diferentes — é por esse caminho que duas pessoas perguntam em paralelo.

Não verificado: nada foi executado e nenhum comportamento novo foi visto funcionando. Não foi exercitado que uma resposta de hoje diga "não há trabalho em andamento" (o relato da issue), nem que uma atividade continue aparecendo depois de reiniciar; o que a especificação pede é o que a issue pede, e o que ela descreve do estado de hoje foi lido, não rodado.

## Prioridade e marco propostos

- **Prioridade: `priority:high`.** A issue já justifica ("gera desinformação direta ao usuário e afeta a confiabilidade de todo o ciclo") e o que foi lido sustenta a justificativa: o agente chamado responde com confiança e com informação errada, e sem memória entre atividades os agentes chamados em paralelo não têm como funcionar. É a proposta; quem aceita ou recusa é a pessoa.
- **Marco: próximo ciclo normal.** É o mesmo que a issue propõe, e o trabalho cabe num ciclo, mas o tamanho depende da resposta à pergunta 1: o escopo mínimo (frentes por atividade e consulta) é menor que o escopo completo (com as miniaturas por agente e as conversas de fora de uma execução).
