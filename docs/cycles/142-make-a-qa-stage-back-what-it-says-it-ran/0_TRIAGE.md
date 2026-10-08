# Triagem: a etapa de QA deve comprovar o que diz que rodou

Tipo: bug.

## O que a issue pede

Uma etapa de QA com sandbox pode terminar como aprovada sem guardar nenhuma comprovação, e nada avisa o agente nem a pessoa. A issue descreve três correções:

1. Quando um cenário é respondido como executado sem nenhum comando próprio e sem id de comprovação, a resposta volta ao agente por uma rodada de reparo; só depois disso o app rebaixa o cenário por conta própria, e a conversa da execução diz isso.
2. O plano de teste escrito na pasta do ciclo e o comentário de QA passam a refletir os resultados que o app registrou (depois do rebaixamento), não o texto do agente quando os dois divergem.
3. Uma imagem da pasta de saída que o agente abriu e não guardou ou é guardada automaticamente quando a etapa conclui, ou é listada na conversa como "vista, não guardada" antes de a sandbox ser removida — a especificação escolhe uma das duas e diz por quê.

O critério de aceite pede um teste para cada um dos três, e que etapas sem sandbox continuem como hoje.

## Dá para entender

Dá para entender como está escrita: o comportamento de hoje, o que deveria acontecer e o critério de aceite estão separados, com os pontos do código onde o problema mora. Só foi lida, junto com o código que ela cita; nada foi reproduzido nem exercitado, porque esta etapa é de leitura.

## O que foi conferido no código (leitura, não execução)

- `backEvidence` (`src/shared/runs/output.ts:204-214`) rebaixa para `read` e marca `unbacked` um cenário `executed` que não cita um comando da própria etapa; com sandbox e sem comando, todo `executed` vira `read`. Confere com o que a issue diz.
- O rebaixamento não avisa o agente: em `src/main/runner/executor.ts:752` o resultado é gravado no registro da execução depois da resposta, e não há rodada de reparo nem linha na conversa dizendo o que foi rebaixado. Confere.
- Uma rodada de reparo existe só para o motor aberto, no fecho da resposta fora do formato (`src/main/engine/open/loop.ts:543-549`, `doorRepairs`), e não para o conteúdo da resposta (um cenário sem respaldo). Confere com a nota da issue.
- O plano de teste e o comentário saem do texto do agente: `tidyArtifact`/`writeArtifact` gravam o artefato como veio (`src/main/runner/executor.ts:760-767`) e `renderComment` usa o texto do agente com o resumo como reserva (`src/shared/runs/comment.ts:56-76`). O comentário de QA acrescenta um bloco sobre os cenários executados e os sem respaldo (`src/main/runner/publish.ts:590-597`), mas não reescreve o texto do agente. Confere com o que a issue diz.
- A pasta de saída da etapa some com a sandbox: `removeTree(o.stageDir)` no fecho da sessão (`src/main/sandbox/session.ts:214`), depois de a etapa concluir. Confere.
- Ver uma imagem passa por `ViewImage`/`EvidenceTools.view`, que devolve a imagem e não a guarda (`src/main/evidence/handlers.ts:145-155`); guardar é uma chamada separada (`SaveEvidence`). Confere: quem só olha não deixa nada.
- O esquema pede aos cenários os campos `evidence`, `commands` e `evidenceIds` e à saída os ids citados (`src/shared/runs/output.ts:82-119`), e o texto que a etapa recebe diz para marcar `executed` só com um comando que sustente (`main.en.json`, `prompt.sdd.runner.output.evidence`). Confere.
- Os testes que existem hoje cobrem o rebaixamento por si só (`test/runs-scenario.test.ts:126-144`) e não a rodada de reparo, a fidelidade do documento/comentário nem as imagens vistas e não guardadas. Confere com o critério de aceite, que pede testes que ainda não existem.

## O que falta

Nada falta a quem abriu. A issue descreve o que viu numa execução real, aponta onde no código o problema mora e define o critério de aceite item por item.

O que fica em aberto não é informação do repórter, é decisão de projeto que a própria issue deixa para a especificação:

- Qual das duas opções do item 3 vale (guardar a imagem automaticamente ou listá-la como "vista, não guardada"), com a justificativa. A issue pede explicitamente que a especificação escolha.
- Se um cenário sem respaldo, depois da rodada de reparo, ainda conta como aprovado ou vira pendência. É decisão de produto, não algo que quem abriu precise acrescentar.

## Issues parecidas ou relacionadas

- #121 — a capacidade de guardar e marcar comprovação, e o `ViewImage` da pasta de saída, nasceram nela; esta issue é sobre o buraco que sobra quando alguém olha uma imagem e não a guarda. Não é duplicata: a #121 entregou a ferramenta, a #142 cobra o comportamento em volta dela.
- #120 — a base de anexos e a forma como uma mensagem carrega arquivos, pré-requisito declarado da #121; relação indireta, pela mesma vizinhança de comprovação.
- Nenhuma outra pasta de ciclo deste checkout trata do mesmo pedido. Não foi feita busca além do que está registrado nas pastas de ciclo e no código.

## Sugestão de prioridade

Sugiro `priority:high`, que é o que a issue já traz: é comportamento errado em uso real (uma etapa que se diz aprovada sem comprovação), atinge a confiança no registro da execução e no que chega ao host, e o que falta dele não depende de nada de fora. A prioridade final é do refinamento do produto.

## O que esta triagem não fez

Não reproduziu nem exercitou nada; não propôs solução e não decidiu prioridade. Tudo o que está dito como existente foi lido em arquivo nesta cópia de trabalho; o que não foi lido está marcado como não verificado. A execução real citada pela issue não foi refeita nem conferida.
