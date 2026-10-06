# Memória do ciclo

## Decisões

- A pessoa fixou a ordem: a configuração do modelo é depois do idioma, e o restante dos passos depende dela — sem modelo não há como usar o app. Idioma e nome continua o primeiro passo da instalação nova e a escolha de modelo passa a ser o segundo; "Configurar depois" fica no primeiro passo, e o passo de modelos oferece só "Pular esta etapa". <!-- answer:18 -->
- O catálogo de skills do Coxia saiu deste ciclo por decisão de quem abriu, registrado como a issue de número 103, que espera a decisão de onde vem o conteúdo. <!-- answer:8 -->
- Prioridade sugerida na triagem: média; o rótulo atual da issue é priority:high.
- Gates 1 e 2 aprovados; o 2_PLAN.md foi seguido sem reabrir escopo.

## Restrições

- A ordem vive numa lista única (`WIZARD_STEPS`, `src/shared/wizard.ts:10`) e as telas são montadas por id (`BODY`): mover o id move tela, rail e contador sem reescrever nada.
- "Pular esta etapa" sai de `SKIPPABLE_STEPS` e "Configurar depois" de `firstRun && index === 0` (`SetupWizard.tsx:229,287-288`): são condições de posição e de identidade, então os botões seguem a ordem sozinhos — nenhuma tela do assistente precisou de mudança além do `Notice` novo.
- Toda frase nova passa pelo `t()`, com chave nos dois catálogos `wizard.en.json` e `wizard.pt-BR.json`; cores só por tokens de tema.
- O passo de modelos continua pulável e continua bloqueando "Continuar" sem provedor (`stepProblem`): a frase nova explica, não substitui o bloqueio.
- O repositório guarda um retrato dos catálogos como estavam na main (`test/fixtures/catalogs-main`, `test/gitlab-catalogs-unchanged.test.ts`): mudar `wizard.subtitle.first` exige listar a diferença pretendida com o motivo. Foi feito.

## Tentado e descartado

## Perguntas abertas

## Onde o trabalho está

- Implementação feita nesta tentativa, com o documento em `docs/cycles/[redacted]/3_IMPLEMENTATION.md`. Arquivos: `src/shared/wizard.ts` (comentário), `src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`, `src/renderer/src/wizard/steps/ModelsStep.tsx`, `test/wizard-shared.test.ts`, `test/gitlab-catalogs-unchanged.test.ts`, `CHANGELOG.md`.
- Próxima etapa: revisar e entregar (abrir o pull request). Uma conferência manual, numa pasta de dados própria (`CERIMONIAS_DATA_DIR`) e nunca num workspace real: instalação nova abre em "Idioma e nome" (1 de 9, "Configurar depois", sem "Pular esta etapa"); "Continuar" cai em "Modelos" (2 de 9) com a frase nova ao lado do aviso de assinatura; "Pular esta etapa" segue para o passo do SDK e não fecha o assistente; "Continuar" sem provedor continua pedindo ao menos um provedor.
- Nada do catálogo de skills do Coxia entra aqui.
- Passagem support → product-owner: Refinar e planejar apenas o que restou no escopo: qual é a primeira tela do assistente de instalação nova e o que acontece com o passo de idioma e nome, mais a frase em uma linha dizendo que sem um modelo nenhum agente roda (dita quando a pessoa pula o passo de modelos e no próprio passo). O editor de provedores já vive dentro do passo de modelos, então não há tela nova a desenhar: conferir por leitura `src/shared/wizard.ts:10,14`, `src/renderer/src/wizard/SetupWizard.tsx:51-53,287-288` e `src/renderer/src/wizard/steps/ModelsStep.tsx:221-348`. O `wizard.subtitle.first` hoje diz que todo passo … <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejar e implementar com o escopo do 1_SPEC.md, na ordem que a pessoa fixou: idioma e nome continua o primeiro passo da instalação nova e mantém o botão "Configurar depois"; a escolha de modelo passa a ser o segundo passo, com a frase nova de uma linha dizendo que sem provedor nenhum agente roda (chave nova nos catálogos `wizard.en.json` e `wizard.pt-BR.json`), continua pulável e continua bloqueando "Continuar" sem provedor. Ajustar `wizard.subtitle.first`, que hoje diz que todo passo fora o primeiro e o último pode ser pulado, para a nova ordem e para parar de apontar a conclusão da configu… <!-- handoff:21 -->
- Passagem tl-experiencia → pessoa: Implementar seguindo o `docs/cycles/[redacted]/2_PLAN.md`, na ordem de trabalho dele, sem reabrir escopo: (1) reordenar `WIZARD_STEPS` em `src/shared/wizard.ts:10` para `['language', 'models', 'sdk', 'projects', 'integrations', 'docs', 'cycle', 'voice', 'review']` e ajustar o comentário acima de `SKIPPABLE_STEPS` (`:14`), que continua com `models` e sem `language`; (2) acrescentar a chave nova da frase de uma linha nos catálogos `src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json` (mesma chave, sem placeholders) e renderizá-la em `src/renderer/src/wizard/steps/ModelsStep.tsx` junto de `wizar… <!-- handoff:35 -->
