# Fechar a fila de sugestões pendentes

Esta etapa não muda código: é uma condução no app, contra os dados do workspace. O plano descreve a operação de fechamento como a especificação aprovada pede, na ordem em que cada passo só acontece depois do anterior.

## Situação de partida

- O app guarda as sugestões à espera como cartões de ação do tipo `suggest-agent`; a proposta traz `suggestionId`, nome, papel, etapa, rascunho de prompt e evidência (`src/shared/suggestions.ts`).
- Aceitar cria o agente na equipe da etapa proposta (somente leitura, sem shell nem tracker), exigindo que a etapa ainda exista na configuração; recusar grava o motivo e marca o cartão como dispensado; o caminho de edição passa pelo editor e grava a decisão com o id salvo (`src/main/suggestionsModule.ts`). Cada decisão fica em `suggestions.json` nos dados do workspace, nunca no repositório.
- Esperados à espera: lote de 07/10 (worktree-gate, pr-opener, ambient, fechamento, test-runner, checker) e lote de 09/10 (review-unifier, re-revisor, despachante, reparo). A contagem exata só se confirma na tela.

## Passos, em ordem

1. **Confirmar a contagem na tela.** Abrir a tela de sugestões e listar os cartões à espera de decisão. O número que vale é o que a tela mostra; as contagens anteriores (6 na issue, 10 no esclarecimento) são só referência. Registrar a contagem e a lista de cartões junto do resultado.
2. **Comparar com a lista esperada.** Cada cartão dos dois lotes tem um caminho: aceitar, editar, ou recusar com motivo. Um cartão fora da lista esperada entra como novo item de decisão, não é ignorado; um cartão esperado que não apareça é anotado como ausente no resultado.
3. **Decidir um cartão por vez.** Para cada um, ler a evidência no cartão antes de decidir:
   - **Recusar** quando a sugestão não serve à evolução do app, com motivo curto dizendo o que propunha e por que não serve agora. É o caminho esperado para a maioria: as sugestões vêm de lotes antigos (07/10) cuja evidência já não descreve o estado de hoje, e quem abriu não apontou nenhuma como necessária.
   - **Aceitar** (ou editar e aceitar) só quando a sugestão propõe um agente que o app deve passar a ter agora. Aceitar exige que a etapa proposta ainda exista; se a etapa caiu, a decisão é recusar com esse motivo, não editar a etapa na configuração.
4. **Conferir o fim.** Depois do último cartão, recarregar a tela de sugestões: nenhum dos cartões decididos pode continuar à espera, e cada decisão deve estar visível no registro de sugestões, com motivo nas recusas.
5. **Registrar o resultado.** Numa nota de fechamento: a contagem confirmada no passo 1, a decisão de cada cartão (rejeições com o motivo, aceitas com o agente criado) e o estado final da fila. A parte das 8 execuções `failed` de 07/10 fica de fora, na issue #188.

## Critério de aceite não coberto pelo plano

O critério 3 da especificação ("as sugestões aceitas, se houver, aparecem como resultado do fluxo normal") depende de existir alguma aceita. Se todas forem recusadas — o desfecho provável, dado que o esclarecimento de quem abriu não aponta nenhuma como necessária — o critério se cumpre trivialmente (nada a criar) e o resultado diz isso explicitamente, para não parecer verificação faltando.

## Riscos e como se evitam

- **Contagem desatualizada ao decidir:** novas sugestões podem entrar entre a confirmação e o fim. Mitigação: decidir em uma sessão, um cartão por vez, e recontar na conferência do passo 4.
- **Aceitar uma sugestão de lote velho:** cria um agente que ninguém pediu hoje. Mitigação: recusa por padrão; aceite só com razão atual explícita na decisão.
- **Etapa proposta inexistente no aceite:** o app rejeita o aceite (`stageGone`). Mitigação: conferir a etapa da sugestão contra a configuração antes de aceitar.
- **Decisão sem registro utilizável:** o fechamento deve deixar rastro legível. Mitigação: o passo 5 escreve a nota com contagem, decisões e motivos.
