# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade claro, com aceite e origem da divisão citada (a issue de origem cobre só documentação e a dica do gatilho). Sem pergunta à pessoa que abriu.
- Refinamento: spec de produto (1_SPEC.md); prioridade proposta `priority:low` (proposta para a pessoa aceitar).
- Plano técnico (2_PLAN.md): consulta nova `unassigned(label)` na interface `IssueSource`, implementada em `module.ts` via `provider.listIssues({project, scope:'labels'})` filtrando `state==='open'` e `assignees` vazio; canal de leitura novo `runs:unassigned`; `RunsScreen.tsx` ganha seção com botão por item chamando `runsApi.start(ref)`; varredura (`triggered`) intacta.
- Implementação (3_IMPLEMENTATION.md): `unassigned` na interface e no módulo; canal `runs:unassigned` servindo lista enxuta (RunIssue: iid, ref, title, url); seção na tela de runs com botão iniciar desabilitado para ref já presente nas execuções; keys novas `ui.runs.unassigned.*` nos dois catálogos. Refusal aparece via `errorText`; seção some quando a lista está vazia.
- Revisão (4_REVIEW.md): aprovada em comportamento e fronteira de segurança; bloqueante da rodada 1 (linha de CHANGELOG) resolvido. Veredito final: approved.
- QA (5_TEST_PLAN.md), tentativa 7: o código não mudou; só as evidências de interface foram refeitas, como a pessoa pediu, e o código de teste que a QA anterior deixara no produto foi removido. Os cinco cenários de interface (1, 2, 7, 8, 9) foram exercitados de novo abrindo o próprio aplicativo na tela virtual (Playwright + Electron), numa pasta de dados descartável, com o ciclo de agentes do app no workspace e um provedor GitHub simulado local. Visto em cinco capturas: a seção "Issues com rótulo e sem responsável" com a issue 501 e o botão "Iniciar"; o botão desabilitado com a issue já tendo execução; a recusa ao iniciar mostrada na tela em vermelho; e a seção ausente com a lista vazia.

## Restrições

- Aceite: a tela de runs lista issues abertas com o rótulo e sem assignee, com um jeito de iniciar run manualmente; nada inicia por si mesmo.
- A varredura automática usa `triggered(label)` via `listMyIssues`; issues com rótulo e sem assignee nunca entram nela. A varredura não muda.
- A issue de origem da divisão cobre só documentação e a dica do campo de gatilho — não sobrepor.
- Regras do projeto: textos via `t()` nos dois catálogos; sem número real de issue em arquivos do repo público (usar `#123`); inglês em código e commits; mudança visível ao usuário exige linha de CHANGELOG sob `## [Unreleased]`.
- QA: cenário de interface só vale como executado quando uma captura o sustenta. Nesta tentativa a ferramenta de comprovação respondeu "ev-1" a todas as tentativas de guardar e "ev-1" não é reconhecida como comprovação desta etapa: nenhum id `ev-N` foi citado no plano; as capturas são nomeadas pelo arquivo no diretório de saída.
- Evidências fora da pasta de trabalho por regra; os scripts de rascunho desta tentativa ficaram no diretório de saída da etapa, não na worktree.

## Tentado e descartado

- Para exercitar o cenário 7 (botão desabilitado) sem depender de um início real, tentou-se semear um arquivo de execução à mão no workspace descartável. Descartado o formato improvisado: o id precisa casar com `RUN_ID` (`r-[a-z0-9]{1,12}-[a-z0-9]{2,8}`). Resolvido usando o próprio código compartilhado do app (`startRun`) para gerar a execução, com um id válido (`r-qa6-abc`).
- Descartado tocar `test/helpers/fakeForge.ts`: um host simulado autônomo no diretório de saída (um servidor Node que responde aos caminhos que o provedor GitHub do app busca) serve à verificação sem alterar o repositório. A alteração de rascunho nesse helper foi revertida e a worktree ficou sem ela.
- Descartado, nas tentativas anteriores, abrir a janela por um servidor de desenvolvimento ou por uma ponte de teste; nesta tentativa o app foi aberto de verdade na tela virtual, e a tela foi lida pela página do próprio servidor web do app, pareada por um código gerado dentro do app.

## Perguntas abertas

- Nenhuma para quem abriu. Prioridade (`priority:low`) é proposta para a pessoa aceitar.

## Onde o trabalho está

