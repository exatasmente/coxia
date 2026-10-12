# Memória do ciclo

## Decisões

- Triagem: tipo bug (regressão da beta 0.11.0), squad plataforma, prioridade sugerida priority:high (não definida; sugerida de novo no refino, mesmo motivo).
- Refino: spec em 1_SPEC.md com 8 regras e 8 critérios de aceite. A spec exige o resultado (a conversa nunca espera por si mesma); o mecanismo (chamador responde ao chamado ou AskConversation volta na hora) fica para a análise técnica.

## Restrições

- Testes com fakes (test/helpers); textos via t() nos dois catálogos; CHANGELOG Unreleased; gates do AGENTS.md.

## Tentado e descartado

- Nada executado; só leitura do código.

## Perguntas abertas

- Causa de o relógio de ociosidade (10 min) não disparar em 70 min. Hipótese não verificada: executor.ts passa `answered: inbox.post` e a chegada de mensagem bate o relógio (call.beat, ~:1211); ou `pause: watch.pause`.
- Valor e configuração do tempo limite sem progresso.
- Duplicadas no tracker: não pesquisadas.

## Onde o trabalho está

- Refino concluído (1_SPEC.md). Causas conferidas por leitura: conversation.ts:188-190 e :331 (primeira mensagem fora do prompt), :220-243 (laço sem esperar chamador), executor.ts:1189-1190 e 1137-1143 (deadlock com chamado que escreve), callStops sem conversas do runner (mentions/stop.ts, module.ts:381).
- Próxima etapa: análise técnica e testes com fakes dos critérios da spec.
- Passagem support → product-owner: Refino: confirmar escopo das cinco frentes e propor prioridade. Análise técnica: descobrir o que bate o relógio de ociosidade durante a espera, decidir entre responder ao chamador ou AskConversation retornar imediatamente, e escrever os testes com fakes da seção de aceitação. <!-- handoff:12 -->
