# Memória do ciclo

## Decisões

- Triagem da #142: **bug**, confirmada por leitura de código. Sem pergunta ao repórter.
- Refinamento: a spec está em `1_SPEC.md`. As três decisões de projeto: (1) **uma rodada de reparo** por etapa de QA com sandbox, para cenários afirmados como executados e sem respaldo, com as saídas guardar-a-comprovação-e-apontar-o-comando, apontar-o-comando, assumir-lido ou assumir-não-rodado, e o rebaixamento só depois, com linha na conversa; (2) **o registro manda no que se publica** — os cenários gravados depois da rodada alimentam de uma só vez o registro da execução, o `5_TEST_PLAN.md` e o comentário; (3) **a imagem olhada e não guardada é guardada automaticamente no fecho**, e o que não puder ser guardado é dito como visto-não-guardado, com o motivo.
- **Um cenário rebaixado não reprova a etapa nem vira pendência**; a severidade do cenário continua sendo o único gatilho de devolução. Etapa de QA sem sandbox fica como hoje.
- Prioridade proposta: a mais alta dos níveis configurados (a issue veio com `priority:high`). Nenhum marco proposto.
- **Plano (`2_PLAN.md`) implementado nos cinco passos**: gancho `looked`/`onLooked` em `lookAtImage`; rodada de reparo dentro do `try` de `runStage`; fonte única do que se publica; guarda automática no fecho; correção da regra `.coxia/rules/runner.md` e linha no `CHANGELOG.md`.
- **Revisão (tentativa 1): `changes`**, com um bloqueante (a guarda guardava um caminho não conferido). Tratado na tentativa 2: a guarda passa o caminho do gancho pelo `resolveOutputPath` antes de ler, o recusado vira `runner.qa.lookNotKept` com o motivo, o id só entra na lista depois de a guarda dar certo, o `looked` só sai para imagem de verdade e o `keptNames` evita guardar duas vezes.
- **Revisão (tentativa 2) voltou `changes` por um bloqueante novo**: `.coxia/rules/runner.md`, no parágrafo "What a QA stage says it ran", soava como se o `5_TEST_PLAN.md` fosse o texto do agente inteiro, quando o executor o reescreve a partir do registro (`testPlanWithResults`, `src/main/runner/executor.ts:873`). **Tentativa 3 (esta): corrigido** — o parágrafo agora diz que o plano deixa de ser o texto do agente inteiro: o app escreve os cenários gravados como seção própria, tira as linhas de cenário do agente e mantém as outras seções como ele as escreveu. Conferido por leitura contra `src/shared/runs/testPlan.ts:51-63` e pelo teste puro do plano.
- Resposta: volta pra resolver <!-- answer:492 -->

## Restrições

- Achados por **leitura de código** e por testes com ajudantes falsos (motor e sandbox falsos, sem rede); nenhuma tela foi conduzida e nenhum run foi reproduzido. A execução real citada pela issue não foi refeita nem conferida.
- A guarda automática só lê caminho dentro da pasta de saída da etapa; o tipo continua sendo lido do conteúdo e o teto de tamanho continua valendo.
- O que já foi publicado no host não é apagado nem mudado. Nada de fora do escopo da spec.
- A conferência pública: sem nome real, host, número de issue ou credencial em código, teste, mensagem de commit ou nome de ramo. O `checked-commit`/`checked-date` dos arquivos de `.coxia` é escrito pelo app no commit; os marcadores que a branch toca continuam com a data antiga de propósito.

## Tentado e descartado

- Perguntar ao repórter: descartado na triagem.
- Duplicata da #121 ou da #120: descartado; a #121 entregou a ferramenta e o `ViewImage`.
- Fazer o rebaixamento reprovar a etapa: descartado.
- Só listar "visto, não guardado" em vez de guardar: descartado, com o motivo na spec.
- Reconhecer a imagem olhada pelo conteúdo: descartado no plano.
- Deixar o gancho registrar texto e vídeo abríveis pela evidência: descartado na implementação; `looked` passou a sair só para imagem de verdade.
- Atualizar o `docs/runner.md` (documento das pessoas) com a rodada de reparo e a guarda da imagem: descartado nesta rodada; é sugestão, não está no plano, e nada dele ficou falso. Fica para quem tocar o documento.
- Os dois pontos de limpeza de passagem do plano (erro de digitação num comentário e teto divergente num comentário de módulo): deixados como estavam; nenhum altera esta mudança.

## Perguntas abertas

- Nenhuma bloqueante. **Não verificado:** comportamento num run real; o caminho de recusa por tipo e por tamanho de imagem num teste próprio; a regra `.coxia` corrigida sem teste que a confira.
- A corrida completa da suíte **não** foi vista verde nesta máquina: 283 arquivos, 4384 testes passando e 9 falhando em 8 arquivos sob carga (tempo-limite de 5 s por teste com 283 arquivos em paralelo, rede ausente, sandbox real, git do host). Cada arquivo que se pôde rodar de novo passou, e nenhum deles está no diff da branch; a causa apontada é ambiente, não esta mudança.
- **Sugestões não decididas:** o contrato da rodada de reparo que falha (erro engolido, primeira resposta fica); a resposta de um motor sem id de sessão (a rodada vira chamada nova); o teste próprio da recusa por tipo e por tamanho de imagem; o `docs/runner.md` desatualizado.

## Onde o trabalho está

- Toda a implementação, os testes e o changelog estão no worktree, com `3_IMPLEMENTATION.md`, `4_REVIEW.md` e este `MEMORY.md` na pasta do ciclo. Esta rodada respondeu ao bloqueante da revisão: a frase de `.coxia/rules/runner.md` sobre a gravação do `5_TEST_PLAN.md` passou a dizer que o plano deixa de ser o texto do agente inteiro. Os marcadores dos arquivos de `.coxia` citados ficam como estão (o app os escreve no commit). O `docs/runner.md` tem uma linha duplicada no fim que já existia no ponto de ramificação.
- Passagem developer → revisor-plataforma (de novo): conferir a correção do achado sobre a regra do `.coxia` e os marcadores; não reabrir o que já foi aceito.
- Passagens anteriores (já consumidas): triagem → refinamento, refinamento → plano, plano → implementação, e a primeira devolução da revisão. O detalhe delas está nos documentos da pasta (`0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `4_REVIEW.md`); não são tarefa de ninguém agora. <!-- handoff:7 -->
 <!-- handoff:34 --> <!-- handoff:43 --> <!-- handoff:254 --> <!-- handoff:269 --> <!-- handoff:373 -->
- Passagem pessoa → developer: volta pra resolver <!-- handoff:493 -->
