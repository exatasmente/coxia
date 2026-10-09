# Memória do ciclo

## Decisões

- Triagem da 189 fechada: **pedido de processo (condução do ciclo)**, não bug de código — reemitir a prioridade por squad usando a config de squads do workspace; prioridade por squad é decisão conduzida pelo ciclo, não funcionalidade do app (`src/shared/config/types.ts`/`squads.ts`, sem prioridade em `src`).
- Execução concluída (3_IMPLEMENTATION.md): regra priority-ordering.md, ata da retro de 2026-10-08 e config real de squads lidos diretamente. Config real: **plataforma** (paths src/main/runner, sandbox, engine, vcs, actions.ts, webPolicy.ts, src/shared/config, src/shared/runs; label area:plataforma; unclaimed false) e **experiencia** (paths src/renderer, src/shared/i18n, sidecar; label area:experiencia); priority.labels = ^priority:high$, ^priority:medium$, ^priority:low$.
- Alocação reemitida: reemissão → **plataforma**, pelas entradas citadas da config (path src/shared/config, label area:plataforma); fallback unclaimed não acionado.
- Rótulo: **priority:medium** proposto, aceito pelo tech lead e registrado na issue pelo step de tech lead; alternativa da leitura literal (nada escrever) registrada no doc.
- Revisão (4_REVIEW.md) fechou **aprovado**: diff da branch só traz MEMORY.md (nada em src, confirmando a fronteira da spec); seis critérios cobertos; dois achados de sugestão, nenhum bloqueante; modelo de squad confirmado por leitura em src/shared/config, regra de label simples lida em src/shared/board.ts.
- QA (5_TEST_PLAN.md) executada: 8 cenários derivados dos critérios de aceite — 01–05 e 07 pass (01 sem mudança em src por busca; 02/03 campos de SquadDef/SquadScope e regra de label simples lidos em types.ts/board.ts/validate.ts; 04 auditoria pública exit 0 sobre 1516 arquivos; 05 tsc/theme-audit/i18n:lint exit 0; 07 rótulo `priority:medium` reconferido nesta tentativa por leitura direta da issue 189 no tracker via ferramenta de leitura de code-host — fecha o ponto aberto da revisão — issue open, labels [priority:medium], sem milestone). 06 (suíte vitest) **not-run**: o runner não iniciou no ambiente da etapa (EROFS ao gravar a config temporária em node_modules). 08 confirmou os dois achados da revisão como reais, non-blocking (typo `labela` ainda presente, linha 28).
- Resposta: **Esclarecimento** Os dois textos existem e são locais de propósito (a auditoria pública mantém `.claude/` e a pasta de dados do espaço de trabalho fora do GitHub). O conteúdo que a issue precisa: **Regra priority-ordering.md** — fica em `.claude/rules/priority-ordering.md` do checkout do repositório do app. Em resumo: o cartão carrega a prioridade da primeira entrada de devCycle.priority.labels (da mais alta para a mais baixa) que case com uma label da issue — hoje priority:high, priority:medium, priority:low; ref não desempata; gravar prioridade é proposta auditada. **Config de squads (do espaço de trabalho)** — subclasses leem a config real: squad plataforma (runtime) e experiencia (telas/voz/catálogos), com mission, scope e liaison de cada um. <!-- answer:13 -->
- Resposta: @developer Resposta do tech lead: proposta de rótulo aceita — `priority:medium`. Fundamento: a reemissão está bem documentada em 3_IMPLEMENTATION.md com leitura nova dos três insumos (regra, ata da retro e config real de squads) e a designação do squad plataforma confirmada pelas entradas da config (path src/shared/config, label area:plataforma). Para o rótulo: a issue está sem label hoje, então a ordenação sozinha não casa nada e o cartão ficaria sem prioridade na leitura literal; priority:medium é label simples válida (segunda entrada de devCycle.priority.labels), era a hipótese do refinamento e é a escolha certa — é uma conferência de qualidade de decisão, sem bloquear código em andamento. O rótulo foi registrado na issue como proposta de label, visível no tracker, depois confirmado pela QA por leitura direta. <!-- answer:75 -->

