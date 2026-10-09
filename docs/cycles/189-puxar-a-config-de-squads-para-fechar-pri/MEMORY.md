# Memória do ciclo

## Decisões

- Triagem da 189 fechada: **pedido de processo (condução do ciclo)**, não bug de código — reemitir a prioridade por squad usando a config de squads do workspace; label do tracker sai da regra priority-ordering.md; troca feita por leitura.
- Local dos materiais, dado por quem abriu a issue: regra em `.claude/rules/priority-ordering.md` do checkout do app (cartão carrega a prioridade da primeira entrada de devCycle.priority.labels que case com uma label da issue, hoje priority:high/medium/low; ref não desempata; gravar prioridade é proposta auditada); ata da retro de 2026-10-08 na pasta de dados do workspace. Ambos fora do GitHub de propósito (auditoria pública mantém `.claude/` e a pasta de dados fora) — conteúdo só como resumo da resposta, **não verificado por leitura direta**.
- Config de squads do workspace (resumo da mesma resposta, não verificado no config real): **plataforma** — runtime do Coxia (runner, sandbox, motores de agente, provedores de código, config, fronteira de segurança); paths src/main/runner, src/main/sandbox, src/main/engine; liaison tl-plataforma. **experiência** — o que a pessoa vê e ouve (telas, cerimônias, voz, catálogos de texto); paths src/renderer, src/shared/i18n, sidecar; liaison tl-experiência. Scope (paths e labels de área) é o gancho de alocação.
- Sugestão registrada (não decisão): priority:medium; squad plataforma, por ser o que cuida da fronteira de config; item de condução, não ciclo de código.
- Resposta: **Esclarecimento** Os dois textos existem e são locais de propósito (a auditoria pública mantém `.claude/` e a pasta de dados do espaço de trabalho fora do GitHub). O conteúdo que a issue precisa: **Regra priority-ordering.md** — fica em `.claude/rules/priority-ordering.md` do checkout do repositório do app. Em resumo: o cartão carrega a prioridade da primeira entrada de devCycle.priority.labels (da mais alta para a mais baixa) que case com uma label da issue — hoje priority:high, priority:medium, priority:low; ref não desempata; gravar prioridade é proposta auditada. **Config de squads (do es… <!-- answer:13 -->

## Restrições

- Só leitura nesta etapa; código do app não tem tratamento de prioridade (busca em src/** sem ocorrência) — a reemissão se exerce fora do código, com o que o config expõe.
- Nada de empresa, host real, número de issue real ou segredo em qualquer texto do repositório (auditoria pública).

## Tentado e descartado

- Achar a regra e a ata no repositório: não estão (fora do GitHub de propósito); obtidos como resumo da resposta.

## Perguntas abertas

- Nenhuma.

## Onde o trabalho está

- 0_TRIAGE.md escrito e atualizado com a resposta de quem abriu a issue; etapa de triagem concluída. Próxima etapa: refinamento do produto, que propõe a prioridade e pode ler os dois textos nos locais informados.
