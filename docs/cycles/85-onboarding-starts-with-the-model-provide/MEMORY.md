# Memória do ciclo

## Decisões

- A pessoa fixou a ordem: a configuração do modelo é depois do idioma, e o restante dos passos depende dela — sem modelo não há como usar o app. Logo, idioma e nome continua o primeiro passo da instalação nova e a escolha de modelo passa a ser o segundo; o botão "Configurar depois" fica no primeiro passo (idioma e nome), e o passo de modelos oferece só "Pular esta etapa". <!-- answer:18 -->
- O catálogo de skills do Coxia saiu deste ciclo por decisão de quem abriu, registrado como a issue de número 103, que espera a decisão de onde vem o conteúdo. <!-- answer:8 -->
- Prioridade sugerida na triagem: média, porque o que resta é a posição de um passo e uma frase; o rótulo atual da issue é priority:high.
- Gate 1 aprovado (a especificação do refino); o plano em 2_PLAN.md segue essa ordem.

## Restrições

- O que falta é de tela e catálogo de texto: qual passo abre a instalação nova, o que acontece com os botões, e a frase de uma linha dizendo que sem modelo nenhum agente roda, mostrada no passo de modelos. O editor de provedores já vive dentro do passo de modelos: não há tela nova a desenhar.
- Toda frase nova passa pelo `t()`, com chave nos catálogos `wizard.en.json` e `wizard.pt-BR.json`; as telas usam tokens de tema. O `wizard.subtitle.first` (que hoje diz que todo passo fora o primeiro e o último pode ser pulado) muda junto com a ordem, nos dois idiomas.
- "Pular esta etapa" só aparece em passo pulável (`SKIPPABLE_STEPS`, `src/shared/wizard.ts:14`) e "Configurar depois" só quando `firstRun` e o passo é o índice 0 (`SetupWizard.tsx:287-288`): as duas condições são de posição e de identidade do passo, então trocar a ordem move os botões sozinha, sem tocar na tela.
- `WIZARD_STEPS` (`src/shared/wizard.ts:10`) é a fonte única da ordem: `visibleSteps`, `emptyProgress` e o contador do cabeçalho saem dela. `BODY` (`SetupWizard.tsx:37-47`) é indexado por id, então nenhuma tela é reescrita.
- Nada foi executado nesta etapa; tudo foi conferido por leitura do código e dos catálogos.

## Tentado e descartado

- Perguntar a quem abriu onde vivem hoje as skills que o ciclo do repositório cita e quem fornece o conteúdo do catálogo: respondido que o catálogo saiu para a issue de número 103. Não perguntar de novo.
- A hipótese de que a escolha de modelo abriria a instalação nova foi descartada pela resposta da pessoa: o idioma vem antes dela. O documento 1_SPEC.md, escrito sob a hipótese antiga, foi reescrito.
- O passo de modelos não pode ser travado: pular segue possível de propósito, e o que o trava é só o "Continuar" sem provedor (`stepProblem`, `SetupWizard.tsx:50-57`), que não muda.

## Perguntas abertas

- Só uma, e não trava este ciclo: como uma marca de "prévia" apareceria num catálogo de skills. Depende da issue de número 103 e da decisão de onde vem o conteúdo. A lacuna de fundo: não há pasta de skills trazida pelo aplicativo (`docs.skillsDirs` é só uma lista de pastas, `src/shared/config/types.ts:162`) e o ciclo cita uma skill de pipeline que ninguém entrega (`src/shared/config/types.ts:435-437`; `src/main/feedback.ts:36-39`).

## Onde o trabalho está

- Triagem em `docs/cycles/[redacted]/0_TRIAGE.md`: pedido de funcionalidade, squad `experiencia`, prioridade sugerida média. Refino concluído em `docs/cycles/[redacted]/1_SPEC.md`, já na ordem fixada pela pessoa: 11 regras, 11 critérios de aceite, o catálogo de skills fora do escopo.
- Plano escrito em `docs/cycles/[redacted]/2_PLAN.md`: reordenar `WIZARD_STEPS` (idioma, modelos, sdk, …), a chave nova da frase nos dois catálogos `wizard.*.json` renderizada em `ModelsStep.tsx` ao lado de `wizard.models.noSubscription` (`:221-224`), `wizard.subtitle.first` reescrito, a tabela de arquivos e funções, os riscos com como são cobertos, a ordem de trabalho e a linha do `CHANGELOG.md` sob `## [Unreleased]`.
- Próxima etapa (implementação): seguir o 2_PLAN.md na ordem de trabalho; os testes que travam a ordem e os catálogos são `test/wizard-shared.test.ts` e `test/wizard-i18n.test.ts` (este último pega a chave nova sozinho, porque varre `src/renderer/src/wizard` e expande `wizard.step.${...}` a partir de `WIZARD_STEPS`).
- Gate do repositório a rodar e a reportar: `nvm use`, `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.
- Nada do catálogo de skills do Coxia entra aqui: está registrado noutra issue e espera a decisão de onde vem o conteúdo.
- Passagem support → product-owner: Refinar e planejar apenas o que restou no escopo: qual é a primeira tela do assistente de instalação nova e o que acontece com o passo de idioma e nome, mais a frase em uma linha dizendo que sem um modelo nenhum agente roda (dita quando a pessoa pula o passo de modelos e no próprio passo). O editor de provedores já vive dentro do passo de modelos, então não há tela nova a desenhar: conferir por leitura `src/shared/wizard.ts:10,14`, `src/renderer/src/wizard/SetupWizard.tsx:51-53,287-288` e `src/renderer/src/wizard/steps/ModelsStep.tsx:221-348`. O `wizard.subtitle.first` hoje diz que todo passo … <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejar e implementar com o escopo do 1_SPEC.md, na ordem que a pessoa fixou: idioma e nome continua o primeiro passo da instalação nova e mantém o botão "Configurar depois"; a escolha de modelo passa a ser o segundo passo, com a frase nova de uma linha dizendo que sem provedor nenhum agente roda (chave nova nos catálogos `wizard.en.json` e `wizard.pt-BR.json`), continua pulável e continua bloqueando "Continuar" sem provedor. Ajustar `wizard.subtitle.first`, que hoje diz que todo passo fora o primeiro e o último pode ser pulado, para a nova ordem e para parar de apontar a conclusão da configu… <!-- handoff:21 -->
