# Memória do ciclo

## Decisões

- Triagem da 189 fechada: **pedido de processo (condução do ciclo)**, não bug de código — reemitir a prioridade por squad usando a config de squads do workspace; prioridade por squad é decisão conduzida pelo ciclo, não funcionalidade do app (nenhum tratamento de prioridade em src; `src/shared/config/defaults.ts` sem prioridade). Modelo verificado por leitura: `SquadDef`/`SquadScope`/`SquadPath` em `src/shared/config/types.ts` (mission, scope: repos/labels/paths/unclaimed, liaison, label de squad), leituras em `src/shared/config/squads.ts` (squadsOf, squadOf, hasSquads).
- Refinamento concluído: `1_SPEC.md` — não muda código. Regras: lista de squads só da config real; alocação pelo scope; unclaimed como fallback; rótulo do tracker pela primeira entrada de devCycle.priority.labels que case, só label simples; gravação no tracker só proposta auditada; reemissão documentada com análise por squad e comparativo com a decisão original.
- Plano concluído: `2_PLAN.md` — sem mudança de código. Ordem: ler a regra, ler a ata de 2026-10-08, ler a config real de squads, análise de alocação por squad, proposta de rótulo por último e travada; saída com lista de squads, análise de adesão, squad designado, rótulo proposto e comparativo com a decisão original. Risco principal mitigado: alocação por domínio sem casar com escopo — toda atribuição cita entradas exatas da config.
- Config de squads do workspace (resumo da resposta, **não verificado na config real**; a execução lê a config e o resumo perde valor): **plataforma** — runtime do Coxia (runner, sandbox, motores de agente, provedores de código, config, fronteira de segurança; paths src/main/runner, src/main/sandbox, src/main/engine; liaison tl-plataforma). **experiência** — o que a pessoa vê e ouve (telas, cerimônias, voz, catálogos de texto; paths src/renderer, src/shared/i18n, sidecar; liaison tl-experiência).
- Regra priority-ordering.md em `.claude/rules/priority-ordering.md` do checkout do app e ata da retro de 2026-10-08 na pasta de dados do workspace: conteúdo só como resumo da resposta, **não verificado por leitura direta em nenhuma etapa até aqui**; a execução lê ambos nos locais informados.
- Resposta: **Esclarecimento** Os dois textos existem e são locais de propósito (a auditoria pública mantém `.claude/` e a pasta de dados do espaço de trabalho fora do GitHub). O conteúdo que a issue precisa: **Regra priority-ordering.md** — fica em `.claude/rules/priority-ordering.md` do checkout do repositório do app. Em resumo: o cartão carrega a prioridade da primeira entrada de devCycle.priority.labels (da mais alta para a mais baixa) que case com uma label da issue — hoje priority:high, priority:medium, priority:low; ref não desempata; gravar prioridade é proposta auditada. **Config de squads (do es… <!-- answer:13 -->

## Restrições

- Nenhuma etapa desta execução tem acesso de leitura fora da pasta de trabalho: a regra e a ata são lidas pela etapa que executa, com acesso dado pela pessoa se precisar.
- Nada de empresa, host real, número de issue real ou segredo em qualquer texto do repositório (auditoria pública).
- Rótulo do tracker nunca sai de expressão de casamento: só label simples.

## Tentado e descartado

- Achar a regra e a ata no repositório: não estão (fora do GitHub de propósito); obtidos como resumo da resposta. Tentativa de leitura direta fora da pasta de trabalho: recusada pelo limite de acesso da instância.

## Perguntas abertas

- Nenhuma que bloqueie; os locais dos dois materiais fora do repositório são os da resposta de quem abriu a issue.

## Onde o trabalho está

- Plano completo: `2_PLAN.md` na pasta do ciclo (insumos e ordem, passos da análise, saída exigida, riscos, os seis critérios da spec todos cobertos). Propostas da pessoa aguardando aceite: priority:medium; marco condução do ciclo; squad plataforma.
- Próxima etapa: execução da reemissão — ler a regra e a ata nos locais informados, então a config real de squads do workspace, atribuir pelo scope citando entradas, propor o rótulo pela ordenação de priority.labels; gravação no tracker sempre proposta auditada esperando aceite.
- Passagem support → product-owner: Triagem fechada: pedido de processo de condução do ciclo. Conteúdo da regra e da ata só como resumo; quem executa lê ambos nos locais informados. Sugestão: priority:medium. <!-- handoff:20 -->
- Passagem product-owner → pessoa: conduzir a reemissão conforme 1_SPEC.md — ler regra e ata, então a config real de squads, atribuir pelo scope, propor rótulo, gravação como proposta auditada.
- Passagem product-owner → pessoa (planejamento): seguir o plano em 2_PLAN.md.
- Passagem product-owner → pessoa: Planejamento (ou a etapa que executa este pedido de processo): conduzir a reemissão da prioridade por squad conforme 1_SPEC.md — primeiro ler a regra priority-ordering.md em `.claude/rules/` do checkout do app e a ata da retro de 2026-10-08 na pasta de dados do workspace (conteúdo hoje só conhecido como resumo, não verificado por leitura direta); depois ler a lista real de squads na config do workspace (mission, scope, liaison), atribuir cada trabalho pelo scope (paths e labels de área), propor o rótulo do tracker pela ordenação de priority.labels e deixar a gravação do rótulo como proposta au… <!-- handoff:31 -->
