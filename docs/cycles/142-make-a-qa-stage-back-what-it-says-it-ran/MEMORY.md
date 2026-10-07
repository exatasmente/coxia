# Memória do ciclo

## Decisões

- Triagem da #142: **bug**, e confirmado por leitura de código. Sem pergunta ao repórter (a issue está completa e o que deixou em aberto é decisão de projeto).
- O documento está em `0_TRIAGE.md`: tipo, o que dá para entender, o que foi conferido no código, o que falta (decisões de projeto, não do repórter), as issues relacionadas e a sugestão de prioridade.

## Restrições

- Achados desta etapa são por **leitura de código**, não por execução: nada foi rodado nem reproduzido.
- A execução real citada pela issue não foi refeita nem conferida.
- Não projetar solução nem decidir prioridade nesta etapa; a escolha do comportamento fica para o refinamento.

## Tentado e descartado

- Perguntar ao repórter: descartado; a issue traz o comportamento de hoje, o esperado, o critério de aceite e os pontos do código, e não falta informação que só quem abriu possa dar.
- Tratar como duplicata da #121 ou da #120: descartado; as duas são vizinhança (a #121 entregou a ferramenta de guardar e o `ViewImage`, a #120 é pré-requisito declarado dela), não o mesmo pedido.

## Perguntas abertas

- Qual opção do item 3 vale (guardar automaticamente a imagem vista e não guardada, ou listá-la como "vista, não guardada") e por quê — a issue deixa para a spec.
- Se um cenário sem respaldo, depois da rodada de reparo, ainda conta como aprovado ou vira pendência.

## Onde o trabalho está

- Etapa de triagem concluída; `0_TRIAGE.md` escrito. A issue é um bug e a correção tem três partes, com critério de aceite por item.
- O que foi verificado, por leitura: `backEvidence` rebaixa um `executed` sem comando (`src/shared/runs/output.ts:204-214`) e o rebaixamento não avisa o agente nem abre rodada de reparo (`src/main/runner/executor.ts:752`); a rodada de reparo de hoje é só de formato, no motor aberto (`src/main/engine/open/loop.ts:543-549`); o plano de teste e o comentário saem do texto do agente (`src/main/runner/executor.ts:760-767`, `src/shared/runs/comment.ts:56-76`, `src/main/runner/publish.ts:590-597`); a pasta de saída some com a sandbox (`src/main/sandbox/session.ts:214`); `ViewImage` mostra a imagem e não a guarda (`src/main/evidence/handlers.ts:145-155`).
- Não verificado: nada foi exercitado; os testes atuais (`test/runs-scenario.test.ts:126-144`) não cobrem a rodada de reparo, a fidelidade do documento/comentário nem as imagens vistas e não guardadas.
- Passagem support → product-owner: usar `0_TRIAGE.md` para a spec funcional; fixar a rodada de reparo e o rebaixamento depois dela com aviso na conversa, a fonte da verdade do plano de teste e do comentário, a escolha do destino das imagens vistas e não guardadas com justificativa, e a regra de que etapa sem sandbox não muda.
