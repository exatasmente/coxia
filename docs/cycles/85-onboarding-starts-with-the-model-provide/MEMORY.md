# Memória do ciclo

## Decisões

- A pessoa fixou a ordem: a configuração do modelo é depois do idioma, e o restante dos passos depende dela — sem modelo não há como usar o app. Idioma e nome continua o primeiro passo da instalação nova e a escolha de modelo passa a ser o segundo; "Configurar depois" fica no primeiro passo, e o passo de modelos oferece só "Pular esta etapa". <!-- answer:18 -->
- O catálogo de skills do Coxia saiu deste ciclo por decisão de quem abriu, registrado como a issue de número 103, que espera a decisão de onde vem o conteúdo. <!-- answer:8 -->
- Prioridade sugerida na triagem: média; o rótulo atual da issue é priority:high.
- Gates 1 e 2 aprovados; o 2_PLAN.md foi seguido sem reabrir escopo.
- Revisão (esta etapa): aprovada. A mudança faz o que a especificação pede; a rodada vermelha da suíte inteira é de máquina carregada, não do ciclo.

## Restrições

- A ordem vive numa lista única (`WIZARD_STEPS`, `src/shared/wizard.ts:10`) e as telas são montadas por id (`BODY`): mover o id move tela, rail e contador sem reescrever nada.
- "Pular esta etapa" sai de `SKIPPABLE_STEPS` e "Configurar depois" de `firstRun && index === 0` (`SetupWizard.tsx:229,287-288`): são condições de posição e de identidade, então os botões seguem a ordem sozinhos — nenhuma tela do assistente precisou de mudança além do `Notice` novo.
- Toda frase nova passa pelo `t()`, com chave nos dois catálogos `wizard.en.json` e `wizard.pt-BR.json`; cores só por tokens de tema.
- O passo de modelos continua pulável e continua bloqueando "Continuar" sem provedor (`stepProblem`): a frase nova explica, não substitui o bloqueio.
- O repositório guarda um retrato dos catálogos como estavam na main (`test/fixtures/catalogs-main`, `test/gitlab-catalogs-unchanged.test.ts`): mudar `wizard.subtitle.first` exige listar a diferença pretendida com o motivo. Foi feito.

## Tentado e descartado

- Corrigir nesta etapa o `docs/configuration.md` e a linha do `CHANGELOG.md`: são achados de sugestão, não bloqueiam, e esta etapa não corrige código nem documentos do ciclo; ficam para quem conduz a entrega.

## Perguntas abertas

## Onde o trabalho está

- Implementação e revisão feitas. Documentos em `docs/cycles/[redacted]/`, o último em `4_REVIEW.md`.
- Arquivos da mudança: `src/shared/wizard.ts` (comentário de `SKIPPABLE_STEPS`), `src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json` (chave `wizard.models.noModelNoAgent` e `wizard.subtitle.first`), `src/renderer/src/wizard/steps/ModelsStep.tsx` (`Notice` novo), `test/wizard-shared.test.ts` (ordem por nome e conjunto pulável derivado dela), `test/gitlab-catalogs-unchanged.test.ts` (diferença pretendida), `CHANGELOG.md`.
- Verificado nesta revisão, por execução: testes do assistente + catálogos + retrato da main (22 passaram); `npx tsc --noEmit`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4055 chaves nos dois idiomas) e `node scripts/public-audit.mjs` (910 arquivos) limpos; suíte inteira (222 arquivos) com 217 verdes e 25 testes vermelhos em `conflict-resolve`, `release-git`, `runner-chain`, `update-script` e `conflict-policy` — os cinco passam rodando sozinhos, os estouros são de tempo (5 s/10 s) da máquina carregada.
- Aberto para a entrega: abrir o pull request contra `origin/main`; decidir se `docs/configuration.md` (linhas 138 e 286) passa a contar a regra nova de pular passos neste mesmo pull request e encurtar a linha do `CHANGELOG.md`; e a conferência à mão numa pasta de dados própria (`CERIMONIAS_DATA_DIR`), que nenhuma etapa fez até aqui.
- Nada do catálogo de skills do Coxia entra aqui.
- Passagem support → product-owner: Refinar e planejar apenas o que restou no escopo: qual é a primeira tela do assistente de instalação nova e o que acontece com o passo de idioma e nome, mais a frase em uma linha dizendo que sem um modelo nenhum agente roda (dita quando a pessoa pula o passo de modelos e no próprio passo). O editor de provedores já vive dentro do passo de modelos, então não há tela nova a desenhar: conferir por leitura `src/shared/wizard.ts:10,14`, `src/renderer/src/wizard/SetupWizard.tsx:51-53,287-288` e `src/renderer/src/wizard/steps/ModelsStep.tsx:221-348`. O `wizard.subtitle.first` hoje diz que todo passo … <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejar e implementar com o escopo do 1_SPEC.md, na ordem que a pessoa fixou: idioma e nome continua o primeiro passo da instalação nova e mantém o botão "Configurar depois"; a escolha de modelo passa a ser o segundo passo, com a frase nova de uma linha dizendo que sem provedor nenhum agente roda (chave nova nos catálogos `wizard.en.json` e `wizard.pt-BR.json`), continua pulável e continua bloqueando "Continuar" sem provedor. Ajustar `wizard.subtitle.first`, que hoje diz que todo passo fora o primeiro e o último pode ser pulado, para a nova ordem e para parar de apontar a conclusão da configu… <!-- handoff:21 -->
- Passagem tl-experiencia → pessoa: Implementar seguindo o `docs/cycles/[redacted]/2_PLAN.md`, na ordem de trabalho dele, sem reabrir escopo: (1) reordenar `WIZARD_STEPS` em `src/shared/wizard.ts:10` para `['language', 'models', 'sdk', 'projects', 'integrations', 'docs', 'cycle', 'voice', 'review']` e ajustar o comentário acima de `SKIPPABLE_STEPS` (`:14`), que continua com `models` e sem `language`; (2) acrescentar a chave nova da frase de uma linha nos catálogos `src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json` (mesma chave, sem placeholders) e renderizá-la em `src/renderer/src/wizard/steps/ModelsStep.tsx` junto de `wizar… <!-- handoff:35 -->
- Passagem dev-experiencia → tl-experiencia: Revisar e entregar (abrir o pull request). Antes: (1) ler o fim da rodada inteira da suíte de testes no log `.runlogs-85-full.log` na raiz da árvore, ou rodar `npx vitest run` de novo numa máquina quieta — a rodada ficou com estouros de tempo em arquivos que este ciclo não toca (hooks de 10 s, testes de 5 s e 30 s em conflict/release/voice e em um teste de public-audit), e cada um desses arquivos passa sozinho; não confundir esses estouros com regressão deste ciclo; (2) conferir por leitura que as duas condições do rodapé continuam presas à posição e à identidade (`SKIPPABLE_STEPS`, `firstRun … <!-- handoff:71 -->
