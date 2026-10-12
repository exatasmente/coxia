# Memória do ciclo

## Decisões

- Triagem: tipo bug (regressão da beta 0.11.0), squad plataforma, prioridade sugerida priority:high (não definida).
- Refino: 1_SPEC.md, 8 regras e 8 critérios.
- Plano (2_PLAN.md): primeira mensagem no prompt; turno sem AskConversation encerra (só continua com mensagem pendente, com resume); chamado que escreve recebe aviso imediato (callerWaiting); tempo limite fixo = metade de stageIdleMs (piso 30 s), sem config nova; conversa registrada em callStops; reason 'stalled'/'stopped'; entrada de conversa terminada removida.
- Implementação: conversation.ts, executor.ts (callAgent), catálogos en/pt-BR, CHANGELOG, testes em runner-conversation.test.ts e runner-conversation-stall.test.ts. Pause (comando esperando a pessoa) para o relógio da conversa.
- Revisão 1: veredito mudanças. Implementação tentativa 2: corrigidos por leitura os 3 testes vermelhos (aviso imediato lê .response; screen test espera abort local; activity-calls com mensagem pendente) e adicionado teste de callAgent em runner-send-call.test.ts (chamado que escreve pergunta no 1º turno, 2ª chamada abre conversa nova).

## Restrições

- Testes com fakes (test/helpers); textos via t() nos dois catálogos; CHANGELOG Unreleased; gates do AGENTS.md; repositório público; escrita externa só pela porta Actions (nada muda). Esta etapa não tem comandos permitidos: nada roda.

## Tentado e descartado

- Responder ao chamador pelo chamado que escreve: descartado (o chamador está dentro da ferramenta).
- Tempo limite configurável: fora do escopo (exigiria migração e três arquivos de config).

## Perguntas abertas

- Última execução (revisão): tsc falhava em runner-conversation.test.ts:249; 3 falhas de vitest; i18n:lint e public-audit passam; theme-audit 17 ocorrências, não comparado. Correções desta passada NÃO rodadas.
- Faltam: caracterização do relógio de ociosidade (critério 8), teste de stalled/stopped via callAgent, conferir chave de screenApi.stop vs callStops, vitest completo.
- Causa de o relógio de 10 min não disparar: hipótese não verificada.
- Duplicadas no tracker: não pesquisadas.

## Onde o trabalho está

- Código e testes corrigidos por leitura; volta à revisão para rodar tsc, vitest completo e os cinco gates.
- Passagem support → product-owner: Refino: confirmar escopo das cinco frentes e propor prioridade. Análise técnica: descobrir o que bate o relógio de ociosidade durante a espera, decidir entre responder ao chamador ou AskConversation retornar imediatamente, e escrever os testes com fakes da seção de aceitação. <!-- handoff:12 -->
- Passagem product-owner → pessoa: Análise técnica: confirmar por teste com fakes a causa de o relógio de ociosidade não disparar (hipótese: respostas do chamado entram na inbox da etapa e batem o relógio, ou pausa do relógio), escolher entre o chamador responder ao chamado ou AskConversation voltar na hora, definir o tempo limite sem progresso (menor que a ociosidade da etapa) e registrar conversas do runner na parada. Escrever os testes dos critérios 1 a 8 de 1_SPEC.md. <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementação: seguir 2_PLAN.md na ordem. Começar pelos testes vermelhos (inclusive a caracterização do relógio de ociosidade, critério 8, que decide se `answered` deixa de rearmar o relógio), depois conversation.ts, executor.ts (callAgent), i18n nos dois catálogos e CHANGELOG. Conferir se a chave de screenApi.stop bate com o registro em callStops. Rodar os cinco gates do AGENTS.md. <!-- handoff:35 -->
- Passagem developer → revisor-plataforma: Rodar os cinco gates (tsc, vitest, theme-audit, i18n:lint, public-audit) e corrigir o que falhar; nada foi executado. Escrever o teste de caracterização do relógio de ociosidade (critério 8) e o teste de callAgent (retorno de falta de progresso, conversa nova na chamada seguinte) em runner-send-call.test.ts; conferir a chave de screenApi.stop contra o registro em callStops. <!-- handoff:47 -->
- Passagem revisor-plataforma → developer: Revisão pede mudanças. Rodei tsc e vitest nos testes da área: tsc falha, e 3 testes ficam vermelhos (1 novo, 2 existentes que o novo laço quebrou). Faltam os testes de callAgent e do relógio de ociosidade. Códigos i18n:lint e public-audit passam; theme-audit mostra 17 ocorrências, não comparadas com a base. [bloqueia] test/runner-conversation.test.ts:254: O teste do aviso imediato compara o retorno da ferramenta (um objeto com `response`) com uma string: falha no vitest e gera erro TS2352 no tsc (linha 249). O gate de tipos e o teste novo ficam vermelhos. [bloqueia] test/runner-conversation-sc… <!-- handoff:64 -->
