# Memória do ciclo

## Decisões

- Triagem: tipo bug (regressão da beta 0.11.0), squad plataforma, prioridade sugerida priority:high (não definida).
- Refino: 1_SPEC.md, 8 regras e 8 critérios.
- Plano (2_PLAN.md): primeira mensagem no prompt; turno sem AskConversation encerra (só continua com mensagem pendente, com resume); chamado que escreve recebe aviso imediato (callerWaiting); tempo limite fixo = metade de stageIdleMs (piso 30 s), sem config nova; conversa registrada em callStops; reason 'stalled'/'stopped'; entrada de conversa terminada removida.
- Implementação: conversation.ts, executor.ts (callAgent), catálogos en/pt-BR, CHANGELOG, testes em runner-conversation*.test.ts e runner-send-call.test.ts.
- forget() tira o chamado da chain; o resume do turno seguinte passa mode 'conversation'.
- Revisão rodada 4: aprovado (tsc, vitest completo 9155 ok, i18n:lint, public-audit passam; theme-audit 17 ocorrências fora do diff, não comparado com a base).
- QA (tentativa 1): rodou os 6 arquivos da área (46 ok), tsc, i18n:lint, public-audit: tudo saída 0. Plano em 5_TEST_PLAN.md.
- Resposta: O que continua em aberto: - src/main/runner/executor.ts:1134 — `chain.push(to)` nunca é desfeito quando a conversa termina. A segunda chamada ao mesmo agente depois do fim é recusada como ciclo, então o teste novo de callAgent falha (1 turno em vez de 2) e a nota do CHANGELOG, que diz que a próxima chamada abre conversa nova, não é verdadeira. Retirar o chamad… - test/runner-send-call.test.ts:221 — O teste falha no vitest: `topics` tem 1 item, esperado 2. Gate vermelho; só passa depois de tratar a recusa por ciclo na segunda chamada. <!-- answer:92 -->

## Restrições

- Testes com fakes; textos via t() nos dois catálogos; CHANGELOG Unreleased; gates do AGENTS.md; repositório público; escrita externa só pela porta Actions.
- node_modules ausente na worktree: foi preciso npm ci antes de rodar testes.

## Tentado e descartado

- Responder ao chamador pelo chamado que escreve: descartado (o chamador está dentro da ferramenta).
- Tempo limite configurável: fora do escopo (exigiria migração e três arquivos de config).
- Ajustar a expectativa do teste activity-calls: descartado; o código é que estava errado.

## Perguntas abertas

- Não bloqueantes: teste do relógio de ociosidade (critério 8), teste de stalled/stopped via CallAgent, chave de screenApi.stop vs callStops. Causa dos 70 min segue hipótese.
- Duplicadas no tracker: não pesquisadas.

## Onde o trabalho está

