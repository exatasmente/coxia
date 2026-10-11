# Memória do ciclo

## Decisões

- Triagem fechada: pedido de funcionalidade, sem duplicada. A resposta de quem abriu confirmou que o
  que aparece é o aviso de “atividade não encontrada”. Prioridade fica como sugestão `priority:low`
  (a issue já traz); o refino propôs `priority:medium`. A decisão é da pessoa, no gate 1.
- Squad proposto: `experiencia` (a mudança é de superfície: tela, rota e recusa nos dois idiomas).
- A relação que faltava à triagem é a #247, que criou o único botão que abre tela pelo chat e declara
  a recusa de `discussions` sem card; esta issue é a continuação dela.
- Resposta: **Spec funcional escrita (refinamento).** Li a issue, a triagem e o código que a triagem cita. O que ela pede está de pé, mas a descrição esconde uma coisa maior do que eu esperava, e é essa a spec. **O que a descrição não diz.** Hoje a única superfície que abre uma tela a partir de uma conversa é o botão da persona — e ela só **oferece**, não abre. Um agente que responde numa conversa (não a persona) não tem nenhuma ferramenta de ação: recebe leitura, a chamada a um par e as tarefas da persona. Então “o agente abre a tela de discussões” não é um encaixe no que existe, é uma superfície nova: u… <!-- answer:127 -->

## Restrições

- A superfície não é só o renderer: `src/shared/push.ts` (o destino `discussions` exige `ref`),
  `src/renderer/src/pushTarget.ts` e o `OpenScreen` da persona também exigem a referência.
- Hoje nenhum agente fora da persona tem ferramenta de ação: só leitura, `CallAgent` e as tarefas da
  persona. Abrir uma tela a partir de uma resposta de agente é trabalho novo, não um encaixe.
- O número da MR não é campo de `PushTarget` (`ref`, `id`, `mr`), e o `iid` da MR nunca é a `ref` de
  um card.
- O rigor de projeto que a issue pede não existe no caminho da tela: `listDiscussions` e
  `explainDiscussion` vão ao provedor direto; a explicação de cada thread recebe o card inteiro.

## Tentado e descartado

- Ler os threads por `VcsRead` não basta: já funciona hoje; o que falta é a superfície da tela.
- Manter a dúvida sobre a mensagem exibida como pendência: a resposta de quem abriu a fechou.

## Perguntas abertas

- Q1 nome do campo do número no destino; Q2 forma do pedido na conversa (pessoa); Q3 celular
  pareado recebendo o pedido (pessoa); Q4 explicar sem card (pessoa); Q5 marco (pessoa).

## Onde o trabalho está

- `0_TRIAGE.md` fechada. `1_SPEC.md` escrita (Refinamento). Próxima etapa: gate 1 e depois o plano.
