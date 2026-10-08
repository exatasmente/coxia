# Memória do ciclo

## Decisões

- Triagem da #142: **bug**, confirmada por leitura de código. Sem pergunta ao repórter.
- Refinamento: a spec está em `1_SPEC.md`. As três decisões de projeto: (1) **uma rodada de reparo** por etapa de QA com sandbox, para cenários afirmados como executados e sem respaldo, com as saídas guardar-a-comprovação-e-apontar-o-comando, apontar-o-comando, assumir-lido ou assumir-não-rodado, e o rebaixamento só depois, com linha na conversa; (2) **o registro manda no que se publica** — os cenários gravados depois da rodada alimentam de uma só vez o registro da execução, o `5_TEST_PLAN.md` e o comentário; (3) **a imagem olhada e não guardada é guardada automaticamente no fecho**, e o que não puder ser guardado é dito como visto-não-guardado, com o motivo.
- **Um cenário rebaixado não reprova a etapa nem vira pendência**; a severidade do cenário continua sendo o único gatilho de devolução. Etapa de QA sem sandbox fica como hoje.
- Prioridade proposta: a mais alta dos níveis configurados (a issue veio com `priority:high`). Nenhum marco proposto.
- **Plano (`2_PLAN.md`) implementado nos cinco passos**: gancho `looked`/`onLooked` em `lookAtImage`; rodada de reparo dentro do `try` de `runStage`; fonte única do que se publica; guarda automática no fecho; correção da regra `.coxia/rules/runner.md` e linha no `CHANGELOG.md`.
- **Revisão (tentativa 1): `changes`**, com um bloqueante (a guarda guardava um caminho não conferido). Tratado na tentativa 2: a guarda passa o caminho do gancho pelo `resolveOutputPath` antes de ler, o recusado vira `runner.qa.lookNotKept` com o motivo, o id só entra na lista depois de a guarda dar certo, o `looked` só sai para imagem de verdade e o `keptNames` evita guardar duas vezes.
- **Revisão (tentativa 2): `changes`**, por um bloqueante na regra `.coxia/rules/runner.md` (o parágrafo "What a QA stage says it ran" soava como se o `5_TEST_PLAN.md` fosse o texto do agente inteiro). Tratado na tentativa 3, commitado em `532d3449`: a frase nova diz que o plano deixa de ser o texto integral do agente — o app escreve os cenários gravados como seção própria, tira as linhas de cenário do agente e mantém as outras seções como ele as escreveu.
- **Revisão (tentativa 3, esta): `approved`.** O bloqueante da rodada 2 foi conferido por leitura contra `testPlanWithResults` (`src/shared/runs/testPlan.ts:51-63`, aplicado em `src/main/runner/executor.ts:873`) e a frase nova confere; o bloqueante da rodada 1 segue de pé (`executor.ts:624-639`). Portas rodadas nesta cópia: `tsc --noEmit` limpo, 3 arquivos de teste do assunto com 38 testes passando, `i18n:lint` 4598 chaves/0 problema, `theme-audit` e `public-audit` (1215 arquivos) limpos. Nada bloqueia.
- Resposta: a entrega está aprovada <!-- answer:492 -->

## Restrições

- Achados por **leitura de código** e por testes com ajudantes falsos (motor e sandbox falsos, sem rede); nenhuma tela foi conduzida e nenhum run foi reproduzido. A execução real citada pela issue não foi refeita nem conferida.
- A guarda automática só lê caminho dentro da pasta de saída da etapa; o tipo continua sendo lido do conteúdo e o teto de tamanho continua valendo.
- O que já foi publicado no host não é apagado nem mudado. Nada de fora do escopo da spec.
- A conferência pública: sem nome real, host, número de issue ou credencial em código, teste, mensagem de commit ou nome de ramo. O `checked-commit`/`checked-date` dos arquivos de `.coxia` é escrito pelo app no commit; os marcadores que a branch toca continuam com a data antiga de propósito.
- A suíte completa **não** foi vista verde nesta máquina (283 arquivos, 4384 testes passando e 9 falhando em 8 arquivos sob carga); cada arquivo rodado de novo em grupo menor passou, e nenhum está no diff da branch. A causa apontada é ambiente, não esta mudança.

## Tentado e descartado

- Perguntar ao repórter: descartado na triagem.
- Duplicata da #121 ou da #120: descartado; a #121 entregou a ferramenta e o `ViewImage`.
- Fazer o rebaixamento reprovar a etapa: descartado.
- Só listar "visto, não guardado" em vez de guardar: descartado, com o motivo na spec.
- Reconhecer a imagem olhada pelo conteúdo: descartado no plano.
- Deixar o gancho registrar texto e vídeo abríveis pela evidência: descartado na implementação; `looked` passou a sair só para imagem de verdade.
- Atualizar o `docs/runner.md` (documento das pessoas) com a rodada de reparo e a guarda da imagem: sugerido por duas revisões e deixado para quem tocar o documento; nada dele ficou falso. Não reaberto nesta rodada.
- Promover as sugestões das rodadas anteriores a bloqueantes: descartado; nenhuma ganhou fato novo nesta rodada.
- Os dois pontos de limpeza de passagem do plano (erro de digitação num comentário e teto divergente num comentário de módulo): deixados como estavam; nenhum altera esta mudança.

## Perguntas abertas

- Nenhuma bloqueante. **Não verificado:** comportamento num run real; o caminho de recusa por tipo e por tamanho de imagem num teste próprio; a corrida completa da suíte verde.
- **Sugestões não decididas:** o contrato da rodada de reparo que falha (erro engolido, primeira resposta fica); a resposta de um motor sem id de sessão (a rodada vira chamada nova); o teste próprio da recusa por tipo e por tamanho de imagem; o `docs/runner.md` desatualizado; os marcadores `checked-commit`/`checked-date` escritos pelo app no commit.

## Onde o trabalho está

- Toda a implementação, os testes e o changelog estão no worktree, com `3_IMPLEMENTATION.md`, `4_REVIEW.md` e este `MEMORY.md` na pasta do ciclo. A revisão está aprovada e as portas rodadas nesta cópia estão verdes (typecheck, testes do assunto, i18n, tema e conferência pública).
- Passagem revisor-plataforma → qa: a entrega está aprovada; as sugestões abertas estão listadas acima e não bloqueiam.
- Passagens anteriores (já consumidas): triagem → refinamento, refinamento → plano, plano → implementação, e as duas devoluções da revisão. O detalhe delas está nos documentos da pasta (`0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `4_REVIEW.md`); não são tarefa de ninguém agora. <!-- handoff:7 --> <!-- handoff:34 --> <!-- handoff:43 --> <!-- handoff:254 --> <!-- handoff:269 --> <!-- handoff:373 --> <!-- handoff:492 -->
- Passagem pessoa → developer: volta pra resolver <!-- handoff:493 -->
- Passagem developer → revisor-plataforma: A implementação respondeu ao bloqueante da revisão (`4_REVIEW.md`) sem tocar em código: `.coxia/rules/runner.md`, no parágrafo "What a QA stage says it ran", agora diz que o plano de teste deixa de ser o texto do agente inteiro — o app escreve os cenários gravados como seção própria, tira as linhas de cenário do agente e mantém as outras seções como ele as escreveu. Confere com `testPlanWithResults` (`src/shared/runs/testPlan.ts:51-63`, aplicado em `src/main/runner/executor.ts:873`). O que a QA precisa conferir: (1) a frase nova da regra contra o código, e (2) que os cinco passos do plano segu… <!-- handoff:647 -->