- QA concluída sem falhas; segue para o pull request. Vitest completo e theme-audit não rodados pela QA.
- Passagem support → product-owner: Refino: confirmar escopo das cinco frentes e propor prioridade. Análise técnica: descobrir o que bate o relógio de ociosidade durante a espera, decidir entre responder ao chamador ou AskConversation retornar imediatamente, e escrever os testes com fakes da seção de aceitação. <!-- handoff:12 -->
- Passagem product-owner → pessoa: Análise técnica: confirmar por teste com fakes a causa de o relógio de ociosidade não disparar (hipótese: respostas do chamado entram na inbox da etapa e batem o relógio, ou pausa do relógio), escolher entre o chamador responder ao chamado ou AskConversation voltar na hora, definir o tempo limite sem progresso (menor que a ociosidade da etapa) e registrar conversas do runner na parada. Escrever os testes dos critérios 1 a 8 de 1_SPEC.md. <!-- handoff:22 -->
- Passagem tl-plataforma → pessoa: Implementação: seguir 2_PLAN.md na ordem. Começar pelos testes vermelhos (inclusive a caracterização do relógio de ociosidade, critério 8, que decide se `answered` deixa de rearmar o relógio), depois conversation.ts, executor.ts (callAgent), i18n nos dois catálogos e CHANGELOG. Conferir se a chave de screenApi.stop bate com o registro em callStops. Rodar os cinco gates do AGENTS.md. <!-- handoff:35 -->
- Passagem developer → revisor-plataforma: Rodar os cinco gates (tsc, vitest, theme-audit, i18n:lint, public-audit) e corrigir o que falhar; nada foi executado. Escrever o teste de caracterização do relógio de ociosidade (critério 8) e o teste de callAgent (retorno de falta de progresso, conversa nova na chamada seguinte) em runner-send-call.test.ts; conferir a chave de screenApi.stop contra o registro em callStops. <!-- handoff:47 -->
- Passagem revisor-plataforma → developer: Revisão pede mudanças. Rodei tsc e vitest nos testes da área: tsc falha, e 3 testes ficam vermelhos (1 novo, 2 existentes que o novo laço quebrou). Faltam os testes de callAgent e do relógio de ociosidade. Códigos i18n:lint e public-audit passam; theme-audit mostra 17 ocorrências, não comparadas com a base. [bloqueia] test/runner-conversation.test.ts:254: O teste do aviso imediato compara o retorno da ferramenta (um objeto com `response`) com uma string: falha no vitest e gera erro TS2352 no tsc (linha 249). O gate de tipos e o teste novo ficam vermelhos. [bloqueia] test/runner-conversation-sc… <!-- handoff:64 -->
- Passagem developer → revisor-plataforma: Rodar tsc, vitest completo, theme-audit (comparar com a base), i18n:lint e public-audit; corrigir o que falhar. Ainda faltam: teste de caracterização do relógio de ociosidade (critério 8), teste do retorno stalled/stopped em callAgent e conferir a chave de screenApi.stop contra callStops. <!-- handoff:76 -->
- Passagem pessoa → developer: O que continua em aberto: - src/main/runner/executor.ts:1134 — `chain.push(to)` nunca é desfeito quando a conversa termina. A segunda chamada ao mesmo agente depois do fim é recusada como ciclo, então o teste novo de callAgent falha (1 turno em vez de 2) e a nota do CHANGELOG, que diz que a próxima chamada abre conversa nova, não é verdadeira. Retirar o chamad… - test/runner-send-call.test.ts:221 — O teste falha no vitest: `topics` tem 1 item, esperado 2. Gate vermelho; só passa depois de tratar a recusa por ciclo na segunda chamada. <!-- handoff:93 -->
- Passagem developer → revisor-plataforma: Rodar tsc, vitest (começando por test/runner-send-call.test.ts) e os demais gates; confirmar que a retirada do chamado da chain em forget() faz o teste de segunda chamada passar e que nenhum teste de ciclo (callRefusal) regrediu. Seguem pendentes: caracterização do relógio de ociosidade, teste de stalled/stopped por callAgent e a chave de screenApi.stop. <!-- handoff:101 -->
- Passagem revisor-plataforma → developer: A correção da cadeia funcionou: runner-send-call passa. Mas test/activity-calls.test.ts ("keeps one node for several rounds…") falha de forma determinística: o nó do chamado recebe dois eventos 'started' em vez de um, porque o segundo turno agora continua a sessão (resume). Gate vermelho, então o veredito segue "changes". tsc, i18n:lint e public-audit passam; o vitest completo e o theme-audit não foram rodados. [bloqueia] test/activity-calls.test.ts:249: O teste existente "keeps one node for several rounds…" falha de forma determinística (reproduzido em duas execuções): o nó do chamado recebe … <!-- handoff:115 -->
- Passagem developer → revisor-plataforma: Rodar vitest (começando por test/activity-calls.test.ts, depois o completo), tsc, theme-audit, i18n:lint e public-audit; confirmar que o nó do chamado tem só um 'started' no segundo turno e que o resume em modo conversation não quebrou runner-conversation*. Seguem pendentes: caracterização do relógio de ociosidade, teste de stalled/stopped por callAgent, chave de screenApi.stop. <!-- handoff:124 -->
- Passagem revisor-plataforma → qa-plataforma-2: Abrir o pull request. Pendências não bloqueantes: teste do relógio de ociosidade, teste de stalled/stopped via CallAgent e conferência da chave de screenApi.stop. <!-- handoff:135 -->
