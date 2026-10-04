# Triagem: sugestão de agentes novos a partir do ciclo

## Tipo

Pedido de funcionalidade (a issue veio rotulada `enhancement`). Não relata defeito, não é pergunta e não repete outra issue: pede que o sistema proponha, sozinho, um agente novo a partir do que o ciclo ensina.

Três coisas são pedidas, e vale separá-las:

- uma sugestão com nome, papel, a etapa que cobriria e um esboço de prompt;
- uma decisão sobre a sugestão — aceitar, editar ou recusar — **registrada**, de modo que uma recusa não volte igual;
- a evidência à vista: a issue diz, em palavras próprias, "no suggestion without the evidence that produced it".

Nada é aplicado em silêncio: aceitar cria um agente comum, que a pessoa edita depois.

## Dá para entender como está escrita

Dá. O comportamento pedido trata um agente como entidade — criar, editar, excluir, com etapa —, e isso já existe no código. O que a issue pede é a parte que aprende, e essa parte não existe.

- **O agente já é entidade.** `AgentDef` tem `id` (também o nome da `@menção`), `name`, `job`, `model`, `stages`, `permission`, `tracker`, `shell`, `autonomous` e `turnsTo` (`src/shared/config/types.ts:512-548`; `stages` em `:521`, `autonomous` em `:533`, `turnsTo` em `:538`); o time é `agents.team` (`:593`) e o editor fica em Configurações › Time. Criar, editar e excluir existem: `addAgent`, `updateAgent` e `removeAgent` (`src/shared/config/team.ts:84,97,110-122`). A nota da issue ("Depends on agents existing as entities") está atendida.
- **As etapas que a sugestão cobriria são dados do workspace, não código.** `devCycle.stages` é uma lista de `StageDef` com `type`, `agentId`, `produces`, `next`, `returnsTo` e `roundLimit` (`src/shared/config/types.ts:203-234`, `:419`), e o fluxo é dado, não código (`docs/cycles.md:70-86`). O modelo `agent-flow` hoje é `triage → refine → gate1 → plan → gate2 → implement → review → qa → ready → communicate` (`docs/cycles.md:49`). Quem trabalha uma etapa é o agente que a etapa nomeia ou o primeiro do time que lista a etapa (`stageAgent`, `src/shared/config/team.ts:68-73`).
- **Não há nenhuma sugestão de agente hoje.** O único "suggest" fora do editor é o assistente de preparação, `src/shared/wizard.ts`, e ele recomenda outras coisas: `recommendModel`, `recommendRoles` e a lista `CycleTemplateInfo` de modelos de ciclo, com `patch`, `ceremonies` e `team`. `AgentDef` não é o que ele propõe; a aparição de agente ali é `team?: AgentDef[]` de um modelo, um time fixo que o modelo traz.
- **O que a resposta manda observar é gravado, em boa parte.** A execução é um JSON por execução em `<dados>/workspaces/<id>/runs/<id>.json` (`docs/cycles.md:111`) e guarda a etapa e suas tentativas (`stages`), a pergunta pendente (`question`, com `kind` `agent`/`review-limit`/`squad`), as devoluções por etapa com o motivo e o limite de rodadas (`returns`, `roundLimit`, `src/shared/runs/transitions.ts:441-452`), o histórico tipado (`HistoryEntry`, com `question`, `question-passed`, `answer`, `handBack`, `sent-back`, `gate-rejected`, `gate-skipped`, `stage-returned`) e as rodadas de revisão e as passadas de QA com os cenários e a gravidade (`reviews`, `qa`; `src/shared/runs/types.ts:337-393`, `:172-232`). O corpo dos comentários por etapa fica em `Run.comments` (`:381-382`) e as mensagens na conversa da execução, `<dados>/workspaces/<id>/forum/run-<id>.jsonl` (`docs/cycles.md:119-121`). As atas e decisões das cerimônias ficam em `historico/<id>.json` e nas atas versionadas (`SavedCeremony`, `src/shared/types.ts:237-259`; `src/main/historyFiles.ts`, `src/main/minutesStore.ts`). A transcrição da cerimônia já é gravada (`Minutes.transcript`, `src/shared/types.ts:190-199`), embora a resposta a deixe para depois.
- **A "última milha" da proposta já existe para outras escritas.** As propostas do app esperam em Ações: `proposeVcsAction` (`src/main/actions.ts:167-197`) grava a proposta e os `approveAction`/`skipAction` (`:481`, `:550`) a executam ou pulam, com registro de auditoria. Um agente que lê o host de código já propõe uma issue assim (`docs/runner.md:64`), o que é o vizinho mais próximo do que a issue pede.
- **Duas peças da resposta não têm hoje onde se apoiar sem desenho novo.** O ciclo que uma execução segue é uma cópia do fluxo do workspace, guardada em `Run.flow` (`docs/cycles.md:86`), e existe um caminho de dados para mudá-lo (`runs:migrateFlow`, `src/main/runner/service.ts:800-810`); por isso "cobrir uma etapa" ou se apoia numa etapa existente do workspace ou pede uma etapa nova. E o comando que a pessoa permite de novo e de novo só existe vivo na memória do runner (`commands`, `src/main/runner/service.ts:271-309`; a resposta é pedida em `:771-779`); o que sobra é a linha de auditoria, não um registro por comando e por dia.

