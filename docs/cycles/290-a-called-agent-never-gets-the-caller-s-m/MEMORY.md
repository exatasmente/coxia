# Memória do ciclo

## Decisões

- Triagem: tipo bug (regressão da beta 0.11.0), squad plataforma, prioridade sugerida priority:high (não definida).
- Refino: 1_SPEC.md, 8 regras e 8 critérios.
- Plano (2_PLAN.md): primeira mensagem no prompt; turno sem AskConversation encerra (só continua com mensagem pendente, com resume); chamado que escreve recebe aviso imediato (callerWaiting); tempo limite fixo = metade de stageIdleMs (piso 30 s), sem config nova; conversa registrada em callStops; reason 'stalled'/'stopped'; entrada de conversa terminada removida.
- Implementação (tentativa 1): feita conforme o plano em conversation.ts, executor.ts (callAgent), catálogos en/pt-BR e CHANGELOG; testes em runner-conversation.test.ts e novo runner-conversation-stall.test.ts. Pause (comando esperando a pessoa) para o relógio da conversa.

## Restrições

- Testes com fakes (test/helpers); textos via t() nos dois catálogos; CHANGELOG Unreleased; gates do AGENTS.md; repositório público (sem nomes reais); escrita externa só pela porta Actions (nada muda).

## Tentado e descartado

- Responder ao chamador pelo chamado que escreve: descartado (o chamador está dentro da ferramenta).
- Tempo limite configurável: fora do escopo (exigiria migração e três arquivos de config).

## Perguntas abertas

- Nenhum comando foi rodado: tsc, vitest e os demais gates NÃO verificados; os testes novos nunca executaram.
- Causa de o relógio de ociosidade (10 min) não disparar em 70 min: hipótese (entrega de answered rearma o relógio) não verificada; teste de caracterização (critério 8) não escrito.
- Chave de screenApi.stop(thread, agent) vs registro em callStops: não conferido.
- Falta teste de callAgent em runner-send-call.test.ts (aviso de falta de progresso; conversa nova após fim).
- Duplicadas no tracker: não pesquisadas.

## Onde o trabalho está

- Código e testes escritos, sem execução. Arquivos: src/main/runner/conversation.ts, executor.ts, src/shared/i18n/main.en.json e main.pt-BR.json, CHANGELOG.md, test/runner-conversation.test.ts, test/runner-conversation-stall.test.ts. 3_IMPLEMENTATION.md na pasta do ciclo.
- Próxima etapa: rodar os cinco gates e corrigir; escrever os testes que faltam.
- Passagem support → product-owner: Refino: confirmar escopo das cinco frentes e propor prioridade. Análise técnica: descobrir o que bate o relógio de ociosidade durante a espera, decidir entre responder ao chamador ou AskConversation retornar imediatamente, e escrever os testes com fakes da seção de aceitação. <!-- handoff:12 -->
- Passagem product-owner → pessoa: Análise técnica: confirmar por teste com fakes a causa de o relógio de ociosidade não disparar (hipótese: respostas do chamado entram na inbox da etapa e batem o relógio, ou pausa do relógio), escolher entre o chamador responder ao chamado ou AskConversation voltar na hora, definir o tempo limite sem progresso (menor que a ociosidade da etapa) e registrar conversas do runner na parada. Escrever os testes dos critérios 1 a 8 de 1_SPEC.md. <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementação: seguir 2_PLAN.md na ordem. Começar pelos testes vermelhos (inclusive a caracterização do relógio de ociosidade, critério 8, que decide se `answered` deixa de rearmar o relógio), depois conversation.ts, executor.ts (callAgent), i18n nos dois catálogos e CHANGELOG. Conferir se a chave de screenApi.stop bate com o registro em callStops. Rodar os cinco gates do AGENTS.md. <!-- handoff:35 -->
