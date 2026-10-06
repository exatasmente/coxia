# O onboarding começa pelo modelo e avisa quem segue sem ele

## Tipo

Pedido de funcionalidade. Não relata defeito, não é pergunta e não repete outra issue: pede que a instalação nova comece pela escolha de como o aplicativo fala com um modelo, antes de qualquer outra integração, e que o assistente diga que sem um modelo nenhum agente roda. O pedido de o aplicativo trazer as próprias skills num catálogo saiu deste escopo por decisão de quem abriu.

## Dá para entender como está escrita

Dá para entender como está escrita, e o que ela descreve do estado atual confere com o código:

- Hoje a instalação nova abre no passo de idioma e nome, e o passo de modelos é o segundo de nove: `WIZARD_STEPS` começa em `language` e segue `models, sdk, projects, integrations, docs, cycle, voice, review` (`src/shared/wizard.ts:10`; a ordem é a mesma em que as telas são montadas, `src/renderer/src/wizard/SetupWizard.tsx:37-47`). É o passo de idioma que traz o botão "Configurar depois", que fecha o assistente a partir do primeiro passo (`SetupWizard.tsx:288`); qualquer outro passo pulado é pulado com o botão "Pular esta etapa" (`SetupWizard.tsx:287`).
- O passo de modelos é pulável (`SKIPPABLE_STEPS`, `src/shared/wizard.ts:14`), mas pular não é o mesmo que seguir sem escolher: o problema de etapa impede avançar com zero provedores (`stepProblem`, `SetupWizard.tsx:51-53`; texto em `wizard.problem.noProvider`, catálogos `src/shared/i18n/wizard.en.json:42` e `wizard.pt-BR.json`). O único caminho que deixa o workspace sem provedor é fechar o assistente no primeiro passo ("Configurar depois") ou chegar ao fim por outro passo.
- O editor de provedores já vive dentro do passo de modelos: a pessoa adiciona, testa, troca a chave e escolhe o modelo de cada papel na própria tela (`ModelsStep.tsx:221-268,270-348`). O que falta para "configurar o modelo primeiro" é só a posição da etapa, não a tela.
- Nenhum texto diz, sobre o modelo, que sem ele nenhum agente roda. O que existe perto disso: no passo de modelos há um aviso de que o Coxia usa chave de API ou credenciais de nuvem e que a assinatura claude.ai não é oferecida (`wizard.models.noSubscription`); no passo do SDK, que instala o motor Claude, há um aviso de que dá para pular e que os provedores Claude não funcionarão até a instalação (`wizard.sdk.skipHint`); e a revisão final avisa que os provedores que usam o SDK não instalado não vão funcionar (`wizard.review.sdkWarn`).
- A frase que o pedido quer é verdadeira no comportamento atual, por leitura: sem provedor configurado, a chamada de um agente falha ao resolver o papel (`target`, `src/main/config-resolve.ts:124-126`, texto `main.config.noProvider`), e a revisão final do assistente já lista os papéis que apontam para um provedor que não existe (`ReviewStep.tsx:58`). Nenhuma dessas telas diz isso em palavras claras durante o passo de modelos.

Verificação: leitura da issue, do código citado e dos catálogos de texto. Nada foi executado e nada foi visto funcionando: o estado atual foi conferido apenas por leitura.

## O que falta

Nada que a triagem precise ouvir de quem abriu para seguir: o que restou no escopo está escrito e conferido no código. A única pergunta feita a quem abriu, sobre onde vivem hoje as skills que o próprio ciclo do repositório cita e quem forneceria o conteúdo do catálogo, foi respondida com a redução do escopo ao assistente. Se o pedido for reaberto pela pessoa, a lacuna que fica registrada é a do conteúdo do catálogo de skills: não há, no repositório, nenhuma pasta de skills trazida pelo aplicativo (`docs.skillsDirs` é só uma lista de pastas, `src/shared/config/types.ts:162`), e o ciclo do repositório cita uma skill de pipeline que ninguém entrega (`src/shared/config/types.ts:435-437`; `src/main/feedback.ts:36-39`).

## Issues relacionadas

- O ciclo de agentes deste repositório traz o próprio time de agentes de fábrica (`AGENT_FLOW_STAGES`, `agentFlowTeam` em `src/shared/cycles/templates/agentFlow.ts:26-38,50-59`) e a migração que os entrega escreve o ciclo e os agentes direto no arquivo de configuração (`src/shared/config/migrations.ts:208`). É o precedente de "trazer algo pronto dentro do aplicativo", que é o que o catálogo de skills pedia. Relacionada, não duplicata.
- Nenhuma issue encontrada que peça o mesmo comportamento; a busca foi feita no diretório de ciclos deste repositório e nos documentos de trabalho. O catálogo de skills saiu deste ciclo por decisão de quem abriu, que o registrou como uma issue de número 103; essa issue não pôde ser lida aqui.

## Squad proposto

`experiencia`. O que sobrou na issue muda o que a pessoa vê e lê no onboarding: qual é a primeira tela do assistente e a frase que explica o que falta sem um modelo. As telas do assistente e os catálogos de texto são o escopo desse squad (`src/renderer`, `src/shared/i18n`). O motor e os provedores de modelo, que a issue mantém fora de escopo, são do outro squad.

## Prioridade sugerida

`priority:medium`, como sugestão a quem decide. O que resta não bloqueia nenhuma instalação: o passo de modelos já é o segundo de nove e já impede avançar com zero provedores (`src/shared/wizard.ts:10,14`; `SetupWizard.tsx:51-53`). O que falta é a frase e a posição da etapa, então a prioridade alta do rótulo atual ficou acima do que a triagem vê.