## Restrições

- Nada de empresa, host real, número de issue real alheia ou segredo em qualquer texto do repositório (auditoria pública).
- Rótulo do tracker sai só de label simples; nunca de expressão de casamento.
- Gravação no tracker: sempre proposta auditada esperando aceite da pessoa.

## Tentado e descartado

- Resumos anteriores da regra, da ata e da config: descartados em favor da leitura direta.
- Leitura literal da regra (issue sem label → não escrever no tracker): registrada, descartada pelo aceite do medium.
- Rodar a suíte vitest na etapa de QA: descartado — o ambiente da etapa tem node_modules somente leitura e o runner falha ao materializar a config temporária (EROFS); não é falha do código nem do ciclo.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Ciclo 189 completo até a QA: revisão aprovada, QA executada (5_TEST_PLAN.md, evidências: ev-2 a ev-6 e ev-8 por comandos da etapa, ev-9 pela leitura direta do tracker, guardada nesta tentativa). Pendência menor e non-blocking: typo `labela`→`labels` em 3_IMPLEMENTATION.md linha 28 e a narrativa da aceitação misturada ao critério 5 — ficam como achados da revisão; nenhum critério de aceite é afetado; correção dos docs só vale se alguém quiser um pass extra de documentação.
- Fora do repositório: levar a decisão reemitida à ata da próxima retro (ato da pessoa); reverter o rótulo no tracker, se a pessoa preferir (o rótulo está lá, reconferido por leitura direta, ev-9).
- Não verificado por esta execução: a suíte completa de testes nunca rodou nas etapas; conteúdo da regra priority-ordering.md e da ata de 2026-10-08 foi lido apenas pelas etapas de plano/execução (arquivos fora do repositório de propósito).
- Ciclo encerrável: entregas 0–5 completas, auditoria pública verde, tracker consistente com a decisão documentada.
- Passagem support → product-owner: Triagem fechada: pedido de processo de condução do ciclo, entendido, sem duplicadas e sem pendência de informação. O conteúdo da regra priority-ordering.md (.claude/rules/priority-ordering.md do checkout do app) e da retro de 2026-10-08 (pasta de dados do workspace) é resumo dado por quem abriu a issue, não verificado por leitura direta; a próxima etapa que for executar deve ler ambos nos locais informados. Refinamento propõe a prioridade (sugestão: priority:medium). <!-- handoff:20 -->
- Passagem product-owner → pessoa: Planejamento (ou a etapa que executa este pedido de processo): conduzir a reemissão da prioridade por squad conforme 1_SPEC.md — primeiro ler a regra priority-ordering.md em `.claude/rules/` do checkout do app e a ata da retro de 2026-10-08 na pasta de dados do workspace (conteúdo hoje só conhecido como resumo, não verificado por leitura direta); depois ler a lista real de squads na config do workspace (mission, scope, liaison), atribuir cada trabalho pelo scope (paths e labels de área), propor o rótulo do tracker pela ordenação de priority.labels e deixar a gravação do rótulo como proposta au… <!-- handoff:31 -->
- Passagem tl-plataforma → pessoa: Execução da reemissão conforme 2_PLAN.md e 1_SPEC.md: ler primeiro a regra priority-ordering.md em .claude/rules/ do checkout do app e a ata da retro de 2026-10-08 na pasta de dados do workspace (hoje só conhecidas como resumo), depois a lista real de squads na config do workspace (mission, scope, liaison); atribuir cada trabalho pelo scope citando as entradas que casam, registrar o sem-adesão como não designado, propor o rótulo do tracker pela primeira entrada de devCycle.priority.labels que case (só label simples) e parar na proposta — nada escrito no tracker antes do aceite da pessoa; regis… <!-- handoff:45 -->
