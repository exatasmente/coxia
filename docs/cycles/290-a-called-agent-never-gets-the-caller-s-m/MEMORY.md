# Memória do ciclo

## Decisões

- Triagem: tipo bug (regressão da beta 0.11.0), squad plataforma, prioridade sugerida priority:high (não definida).
- Refino: 1_SPEC.md, 8 regras e 8 critérios. A spec exige o resultado; o mecanismo ficou para o plano.
- Plano (2_PLAN.md): (1) primeira mensagem entra no prompt do chamado (turnOf); (2) turno sem AskConversation encerra a conversa, só há novo turno se já houver mensagem pendente do chamador (pendingFromCaller), continuando a sessão com resume; (3) chamado que escreve: AskConversation volta na hora com aviso (callerWaiting), em vez de responder pelo chamador; (4) tempo limite sem progresso fixo = metade de stageIdleMs (piso 30 s), SEM campo novo de configuração (evita migração e types/defaults/schema); progresso = evento do modelo, comando, mensagem, ask; (5) runConversation usa abort local e se registra em callStops (thread da execução + id do chamado); (6) reason ganha 'stalled' e 'stopped', com linha de sistema e retorno ao chamador; (7) conversationOf remove a entrada de conversa terminada.

## Restrições

- Testes com fakes (test/helpers); textos via t() nos dois catálogos; CHANGELOG Unreleased; gates do AGENTS.md; repositório público (sem nomes reais); toda escrita externa pela porta Actions (nada muda aí).

## Tentado e descartado

- Responder ao chamador pelo chamado que escreve: descartado, o chamador está dentro da ferramenta e só receberia texto de ferramenta.
- Tempo limite configurável: fora do escopo (exigiria migração em STEPS e os três arquivos de config).
- Nada executado; só leitura do código.

## Perguntas abertas

- Causa de o relógio de ociosidade (10 min) não disparar em 70 min. Hipótese não verificada: a entrega das respostas do chamado (inbox.post -> call.incoming/delivered) rearma o relógio. O teste de caracterização (critério 8) decide; se confirmado, answered do chamado que escreve não rearma.
- Se a chave de screenApi.stop(thread, agent) na tela bate com o registro em callStops: não verificado.
- Duplicadas no tracker: não pesquisadas.

## Onde o trabalho está

- Plano concluído (2_PLAN.md). Arquivos: src/main/runner/conversation.ts (runConversation, turnOf), executor.ts (callAgent ~:1119-1205, watchdog ~:300), mentions/stop.ts, catálogos main.en/pt-BR.json, CHANGELOG. Testes: runner-conversation.test.ts, novo runner-conversation-stall.test.ts, runner-send-call.test.ts.
- Próxima etapa: implementação, testes vermelhos primeiro; rodar os cinco gates.
- Passagem support → product-owner: Refino: confirmar escopo das cinco frentes e propor prioridade. Análise técnica: descobrir o que bate o relógio de ociosidade durante a espera, decidir entre responder ao chamador ou AskConversation retornar imediatamente, e escrever os testes com fakes da seção de aceitação. <!-- handoff:12 -->
- Passagem product-owner → pessoa: Análise técnica: confirmar por teste com fakes a causa de o relógio de ociosidade não disparar (hipótese: respostas do chamado entram na inbox da etapa e batem o relógio, ou pausa do relógio), escolher entre o chamador responder ao chamado ou AskConversation voltar na hora, definir o tempo limite sem progresso (menor que a ociosidade da etapa) e registrar conversas do runner na parada. Escrever os testes dos critérios 1 a 8 de 1_SPEC.md. <!-- handoff:22 -->
