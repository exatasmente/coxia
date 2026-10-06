# Memória do ciclo

## Decisões

- A pessoa fixou a ordem: a configuração do modelo é depois do idioma, e o restante dos passos depende dela — sem modelo não há como usar o app. Logo, idioma e nome continua o primeiro passo da instalação nova e a escolha de modelo passa a ser o segundo; o botão "Configurar depois" fica no primeiro passo (idioma e nome), e o passo de modelos oferece só "Pular esta etapa". <!-- answer:18 -->
- O catálogo de skills do Coxia saiu deste ciclo por decisão de quem abriu, registrado como a issue de número 103, que espera a decisão de onde vem o conteúdo. <!-- answer:8 -->
- Prioridade sugerida na triagem: média, porque o que resta é a posição de um passo e uma frase; o rótulo atual da issue é priority:high.

## Restrições

- O que falta é de tela e catálogo de texto: qual passo abre a instalação nova, o que acontece com os botões, e a frase de uma linha dizendo que sem modelo nenhum agente roda, mostrada no passo de modelos (também quando ele é pulado). O editor de provedores já vive dentro do passo de modelos: não há tela nova a desenhar.
- Toda frase nova passa pelo `t()`, com chave nos catálogos `wizard.en.json` e `wizard.pt-BR.json`; as telas usam tokens de tema. O `wizard.subtitle.first` (que hoje diz que todo passo fora o primeiro e o último pode ser pulado) muda junto com a ordem.
- "Pular esta etapa" só aparece em passo pulável (`SKIPPABLE_STEPS`, `src/shared/wizard.ts:14`) e "Configurar depois" só quando `firstRun` e o passo é o índice 0 (`SetupWizard.tsx:287-288`); trocar a ordem move os dois botões de passo junto.
- O ciclo de agentes já traz o time de fábrica por migração (`AGENT_FLOW_STAGES`, `agentFlowTeam` em `src/shared/cycles/templates/agentFlow.ts:26-38,50-59`; `src/shared/config/migrations.ts:208`): é o precedente se um catálogo de skills voltar ao escopo.
- Nada foi executado nesta etapa; tudo foi conferido por leitura do código e dos catálogos.

## Tentado e descartado

- Perguntar a quem abriu onde vivem hoje as skills que o ciclo do repositório cita e quem fornece o conteúdo do catálogo: respondido que o catálogo saiu para a issue de número 103. Não perguntar de novo.
- A hipótese de que a escolha de modelo abriria a instalação nova foi descartada pela resposta da pessoa: o idioma vem antes dela. O documento 1_SPEC.md, escrito sob a hipótese antiga, foi reescrito.

## Perguntas abertas

- Só uma, e não trava este ciclo: como uma marca de "prévia" apareceria num catálogo de skills. Depende da issue de número 103 e da decisão de onde vem o conteúdo. A lacuna de fundo: não há pasta de skills trazida pelo aplicativo (`docs.skillsDirs` é só uma lista de pastas, `src/shared/config/types.ts:162`) e o ciclo cita uma skill de pipeline que ninguém entrega (`src/shared/config/types.ts:435-437`; `src/main/feedback.ts:36-39`).

## Onde o trabalho está

- Triagem em `docs/cycles/[redacted]/0_TRIAGE.md`: pedido de funcionalidade, entendido como está escrito, squad `experiencia`, prioridade sugerida média. Relacionadas (não duplicatas): o time de fábrica do ciclo de agentes; a issue de número 103, que não foi lida.
- Refino concluído em `docs/cycles/[redacted]/1_SPEC.md`, já na ordem fixada pela pessoa: idioma e nome abre, modelos vem em seguida com a frase nova, pulável e bloqueando "Continuar" sem provedor; 11 regras, 11 critérios de aceite, o catálogo de skills fora do escopo.
- Próxima etapa: planejar e implementar sobre esse documento. Base de leitura: `src/shared/wizard.ts:10,14,52-57`; `src/renderer/src/wizard/SetupWizard.tsx:51-53,229,282-295`; `src/renderer/src/wizard/steps/LanguageStep.tsx`; `src/renderer/src/wizard/steps/ModelsStep.tsx:221-348`; `src/shared/i18n/wizard.en.json:5,7,14`; testes `test/wizard-i18n.test.ts` e `test/wizard-shared.test.ts`.
- Passagem support → product-owner cumprida; produto → planejamento: implementar a ordem idioma-nome → modelos, a frase nova e o subtítulo, sobre o 1_SPEC.md reescrito.
- Passagem support → product-owner: Refinar e planejar apenas o que restou no escopo: qual é a primeira tela do assistente de instalação nova e o que acontece com o passo de idioma e nome, mais a frase em uma linha dizendo que sem um modelo nenhum agente roda (dita quando a pessoa pula o passo de modelos e no próprio passo). O editor de provedores já vive dentro do passo de modelos, então não há tela nova a desenhar: conferir por leitura `src/shared/wizard.ts:10,14`, `src/renderer/src/wizard/SetupWizard.tsx:51-53,287-288` e `src/renderer/src/wizard/steps/ModelsStep.tsx:221-348`. O `wizard.subtitle.first` hoje diz que todo passo … <!-- handoff:11 -->
