# Memória do ciclo

## Decisões

- Triagem fechada: pedido de funcionalidade, sem duplicada. A resposta de quem abriu confirmou que o que aparece é o aviso de "atividade não encontrada". Prioridade fica como sugestão `priority:low` (a issue já traz); o refino propôs `priority:medium`. A decisão é da pessoa, no gate 1.
- Squad proposto: `experiencia` (a mudança é de superfície: tela, rota, recusa e rótulo nos dois idiomas).
- A relação que faltava à triagem é a #247, que criou o único botão que abre tela pelo chat e declara a recusa de `discussions` sem card; esta issue é a continuação dela.
- Refinamento (tentativa 1) reescreveu `1_SPEC.md`: a mudança tem **duas superfícies** (o botão da persona e uma ferramenta de ação de um agente que responde numa conversa), o pedido passa a ser projeto + número da MR, a leitura da tela ganha o rigor de projeto do workspace, a explicação funciona sem o card no prompt, e a spec fixa três coisas que a descrição não fixava: a abertura nunca acontece sem um ato da pessoa, o pedido abre no dispositivo do pedido, e uma MR pedida pela conversa tem a lista lida a cada abertura (hoje a tela lê uma vez por MR e não relê enquanto o trabalho daquele card está na memória).
- Duas decisões de base são da pessoa e bloqueiam o plano: (a) se um agente que não é a persona pode abrir uma tela — se não, as regras 15 a 18 saem e a mudança fica nos botões da persona; (b) como a explicação se comporta sem o card (segue e perde a linha do card / só lista / lista com recado).
- Resposta: **Spec funcional escrita (refinamento)**. Li a issue, a triagem e o código que a triagem cita. O que ela pede está de pé, mas a descrição esconde uma coisa maior do que eu esperava, e é essa a spec. **O que a descrição não diz.** Hoje a única superfície que abre uma tela a partir de uma conversa é o botão da persona — e ela só **oferece**, não abre. Um agente que responde numa conversa (não a persona) não tem nenhuma ferramenta de ação: recebe leitura, a chamada a um par e as tarefas da persona. Então "o agente abre a tela de discussões" não é um encaixe no que existe, é uma superfície nova: um agente que responde numa conversa precisa ganhar uma ferramenta de ação para isso.
- Específica aprovada no gate 1.
- Resposta: **Spec funcional escrita (refinamento).** Li a issue, a triagem e o código que a triagem cita. O que ela pede está de pé, mas a descrição esconde uma coisa maior do que eu esperava, e é essa a spec. **O que a descrição não diz.** Hoje a única superfície que abre uma tela a partir de uma conversa é o botão da persona — e ela só **oferece**, não abre. Um agente que responde numa conversa (não a persona) não tem nenhuma ferramenta de ação: recebe leitura, a chamada a um par e as tarefas da persona. Então “o agente abre a tela de discussões” não é um encaixe no que existe, é uma superfície nova: u… <!-- answer:127 -->
- Resposta: tentar novamente <!-- answer:164 -->

## Restrições

- A superfície não é só o renderer: o destino `discussions` exige referência em três lugares (`src/shared/push.ts`, `src/renderer/src/pushTarget.ts` e o `OpenScreen` da persona).
- Hoje nenhum agente fora da persona tem ferramenta de ação: só a chamada a um par e as tarefas da persona (`src/main/mentions/answer.ts`). Abrir uma tela a partir de uma resposta de agente é trabalho novo.
- `PushTarget` tem `to`, `ref`, `id` e `mr`, e `mr` já é a **referência** de uma MR; o número não é campo de nenhum destino, e o número da MR nunca é a referência de um card.
- O rigor de projeto que a issue pede não existe no caminho da tela (`listDiscussions` e `explainDiscussion` vão ao provedor direto), e a explicação de cada thread recebe o card inteiro.
- Explicar e propor exigem o card: sem card a tela não oferece responder nem resolver.

## Tentado e descartado

- Ler os threads por `VcsRead` não basta: já funciona hoje; o que falta é a superfície da tela.
- Manter a dúvida sobre a mensagem exibida como pendência: a resposta de quem abriu a fechou.
- Três linhas que a tentativa anterior citava não batiam e foram corrigidas na spec: o aviso de não encontrada, a "re-leitura ao abrir" da lista e a linha do `push.ts` que exige a referência.

## Perguntas abertas

- Q1 nome do campo do número no destino (técnica); Q2 um agente que não é a persona pode abrir uma tela (pessoa, bloqueia o plano); Q3 celular pareado recebendo o pedido (pessoa); Q4 explicar sem card (pessoa, bloqueia o plano); Q5 quem pode pedir numa execução (pessoa); Q6 o que a recusa diz quando o número existe mas não é MR (pessoa); Q7 marco (pessoa).

## Onde o trabalho está

- `0_TRIAGE.md` fechada. `1_SPEC.md` reescrita nesta tentativa (refinamento, 22 regras, 15 critérios de aceite, 7 perguntás). Gate 1: spec aprovada.
- `2_PLAN.md` escrito nesta tentativa (plano técnico). Próxima etapa: implementação.
- O plano trata o rigor de projeto no caminho da tela, a explicação sem o card, o campo de número no destino e o encaixe da ferramenta nova na lista de ferramentas de uma resposta.
- Nada foi executado nesta etapa além da escrita do plano: nenhum comando de teste, nenhuma tela aberta. O plano confere o código antes de mexer.
- Passagem support → product-owner: O gate 1 decide se a spec (`1_SPEC.md`) segue. A próxima etapa (plano técnico) precisa tratar os três pontos que a triagem achou e a issue não cobre: construir o rigor de projeto no caminho da tela (`listDiscussions`/`explainDiscussion` hoje vão ao provedor direto), fazer a explicação de cada thread funcionar sem o card inteiro no prompt, e levar projeto + número da MR num destino que hoje só tem `ref`/`id`/`mr` — o que toca `src/shared/push.ts`, `src/renderer/src/pushTarget.ts` e o `openScreen` da persona. Nada aqui foi executado; nenhuma tela foi aberta. <!-- handoff:139 -->
- Passagem product-owner → pessoa: O gate 1 decide a spec (`1_SPEC.md`) e, em especial, as duas decisões de base que bloqueiam o plano: (a) se um agente que não é a persona pode abrir uma tela a partir de uma resposta — se a pessoa recusar, as regras 15 a 18 saem e a mudança fica nos botões da persona; (b) como a explicação se comporta sem o card (segue e perde a linha do card / só lista / lista com recado). O plano técnico precisa tratar cinco pontos: construir o rigor de projeto no caminho da tela (hoje a lista e a explicação vão ao provedor direto, com a validação só de formato), fazer a explicação funcionar sem o card intei… <!-- handoff:149 -->
