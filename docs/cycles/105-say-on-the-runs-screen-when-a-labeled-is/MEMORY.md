# Memória do ciclo

## Decisões

- Triagem concluída: issue é pedido de funcionalidade claro, com critérios de aceite e origem da divisão citada (#54 agora cobre só documentação e dica do gatilho). Sem pergunta à pessoa que abriu.
- Refinamento concluído: spec de produto escrita (1_SPEC.md) e prioridade proposta: manter `priority:low` (proposta para a pessoa aceitar).
- Plano técnico concluído (2_PLAN.md): consulta nova `unassigned(label)` na interface `IssueSource`, implementada em `module.ts` via `provider.listIssues({project, scope:'labels'})` filtrando `state==='open'` e `assignees` vazio; canal novo de leitura `runs:unassigned`; `RunsScreen.tsx` ganha seção com botão por item chamando `runsApi.start(ref)`; varredura (`triggered`) intacta.
- Implementação concluída (3_IMPLEMENTATION.md): `unassigned` na interface e no módulo; canal `runs:unassigned` servindo lista enxuta (RunIssue: iid, ref, title, url); seção na tela de runs com botão iniciar desabilitado para ref já presente nas execuções; keys novas `ui.runs.unassigned.*` nos dois catálogos. Formato enxuto reusa `RunIssue` (sem tipo novo). Erro de refusal aparece via `errorText` (sem key própria); seção some quando lista vazia (sem mensagem de vazio).

## Restrições

- A varredura automática (`scanIssues`) usa `triggered(label)` via `listMyIssues`; issues com rótulo e sem assignee nunca entram. A varredura não pode começar a iniciar essas issues sozinha — o aceite pede que nada inicie sozinho a partir da nova lista.
- Aceite: a tela de runs lista issues abertas com o rótulo de gatilho e sem assignee, com um jeito de iniciar run manualmente; nada inicia por si mesmo a partir dessa lista.
- A issue de origem da divisão cobre só documentação e a dica do campo de gatilho — escopo desta issue é não sobrepor (por isso sem linha de CHANGELOG imposta pelo plano; ver Onde o trabalho está).
- Regras do projeto: textos de interface via `t()` nos dois catálogos; sem número real de issue em arquivos do repo público (usar `#123` neutro); inglês em código e commits.

## Tentado e descartado

- No fake de issues (`test/helpers/runner.ts`), `triggered` passou a filtrar por dono da issue (author/assignee = 'ana'), espelhando `listMyIssues` do host real, para que o teste "a varredura não inicia sem-assignee" fosse expressivo: uma issue com rótulo e sem assignee de outro autor está na lista nova mas fora da varredura. Isso preservou os testes existentes de scan (issues do default author 'ana').
- Decidido: descartar keys `.empty` e `.error` do i18n — a seção some quando vazia e o refusal usa `errorText(e)` (já traduz por `main.runner.error.*`), então elas ficariam sem uso e quebrariam o teste `ui-i18n` de "nenhuma key sem uso".

## Perguntas abertas

- Nenhuma para quem abriu. Prioridade (`priority:low`) é proposta para a pessoa aceitar.

## Onde o trabalho está

- Triagem, refinamento, plano e implementação concluídos. Implementação em `3_IMPLEMENTATION.md`; código nos arquivos: `src/main/runner/service.ts` (método `unassigned` na interface), `src/main/runner/module.ts` (implementação + canal `runs:unassigned`), `src/renderer/src/screens/cycle/runsApi.ts` (+`unassigned`), `src/renderer/src/screens/cycle/RunsScreen.tsx` (seção `UnassignedList`), `src/shared/i18n/ui-cycle.{en,pt-BR}.json` (keys `ui.runs.unassigned.*`), `test/helpers/runner.ts` (fake com `unassigned` e `triggered` fiel a dono), `test/runs-policy.test.ts` (canal em READS + `listIssues` nas chamadas de module.ts), novo `test/runner-unassigned.test.ts`.
- Gates rodados e verdes: `npx tsc --noEmit`; `npx vitest run` (4154 testes passam; 1 falha ambiental em `test/sandbox-gui.test.ts`, que usa sandbox real e não toca arquivos desta mudança — reportada como não relacionada); `npm run i18n:lint`; `node scripts/theme-audit.mjs`; `node scripts/public-audit.mjs`. `electron-vite build` e o fluxo visual da seção não foram rodados (não verificado).
- Aberto para QA/revisão: linha de CHANGELOG sob `## [Unreleased]` ainda não adicionada (o plano não a cita e a redação é de produto); verificar o fluxo visual da seção (lista, botão desabilitado, refusal) num app rodando — não exercitado nesta etapa.
- Próxima etapa (revisão): ler 1_SPEC.md, 2_PLAN.md e 3_IMPLEMENTATION.md; conferir gates e o comportamento da seção.
- Passagem support → product-owner: Próxima etapa deve ler 0_TRIAGE.md e seguir com a spec de produto (refinamento) e depois o desenvolvimento. Considerar que a mudança cruza o runtime do runner (consulta de issues com rótulo e sem assignee, e um caminho manual de iniciar run) e a tela de runs; as regras de i18n (`t()` nos dois catálogos) e do audit público (sem número real de issue em arquivos do repo) se aplicam. <!-- handoff:18 -->
- Passagem product-owner → pessoa: Ler 1_SPEC.md e seguir com o plano técnico (tech-lead). A mudança cruza o runtime do runner e a tela de runs: a consulta nova usa listIssues com escopo labels filtrando assignees vazio (o provedor já expõe isso, sem mudança de host), e o início manual pode reusar o caminho existente de iniciar run por referência (runs:start / Runner.start). Regras de i18n (t() nos dois catálogos) e do audit público (sem número real de issue em arquivos do repo, usar #123 neutro) se aplicam. Verificado por leitura nesta etapa; nada foi executado. <!-- handoff:26 -->
- Passagem tl-plataforma → pessoa: Ler 1_SPEC.md e 2_PLAN.md na pasta do ciclo e seguir com o desenvolvimento: adicionar o método unassigned(label) à interface IssueSource em src/main/runner/service.ts, implementá-lo em src/main/runner/module.ts com provider.listIssues({ project, scope: 'labels', labels }) filtrando state === 'open' e assignees vazio, servir um canal novo de leitura da família runs:* (ex.: runs:unassigned) devolvendo a lista enxuta, e na tela (RunsScreen.tsx + runsApi.ts) adicionar uma seção que lista essas issues com um botão por item chamando runsApi.start(ref); desabilitar o botão para ref já presente nas ex… <!-- handoff:38 -->
