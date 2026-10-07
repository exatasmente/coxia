# Memória do ciclo

## Decisões

- Triagem concluída: issue é pedido de funcionalidade claro, com critérios de aceite e origem da divisão citada (#54 agora cobre só documentação e dica do gatilho). Sem pergunta à pessoa que abriu.
- Refinamento concluído: spec de produto escrita (1_SPEC.md) e prioridade proposta: manter `priority:low` (rótulo já carregado pela issue; é proposta para a pessoa aceitar, decisão final dela).
- Squad plataforma: a mudança vive no runtime do runner (consulta de issues com rótulo e sem assignee, e caminho manual de iniciar run) e na tela de runs; decisão final de quem tem autonomia.

## Restrições

- A varredura automática (`scanIssues`) usa `triggered(label)`, que hoje só consulta `listMyIssues` (issues da própria pessoa) e filtra pelo rótulo de gatilho; issues com rótulo e sem assignee nunca entram. A varredura não pode começar a iniciar essas issues sozinha — o aceite pede que nada inicie sozinho a partir da nova lista.
- Aceite: a tela de runs lista issues abertas com o rótulo de gatilho e sem assignee, com um jeito de iniciar run manualmente (o caminho de início manual já existe: `runs:start(ref)` e `Runner.start(ref)`); nada inicia por si mesmo a partir dessa lista.
- A issue de origem da divisão (texto da issue) passou a cobrir só documentação e a dica do campo de gatilho — escopo desta issue é não sobrepor.
- Regras do projeto: textos de interface via `t()` nos dois catálogos; sem número real de issue em arquivos do repo público (usar `#123` neutro); inglês em código e commits.

## Tentado e descartado

- Nada tentado de implementação (etapas são de leitura). Confirmado por leitura: `triggered()` usa `listMyIssues`; `VcsIssue` traz `assignees`; `listIssues` (escopo `labels`) lista abertas do projeto independente de assignee — a consulta nova pedida é viável; `runs:start(ref)`/`Runner.start(ref)` existe como caminho de início manual.

## Perguntas abertas

- Nenhuma para quem abriu. Decisões de apresentação (posição da lista na tela, texto do controle de iniciar, estado de issue já iniciada) ficam com quem implementa dentro do comportamento da spec. Prioridade é proposta para a pessoa aceitar.

## Onde o trabalho está

- Etapas de triagem e refinamento concluídas; spec em docs/cycles/[redacted]/1_SPEC.md. Próximas etapas: plano técnico, desenvolvimento, revisão, QA. Trabalho futuro em `src/main/runner` (consulta de issues por rótulo sem assignee e exposição à tela) e `src/renderer/src/screens/cycle/RunsScreen.tsx` (lista e controle de iniciar).
- Passagem product-owner → tech-lead: ler 1_SPEC.md e seguir com o plano técnico. A mudança cruza o runtime do runner (consulta `listIssues` escopo `labels` filtrando assignees vazio) e a tela de runs (lista + início manual via `runs:start`); regras de i18n (`t()` nos dois catálogos) e do audit público (sem número real de issue em arquivos do repo) se aplicam.
- Passagem support → product-owner: Próxima etapa deve ler 0_TRIAGE.md e seguir com a spec de produto (refinamento) e depois o desenvolvimento. Considerar que a mudança cruza o runtime do runner (consulta de issues com rótulo e sem assignee, e um caminho manual de iniciar run) e a tela de runs; as regras de i18n (`t()` nos dois catálogos) e do audit público (sem número real de issue em arquivos do repo) se aplicam. <!-- handoff:18 -->
