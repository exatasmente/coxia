# Memória do ciclo

## Decisões

- Triagem da 189 fechada: **pedido de processo (condução do ciclo)**, não bug de código — reemitir a prioridade por squad usando a config de squads do workspace; prioridade por squad é decisão conduzida pelo ciclo, não funcionalidade do app (nenhum tratamento de prioridade em src; `src/shared/config/defaults.ts` sem prioridade). Modelo verificado por leitura: `SquadDef`/`SquadScope`/`SquadPath` em `src/shared/config/types.ts` (mission, scope: repos/labels/paths/unclaimed, liaison, label de squad), leituras em `src/shared/config/squads.ts` (squadsOf, squadOf, hasSquads).
- Refinamento concluído: `1_SPEC.md` — não muda código. Regras: lista de squads só da config real; alocação pelo scope; unclaimed como fallback; rótulo do tracker pela primeira entrada de devCycle.priority.labels que case, só label simples; gravação no tracker só proposta auditada; reemissão documentada com análise por squad e comparativo com a decisão original.
- Plano concluído: `2_PLAN.md` — sem mudança de código. Ordem: ler a regra, ler a ata de 2026-10-08, ler a config real de squads, análise de alocação por squad, proposta de rótulo por último e travada; saída com lista de squads, análise de adesão, squad designado, rótulo proposto e comparativo com a decisão original. Risco principal mitigado: alocação por domínio sem casar com escopo — toda atribuição cita entradas exatas da config.
- Implementação concluída: `3_IMPLEMENTATION.md` — nenhum código mudado (pedido de condução do ciclo). Leitura nova e direta dos três insumos: regra (ordenação de `devCycle.priority.labels`: ^priority:high$, ^priority:medium$, ^priority:low$, todas label simples; gravação só como proposta auditada setIssueLabels), ata da retro de 2026-10-08 (duas reclassificações de prioridade na triagem; releases com muitas execuções saltadas; perguntas sem resposta; a pergunta de alocação por squad é a reemitida) e config real de squads (**plataforma**: paths src/main/runner, src/main/sandbox, src/main/engine, src/main/vcs, src/main/actions.ts, src/main/webPolicy.ts, src/shared/config, src/shared/runs, label area:plataforma, liaison tl-plataforma; **experiencia**: paths src/renderer, src/shared/i18n, sidecar, label area:experiencia, liaison tl-experiencia; ambos unclaimed: false).
- Alocação reemitida: reemissão da prioridade → squad **plataforma**, pelas entradas da config (path src/shared/config, label area:plataforma); nada casa com experiencia; fallback não acionado.
- Rótulo: proposta **priority:medium** (a issue não tem label, então a ordenação sozinha não casa nada; medium é a hipótese do refino e label simples válida). **Aceita pelo tech lead e registrada na issue como proposta de label no tracker** — nada mais escrito no tracker.
- Resposta: **Esclarecimento** Os dois textos existem e são locais de propósito (a auditoria pública mantém `.claude/` e a pasta de dados do espaço de trabalho fora do GitHub). O conteúdo que a issue precisa: **Regra priority-ordering.md** — fica em `.claude/rules/priority-ordering.md` do checkout do repositório do app. Em resumo: o cartão carrega a prioridade da primeira entrada de devCycle.priority.labels (da mais alta para a mais baixa) que case com uma label da issue — hoje priority:high, priority:medium, priority:low; ref não desempata; gravar prioridade é proposta auditada. **Config de squads (do es… <!-- answer:13 -->
- Resposta: @developer Resposta do tech lead: proposta de rótulo aceita — `priority:medium`. Fundamento: a reemissão está bem documentada em 3_IMPLEMENTATION.md com leitura nova dos três insumos (regra, ata da retro e config real de squads) e a designação do squad plataforma confirmada pelas entradas da config (path src/shared/config, label area:plataforma), não por opinião de domínio. Para o rótulo: a issue está sem label hoje, então a ordenação sozinha não casa nada e o cartão ficaria sem prioridade na leitura literal; priority:medium é label simples válida (segunda entrada de devCycle.priority.labels),… <!-- answer:75 -->

## Restrições

- Nada de empresa, host real, número de issue real ou segredo em qualquer texto do repositório (auditoria pública).
- Rótulo do tracker nunca sai de expressão de casamento: só label simples.
- Gravação no tracker: proposta auditada esperando aceite da pessoa; a gravação do rótulo desta execução foi feita pela etapa de tech lead após o aceite.

## Tentado e descartado

- Achar a regra e a ata no repositório: não estão (fora do GitHub de propósito); lidas nas tentativas da execução nos locais informados.
- Leitura literal da regra (issue sem label → não escrever nada no tracker): registrada como alternativa, descartada pelo aceite do medium.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- Reemissão completa e documentada em `3_IMPLEMENTATION.md`, com aceitação do rótulo priority:medium registrada (2026-10-09). Nenhuma worktree pendente além de docs/cycles/[redacted]/3_IMPLEMENTATION.md atualizado.
- Pendências fora do repositório: levar a decisão reemitida e o porquê à ata da próxima retro (ato de cerimônia da pessoa); reverter o rótulo, se a pessoa preferir, direto no tracker.
- Passagem para a QA/encerramento: conferir em 3_IMPLEMENTATION.md os seis critérios da spec; nenhum critério de código — expectativa de zero mudanças em src.
- Passagem support → product-owner: Triagem fechada: pedido de processo de condução do ciclo, entendido, sem duplicadas e sem pendência de informação. O conteúdo da regra priority-ordering.md (.claude/rules/priority-ordering.md do checkout do app) e da retro de 2026-10-08 (pasta de dados do workspace) é resumo dado por quem abriu a issue, não verificado por leitura direta; a próxima etapa que for executar deve ler ambos nos locais informados. Refinamento propõe a prioridade (sugestão: priority:medium). <!-- handoff:20 -->
- Passagem product-owner → pessoa: Planejamento (ou a etapa que executa este pedido de processo): conduzir a reemissão da prioridade por squad conforme 1_SPEC.md — primeiro ler a regra priority-ordering.md em `.claude/rules/` do checkout do app e a ata da retro de 2026-10-08 na pasta de dados do workspace (conteúdo hoje só conhecido como resumo, não verificado por leitura direta); depois ler a lista real de squads na config do workspace (mission, scope, liaison), atribuir cada trabalho pelo scope (paths e labels de área), propor o rótulo do tracker pela ordenação de priority.labels e deixar a gravação do rótulo como proposta au… <!-- handoff:31 -->
- Passagem tl-plataforma → pessoa: Execução da reemissão conforme 2_PLAN.md e 1_SPEC.md: ler primeiro a regra priority-ordering.md em .claude/rules/ do checkout do app e a ata da retro de 2026-10-08 na pasta de dados do workspace (hoje só conhecidas como resumo), depois a lista real de squads na config do workspace (mission, scope, liaison); atribuir cada trabalho pelo scope citando as entradas que casam, registrar o sem-adesão como não designado, propor o rótulo do tracker pela primeira entrada de devCycle.priority.labels que case (só label simples) e parar na proposta — nada escrito no tracker antes do aceite da pessoa; regis… <!-- handoff:45 -->
