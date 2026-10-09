# Investigar as execuções do suggest-agent

## Tipo

Tarefa de investigação em condução do ciclo, não bug nem pedido de funcionalidade. A issue pede abrir as execuções que acabaram em `failed` da semana, decidir para cada uma a causa (ou se vale retomada) e resolver as `pending` em bloco, com a investigação registrada. Com o esclarecimento de quem abriu, o escopo afilou: a parte `failed` já tem causa conhecida e está coberta pela issue #188 — o que resta nesta issue é decidir, em bloco, as sugestões que esperam decisão na tela de sugestões.

## Entendível como está escrita

Sim, como está escrita, com o texto lido, o alvo no código na mão e o esclarecimento de quem a abriu.
- O fluxo de sugestão existe e está nos arquivos (`src/main/suggestionsModule.ts`, `src/shared/suggestions.ts`: o agente "deep" recebe a evidência, propõe nome/papel/etapa/prompt, e a proposta espera em Ações; recusa, edição e aceite gravam em `suggestions.json` nos dados do workspace).
- O registro de execução existe como a issue cita: cada execução é um arquivo em `<workspace>/runs/<id>.json` (`src/main/runs.ts`), com `status` e `error`.
- Esclarecido por quem abriu (lido no feed de ações do app, não conferido por esta etapa nos arquivos):
  - As **8 `failed`** são todas do lote de 07/10 (~14:46–14:48), com o mesmo motivo: "a sugestão não está mais esperando" — a decisão no gate de sugestões já tinha caído e a aplicação da sugestão encontrou o alvo encerrado. Nenhuma outra mensagem de erro; a retomada, quando houver, é descartar o lote, não tentar de novo. A issue #188 cobre essa parte.
  - As **"pending"** são sugestões geradas e à espera de aceitar/recusar na tela de sugestões (não um estado do registro de execução, que não tem "pending": working, gate, question, failed, to-start, to-accept, waiting, done, cancelled em `src/shared/runs/types.ts`). O app mostrava 10 no dia da resposta — lote de 07/10 (worktree-gate, pr-opener, ambient, fechamento, test-runner, checker) e lote de 09/10 (review-unifier, re-revisor, despachante, reparo) — contra as 6 que a issue dizia; os números da issue ficaram desatualizados, e a contagem atual não foi verificada por esta etapa.
  - A resolução em bloco é abrir a tela de sugestões e aceitar/recusar cada uma; segundo quem abriu, não há bloqueio técnico de dados. Não verificado por esta etapa.

## O que falta

Nada que só quem abriu precise dizer: as causas das `failed` e o significado de "pending" vieram no esclarecimento. A contagem atual de pendentes e o estado de cada sugestão se leem na tela de sugestões quando a etapa de fechamento rodar.

## Issues relacionadas

Nenhuma duplicada. **#188** cobre a parte `failed` (a causa das 8 execuções da semana); esta issue fica com o fechamento das sugestões pendentes. A issue #5, da qual o ciclo #5 do repositório guarda os documentos, é a origem do fluxo de sugestão: antecedente, não duplicada.

## Sugestão de prioridade

Sem peso decidido nesta etapa. Sugerir, se usado, `priority:low`: a causa das `failed` já está encaminhada em #188 e o que resta (decidir uma fila de sugestões esperando aceitar/recusar) é rotina de uso do app, sem comportamento errado nem bloqueio técnico relatado.

## Squad

Sugestão (não decisão): `plataforma`. As execuções em causa correm no runtime do Coxia, e a pasta natural para o código do fluxo (e de qualquer causa que reapareça) é a de runtime, da área `plataforma`.

## Pergunta a quem abriu

Respondida: o que a issue chama de `pending` são sugestões geradas e à espera de aceitar/recusar na tela de sugestões, e as `failed` de 07/10 compartilham a causa "a sugestão não está mais esperando", já coberta pela issue #188. Nenhuma pergunta pendente a quem abriu.