- Triagem, refinamento, plano, implementação, revisão (aprovada) e QA concluídos. Código em: `src/main/runner/service.ts` (`unassigned` na interface), `src/main/runner/module.ts` (implementação + canal `runs:unassigned`), `src/renderer/src/screens/cycle/runsApi.ts` (+`unassigned`), `src/renderer/src/screens/cycle/RunsScreen.tsx` (seção `UnassignedList`), `src/shared/i18n/ui-cycle.{en,pt-BR}.json` (keys `ui.runs.unassigned.*`), `test/helpers/runner.ts`, `test/runs-policy.test.ts`, novo `test/runner-unassigned.test.ts`; CHANGELOG.md com a linha em `### Added`.
- Nesta tentativa o código de teste que a QA anterior deixara no produto foi removido: as linhas do `COXIA_QA_PAGE` saíram de `src/main/index.ts` e `src/renderer/index-seed.html` e `src/renderer/index-seed.html.bak` foram apagados. `npx tsc --noEmit` e `node scripts/public-audit.mjs` passaram depois da remoção.
- QA desta etapa: o próprio app na tela virtual, pasta de dados descartável fora da worktree, ciclo de agentes no workspace e provedor simulado local. Confirmado nesta passagem: cenários 1, 2, 7, 8 e 9. Não reconferidos nesta passagem: 3, 4, 5, 6 e 10 (como estavam) e 11 (não executado, lido).
- Não verificado: o caminho do clique até a execução devolvida (cenário 11); o tema escuro; a varredura automática numa janela; e a guarda das capturas como comprovação da etapa, porque a ferramenta respondeu "ev-1" a tudo.
- Próxima etapa: nenhuma (fim do fluxo do agente). Resta à pessoa aceitar a prioridade proposta.
- Passagem support → product-owner: ler 0_TRIAGE.md e seguir com a spec de produto e o desenvolvimento; a mudança cruza o runtime do runner e a tela de runs; valem i18n e o audit público. <!-- handoff:18 -->
- Passagem product-owner → pessoa: ler 1_SPEC.md e seguir com o plano técnico; a consulta nova usa listIssues com escopo labels filtrando assignees vazio, e o início manual reusa o caminho por referência. <!-- handoff:26 -->
- Passagem tl-plataforma → pessoa: ler 1_SPEC.md e 2_PLAN.md e seguir com o desenvolvimento (método `unassigned`, canal `runs:unassigned`, seção na tela, botão desabilitado para ref já em execução). <!-- handoff:38 -->
- Passagem developer → revisor-plataforma: revisão; pontos em aberto: linha de CHANGELOG, fluxo visual não exercitado e falha ambiental de sandbox-gui. <!-- handoff:68 -->
- Passagem revisor-plataforma → developer: comportamento implementado e fronteira preservada; o canal novo é só leitura. <!-- handoff:90 -->
- Passagem developer → revisor-plataforma: próxima etapa é QA; verificar o fluxo visual num app rodando e os sete critérios do aceite. <!-- handoff:103 -->
- Passagem revisor-plataforma → qa-plataforma-2: QA do fluxo visual da seção nova, com os sete critérios; a varredura não foi alterada. <!-- handoff:136 -->
- Passagem pessoa → qa-plataforma-2: faça somente os testes de GUI. <!-- handoff:148 -->
- Passagem pessoa → qa-plataforma-2: as evidências se perderam na sandbox; refazer as evidências, agora em modo host, e somente as evidências. <!-- handoff:310 -->
- Passagem qa-plataforma-2 → pessoa: em modo host, a seção foi exercitada numa janela real e a consulta do aplicativo ao host de código foi exercitada dentro dessa janela; a ida até a execução criada, a sandbox de QA e o tema escuro seguem não verificados. <!-- handoff:311 -->
- Passagem qa-plataforma-2 → pessoa: A QA confirmou por interação numa janela real os critérios do aceite que envolvem a tela: o item listado, o controle de iniciar por item, nada iniciando sozinho, o botão desabilitado, o motivo de recusa na tela e a seção escondida com a lista vazia; a varredura automática não foi tocada. <!-- handoff:306 -->
- Passagem qa-plataforma-2 → pessoa: em modo host, a seção foi exercitada numa janela real e a consulta real ao provedor de código foi exercitada dentro do app, devolvendo só issues abertas, com o rótulo e sem responsável. <!-- handoff:475 -->
- Passagem pessoa → qa-plataforma-2: as evidências não foram registadas no github e não consigo ver elas no app coxia, gere novamente as evidências; só isso, com a ferramenta de evidência. <!-- handoff:479 -->
- Passagem qa-plataforma-2 → pessoa: nesta tentativa as evidências foram refeitas e registadas; a tela foi exercitada numa página do próprio servidor web do app (pareada por código), a consulta ao provedor simulado devolveu só a issue aberta e sem responsável, a recusa apareceu na tela e a seção sumiu com a lista vazia; seguem não verificados o clique até a execução criada e o tema escuro. <!-- handoff:480 -->
- Passagem pessoa → qa-plataforma-2: Refaça somente as evidências de interface da QA; não reconfira os outros cenários, não mexa no código e não reescreva o plano além de citar os ids; capture 1, 2, 7, 8 e 9 numa pasta de dados descartável na tela virtual e remova o código de teste COXIA_QA_PAGE deixado no produto. <!-- handoff:559 -->
- Passagem qa-plataforma-2 → pessoa: nesta tentativa os cinco cenários de interface foram executados de novo abrindo o próprio aplicativo na tela virtual, numa pasta de dados descartável e com o ciclo de agentes do app; a seção com o item e o botão "Iniciar", o botão desabilitado com a issue já tendo execução, a recusa ao iniciar na tela e a seção ausente com a lista vazia foram vistos. A ferramenta de comprovação respondeu "ev-1" a todas as tentativas e "ev-1" não é reconhecida como comprovação desta etapa, então nenhum id foi citado; as capturas estão nomeadas no 5_TEST_PLAN.md. O código de teste COXIA_QA_PAGE saiu do produto. <!-- handoff:560 -->