Verificação: leitura da issue, dos documentos do ciclo já versionados (a spec do #9, a spec e a auditoria do #8, a spec do #16 e o changelog da 0.5.0) e do código apontado acima. Nada foi executado; o app não foi aberto e o comportamento não foi reproduzido. A auditoria pública não pôde ser rodada nesta etapa (a etapa não tem como executar comandos), então as citações desta triagem ficam não verificadas por ela.

## O que falta

A resposta de quem abriu (na conversa da atividade) fechou as quatro decisões de produto que a triagem havia levantado: a sugestão nasce do histórico que o app já grava — execuções, comandos permitidos e as decisões e atas das cerimônias, sem gravar nada novo na primeira versão, e a transcrição completa das cerimônias fica para depois; a decisão é guardada nos dados do workspace, nunca no repositório, com a "impressão" da sugestão (papel + etapa + tipo de evidência) e sem prazo, de modo que uma recusa só volta com evidência nova; a proposta aparece em Ações, com o rascunho à vista e as permissões no mínimo, e aceitar cria um agente comum; e ela é oferecida a pedido (um botão em Configurações › Time) e, por conta própria, só no fim da retro, no máximo duas sugestões por retro.

O que o refino ainda precisa decidir é de outra ordem — como as duas partes que não têm hoje onde se apoiar tomam forma:

- **A etapa que o agente novo cobriria.** As etapas são dados do workspace (`devCycle.stages`), então "cobrir uma etapa" ou se apoia numa etapa que já existe ou cria uma etapa nova no fluxo; hoje só há um caminho que mexe no fluxo de uma execução (`runs:migrateFlow`), não um caminho para a proposta alterar o ciclo. A resposta não diz onde a sugestão encaixa.
- **A evidência dos comandos permitidos.** Os pedidos de comando vivem em memória enquanto a etapa vive (`PendingCommand`, `src/shared/runs/types.ts:59-66`); o que fica é a linha de auditoria. Dizer "o mesmo comando permitido de novo e de novo" pede uma leitura que hoje só existiria por esse caminho ou pediria o registro por comando e por dia.

Nada do que falta é pergunta para quem abriu a issue: é recorte técnico da etapa seguinte.

## Issues relacionadas

- **#3 (agentes como entidade)** — é o que a nota da issue chama de dependência. Já está entregue: criar, editar e excluir agente existem. Não é duplicata.
- **#9 (o ciclo de desenvolvimento e o runner)** — define o que é uma execução, a pasta do ciclo, a conversa e as etapas com agente, que é a base sobre a qual uma sugestão agiria; a própria spec do #9 põe "suggesting new agents (#5)" em fora de escopo. Não é duplicata.
- **#16 (as melhorias da retro viram tarefa de agente)** — também transforma algo que a cerimônia levanta numa proposta que a pessoa aceita ou recusa, mas o que ela levanta é uma melhoria de processo, que vira issue e execução; não é um agente novo. Vizinha em forma, não em conteúdo. Não é duplicata.
- **#4 (agentes passam trabalho entre si)** — entregue junto do #9 (`turnsTo`, a cadeia de perguntas); sustentaria um agente sugerido que pergunta a outro, mas não é o que esta issue pede. Não é duplicata.
- **#6 e #7 (a conversa dirige o próximo ciclo; o radar que age)** — a direção do produto as agrupa com a #5 como "o que o ciclo aprende e o que ele faz com isso"; podem compartilhar insumo (o que a cerimônia registra), mas são mudanças distintas. Não são duplicatas.
- **#8 (as cerimônias têm três trabalhos)** — a spec registra "suggesting new agents" fora do escopo dela; a #5 é a issue própria desse item. Não é duplicata.
- Nenhuma issue parece duplicar esta.
