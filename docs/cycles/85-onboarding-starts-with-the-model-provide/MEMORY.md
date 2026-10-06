# Memória do ciclo

## Decisões

- Escopo reduzido ao assistente: a instalação nova começa pela escolha do provedor de modelo, e o assistente diz numa frase que sem modelo nenhum agente roda. O catálogo de skills do Coxia saiu deste ciclo (registrado por quem abriu como a issue de número 103, que espera a decisão de onde vem o conteúdo). <!-- answer:8 -->
- Prioridade sugerida na triagem: média, porque o passo de modelos já é o segundo de nove e já impede avançar com zero provedores; o rótulo atual da issue é priority:high.

## Restrições

- O que falta é pouca coisa e é de tela e catálogo de texto: qual é a primeira tela do assistente de instalação nova e o que acontece com o passo de idioma e nome, mais a frase sobre o modelo (no passo de modelos e quando a pessoa pula). O editor de provedores já vive dentro do passo de modelos, então não há tela nova a desenhar.
- Toda frase nova passa pelo `t()`, com chave nos catálogos `wizard.en.json` e `wizard.pt-BR.json`; as telas usam tokens de tema. O `wizard.subtitle.first` (que hoje diz que todo passo fora o primeiro e o último pode ser pulado) muda junto com a ordem.
- O ciclo de agentes já traz o time de fábrica por migração (`AGENT_FLOW_STAGES`, `agentFlowTeam` em `src/shared/cycles/templates/agentFlow.ts:26-38,50-59`; `src/shared/config/migrations.ts:208`): é o precedente se um catálogo de skills voltar ao escopo.
- Nada foi executado nesta etapa; tudo foi conferido por leitura do código e dos catálogos.

## Tentado e descartado

- Perguntar a quem abriu onde vivem hoje as skills que o ciclo do repositório cita e quem fornece o conteúdo do catálogo: respondido que o catálogo saiu para a issue de número 103. Não perguntar de novo.

## Perguntas abertas

- Nenhuma nesta etapa. Se o pedido de skills voltar, a lacuna é de onde vem o conteúdo: não há pasta de skills trazida pelo aplicativo (`docs.skillsDirs` é só uma lista de pastas, `src/shared/config/types.ts:162`) e o ciclo cita uma skill de pipeline que ninguém entrega (`src/shared/config/types.ts:435-437`; `src/main/feedback.ts:36-39`).

## Onde o trabalho está

- Triagem concluída em `docs/cycles/[redacted]/0_TRIAGE.md`: pedido de funcionalidade, entendido como está escrito, sem nada faltando de quem abriu, squad proposto `experiencia`, prioridade sugerida média. Relacionadas (não duplicatas): o time de fábrica do ciclo de agentes; a issue de número 103, que não foi lida.
- Próxima etapa: refino e planejamento do escopo reduzido. Base de leitura: `src/shared/wizard.ts:10,14`; `src/renderer/src/wizard/SetupWizard.tsx:37-47,51-53,287-288`; `src/renderer/src/wizard/steps/ModelsStep.tsx:221-348`; `src/shared/i18n/wizard.en.json:5,13-14,24-25,33-34,42`.
