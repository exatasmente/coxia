# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade claro, com aceite e origem da divisão citada (a issue de origem cobre só documentação e a dica do gatilho). Sem pergunta à pessoa que abriu.
- Refinamento: spec de produto (1_SPEC.md); prioridade proposta `priority:low` (proposta para a pessoa aceitar).
- Plano técnico (2_PLAN.md): consulta nova `unassigned(label)` na interface `IssueSource`, implementada em `module.ts` via `provider.listIssues({project, scope:'labels'})` filtrando `state==='open'` e `assignees` vazio; canal de leitura novo `runs:unassigned`; `RunsScreen.tsx` ganha seção com botão por item chamando `runsApi.start(ref)`; varredura (`triggered`) intacta.
- Implementação (3_IMPLEMENTATION.md): `unassigned` na interface e no módulo; canal `runs:unassigned` servindo lista enxuta (RunIssue: iid, ref, title, url); seção na tela de runs com botão iniciar desabilitado para ref já presente nas execuções; keys novas `ui.runs.unassigned.*` nos dois catálogos. Formato reaproveita `RunIssue` (sem tipo novo). Refusal aparece via `errorText`; seção some quando a lista está vazia.
- Revisão (4_REVIEW.md): mudança aprovada em comportamento e fronteira de segurança, com uma exigência para concluir: falta a linha de CHANGELOG sob `## [Unreleased]` para a mudança visível ao usuário (regra de CONTRIBUTING e da verificação de mudança). Veredito "changes".

## Restrições

- A varredura automática usa `triggered(label)` via `listMyIssues`; issues com rótulo e sem assignee nunca entram. O aceite pede que nada inicie sozinho a partir da nova lista; a varredura não muda.
- Aceite: a tela de runs lista issues abertas com o rótulo e sem assignee, com um jeito de iniciar run manualmente; nada inicia por si mesmo.
- A issue de origem da divisão cobre só documentação e a dica do campo de gatilho — não sobrepor.
- Regras do projeto: textos via `t()` nos dois catálogos; sem número real de issue em arquivos do repo público (usar `#123`); inglês em código e commits; mudança visível ao usuário exige linha de CHANGELOG sob `## [Unreleased]`.

## Tentado e descartado

- No fake de issues (`test/helpers/runner.ts`), `triggered` passou a filtrar por dono da issue (author/assignee = 'ana'), espelhando `listMyIssues` do host real, para que o teste "a varredura não inicia sem-assignee" fosse expressivo. Preservou os testes existentes de scan.
- Decidido descartar keys `.empty` e `.error` do i18n: a seção some quando vazia e o refusal usa `errorText(e)` (traduz por `main.runner.error.*`), então ficariam sem uso e quebrariam o teste de "nenhuma key sem uso".

## Perguntas abertas

- Nenhuma para quem abriu. Prioridade (`priority:low`) é proposta para a pessoa aceitar.

## Onde o trabalho está

- Triagem, refinamento, plano, implementação e revisão concluídos. Revisão em `4_REVIEW.md`. Código em: `src/main/runner/service.ts` (método `unassigned` na interface), `src/main/runner/module.ts` (implementação + canal `runs:unassigned`), `src/renderer/src/screens/cycle/runsApi.ts` (+`unassigned`), `src/renderer/src/screens/cycle/RunsScreen.tsx` (seção `UnassignedList`), `src/shared/i18n/ui-cycle.{en,pt-BR}.json` (keys `ui.runs.unassigned.*`), `test/helpers/runner.ts` (fake com `unassigned` e `triggered` fiel a dono), `test/runs-policy.test.ts` (canal em READS + `listIssues` nas chamadas de module.ts), novo `test/runner-unassigned.test.ts`.
- Revisão rodou e confirmou verdes: `npx tsc --noEmit`; `npm run i18n:lint`; `node scripts/theme-audit.mjs`; `node scripts/public-audit.mjs`; `npx electron-vite build`. `npx vitest run`: 4153 passam, 2 falham em `test/sandbox-gui.test.ts` (ambiental, caminho de Playwright/sandbox real, não toca arquivos desta mudança — confirmado rodando o arquivo isolado).
- Bloqueante em aberto nesta revisão: adicionar a linha de CHANGELOG sob `## [Unreleased]` antes de "done" (a mudança é visível ao usuário). Fluxo visual da seção (lista, botão desabilitado, refusal) num app rodando continua não verificado (nesta etapa só leitura + gates).
- Próxima etapa (após a correção do CHANGELOG): QA — verificar o fluxo visual da seção num app rodando (lista, botão desabilitado, refusal).
- Passagem support → product-owner: Próxima etapa deve ler 0_TRIAGE.md e seguir com a spec de produto (refinamento) e depois o desenvolvimento. Considerar que a mudança cruza o runtime do runner (consulta de issues com rótulo e sem assignee, e um caminho manual de iniciar run) e a tela de runs; as regras de i18n (`t()` nos dois catálogos) e do audit público (sem número real de issue em arquivos do repo) se aplicam. <!-- handoff:18 -->
- Passagem product-owner → pessoa: Ler 1_SPEC.md e seguir com o plano técnico (tech-lead). A mudança cruza o runtime do runner e a tela de runs: a consulta nova usa listIssues com escopo labels filtrando assignees vazio (o provedor já expõe isso, sem mudança de host), e o início manual pode reusar o caminho existente de iniciar run por referência (runs:start / Runner.start). Regras de i18n (t() nos dois catálogos) e do audit público (sem número real de issue em arquivos do repo, usar #123 neutro) se aplicam. Verificado por leitura nesta etapa; nada foi executado. <!-- handoff:26 -->
- Passagem tl-plataforma → pessoa: Ler 1_SPEC.md e 2_PLAN.md na pasta do ciclo e seguir com o desenvolvimento: adicionar o método unassigned(label) à interface IssueSource em src/main/runner/service.ts, implementá-lo em src/main/runner/module.ts com provider.listIssues({ project, scope: 'labels', labels }) filtrando state === 'open' e assignees vazio, servir um canal novo de leitura da família runs:* (ex.: runs:unassigned) devolvendo a lista enxuta, e na tela (RunsScreen.tsx + runsApi.ts) adicionar uma seção que lista essas issues com um botão por item chamando runsApi.start(ref); desabilitar o botão para ref já presente nas ex… <!-- handoff:38 -->
- Passagem developer → revisor-plataforma: Próxima etapa é a revisão: ler 1_SPEC.md, 2_PLAN.md e 3_IMPLEMENTATION.md, conferir os gates e o comportamento da seção. Pontos em aberto para a revisão/QA: (1) ainda não há linha de CHANGELOG sob `## [Unreleased]` para esta mudança visível ao usuário — o plano não a citava e a redação é de produto; decidir se entra nesta mudança; (2) o fluxo visual da seção (lista, botão desabilitado, refusal) não foi exercitado num app rodando — verificar num Electron; (3) a falha ambiental de test/sandbox-gui.test.ts nesta máquina não toca arquivos desta mudança. <!-- handoff:68 -->
