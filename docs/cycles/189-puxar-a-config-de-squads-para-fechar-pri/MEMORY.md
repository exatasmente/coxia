# Memória do ciclo

## Decisões

- Triagem da 189 fechada: **pedido de processo (condução do ciclo)**, não bug de código — reemitir a prioridade por squad usando a config de squads do workspace; o rótulo do tracker sai da regra priority-ordering.md; a prioridade por squad é decisão conduzida pelo ciclo, não funcionalidade do app (nenhum tratamento de prioridade no código; `src/shared/config/defaults.ts` não traz prioridade). Modelo verificado por leitura: `SquadDef`/`SquadScope` em `src/shared/config/types.ts`, leituras em `src/shared/config/squads.ts` (squadsOf, squadOf, hasSquads).
- Local dos materiais, dado por quem abriu a issue: regra em `.claude/rules/priority-ordering.md` do checkout do app (cartão carrega a prioridade da primeira entrada de devCycle.priority.labels que case com uma label da issue, hoje priority:high/medium/low; ref não desempata; gravar prioridade é proposta auditada); ata da retro de 2026-10-08 na pasta de dados do workspace. Ambos fora do GitHub de propósito — conteúdo só como resumo, **não verificado por leitura direta em nenhuma etapa até aqui** (refinamento não tem acesso de leitura fora da pasta de trabalho).
- Config de squads do workspace (resumo da resposta, não verificado no config real): **plataforma** — runtime do Coxia (runner, sandbox, motores de agente, provedores de código, config, fronteira de segurança; paths src/main/runner, src/main/sandbox, src/main/engine; liaison tl-plataforma). **experiência** — o que a pessoa vê e ouve (telas, cerimônias, voz, catálogos de texto; paths src/renderer, src/shared/i18n, sidecar; liaison tl-experiência). Scope (paths e labels de área) é o gancho de alocação.
- **Refinamento concluído:** `1_SPEC.md` escrito — não muda código. Regras: lista de squads só da config real (mission, scope, liaison); alocação pelo scope; unclaimed como fallback (sem unclaimed, fica decisão da pessoa); rótulo do tracker pela primeira entrada de devCycle.priority.labels que case, só label simples (nunca expressão de casamento); gravação no tracker só como proposta auditada após aceite da pessoa; reemissão documentada com a análise por squad e o comparativo com a decisão original.
- Resposta: **Esclarecimento** Os dois textos existem e são locais de propósito (a auditoria pública mantém `.claude/` e a pasta de dados do espaço de trabalho fora do GitHub). O conteúdo que a issue precisa: **Regra priority-ordering.md** — fica em `.claude/rules/priority-ordering.md` do checkout do repositório do app. Em resumo: o cartão carrega a prioridade da primeira entrada de devCycle.priority.labels (da mais alta para a mais baixa) que case com uma label da issue — hoje priority:high, priority:medium, priority:low; ref não desempata; gravar prioridade é proposta auditada. **Config de squads (do es… <!-- answer:13 -->

## Restrições

- Nenhuma etapa desta execução tem acesso de leitura fora da pasta de trabalho: a regra e a ata são lidas pela etapa que executa, com acesso dado pela pessoa se precisar; o que está nos documentos do ciclo é o resumo dado por quem abriu a issue.
- Nada de empresa, host real, número de issue real ou segredo em qualquer texto do repositório (auditoria pública).

## Tentado e descartado

- Achar a regra e a ata no repositório: não estão (fora do GitHub de propósito); obtidos como resumo da resposta. Tentativa de leitura direta fora da pasta de trabalho: recusada pelo limite de acesso da instância.

## Perguntas abertas

- Nenhuma que bloqueie; os locais informados para os dois materiais fora do repositório são os da resposta de quem abriu a issue.

## Onde o trabalho está

- `1_SPEC.md` completo na pasta do ciclo (regras, fora do escopo, critérios de aceite, sem perguntas bloqueantes); refinamento concluído. Propostas aguardando aceite da pessoa: priority:medium; marco condução do ciclo; squad plataforma.
- Próxima etapa: planejamento/execução da reemissão — ler a regra e a ata nos locais informados, então a config real de squads do workspace, atribuir cada trabalho pelo scope e propor o rótulo; gravação no tracker sempre proposta auditada.
- Passagem support → product-owner: Triagem fechada: pedido de processo de condução do ciclo, entendido, sem duplicadas e sem pendência de informação. O conteúdo da regra priority-ordering.md (.claude/rules/priority-ordering.md do checkout do app) e da retro de 2026-10-08 (pasta de dados do workspace) é resumo dado por quem abriu a issue, não verificado por leitura direta; a próxima etapa que for executar deve ler ambos nos locais informados. Refinamento propõe a prioridade (sugestão: priority:medium). <!-- handoff:20 -->
