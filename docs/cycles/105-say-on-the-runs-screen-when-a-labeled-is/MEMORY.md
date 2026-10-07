# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade claro, com aceite e origem da divisão citada (a issue de origem cobre só documentação e a dica do gatilho). Sem pergunta à pessoa que abriu.
- Refinamento: spec de produto (1_SPEC.md); prioridade proposta `priority:low` (proposta para a pessoa aceitar).
- Plano técnico (2_PLAN.md): consulta nova `unassigned(label)` na interface `IssueSource`, implementada em `module.ts` via `provider.listIssues({project, scope:'labels'})` filtrando `state==='open'` e `assignees` vazio; canal de leitura novo `runs:unassigned`; `RunsScreen.tsx` ganha seção com botão por item chamando `runsApi.start(ref)`; varredura (`triggered`) intacta.
- Implementação (3_IMPLEMENTATION.md): `unassigned` na interface e no módulo; canal `runs:unassigned` servindo lista enxuta (RunIssue: iid, ref, title, url); seção na tela de runs com botão iniciar desabilitado para ref já presente nas execuções; keys novas `ui.runs.unassigned.*` nos dois catálogos. Refusal aparece via `errorText`; seção some quando a lista está vazia.
- Revisão (4_REVIEW.md): aprovada em comportamento e fronteira de segurança; o bloqueante da rodada 1 (falta da linha de CHANGELOG sob `## [Unreleased]`) foi resolvido (`### Added`). Veredito final: approved.
- QA (5_TEST_PLAN.md), tentativa 6: o código não mudou; só as evidências foram refeitas, como a pessoa pediu. A tela foi exercitada numa página servida pelo próprio servidor web do aplicativo (caminho do navegador pareado), com pareamento por um código gerado dentro do app, pasta de dados descartável e um provedor GitHub simulado local. Visto: a seção com a issue app#501 e o botão Iniciar, nenhum início sozinho, a consulta real do app ao provedor (busca por rótulo do projeto) devolvendo só a issue aberta e sem responsável, a recusa mostrada na tela como alerta e a seção ausente quando a lista voltou vazia.

## Restrições

- A varredura automática usa `triggered(label)` via `listMyIssues`; issues com rótulo e sem assignee nunca entram. O aceite pede que nada inicie sozinho a partir da nova lista; a varredura não muda.
- Aceite: a tela de runs lista issues abertas com o rótulo e sem assignee, com um jeito de iniciar run manualmente; nada inicia por si mesmo.
- A issue de origem da divisão cobre só documentação e a dica do campo de gatilho — não sobrepor.
- Regras do projeto: textos via `t()` nos dois catálogos; sem número real de issue em arquivos do repo público (usar `#123`); inglês em código e commits; mudança visível ao usuário exige linha de CHANGELOG sob `## [Unreleased]`.
- QA: cenário de interface só vale como executado quando uma captura o sustenta; nesta execução nenhum comando da configuração foi rodado (a configuração não lista comandos).
- Evidências fora da pasta de trabalho por regra; restos de rascunho de tentativas anteriores (gui-e2e.mjs, gui-min/, .qa-gui/ e tmp-*.mjs) foram apagados da pasta de trabalho nesta tentativa.

## Tentado e descartado

- No fake de issues (`test/helpers/runner.ts`), `triggered` passou a filtrar por dono da issue (author/assignee = 'ana'), espelhando `listMyIssues` do host real, para que o teste "a varredura não inicia sem-assignee" fosse expressivo. Preservou os testes existentes de scan.
- Decidido descartar keys `.empty` e `.error` do i18n: a seção some quando vazia e o refusal usa `errorText(e)`, então ficariam sem uso.
- Descartado, nas tentativas anteriores, abrir a janela por um servidor de desenvolvimento ou por uma ponte de teste: nesta tentativa usou-se o servidor web do próprio aplicativo, pareado por código, para que cada leitura da tela fosse uma chamada HTTP real ao processo principal, com o provedor simulado respondendo no lugar do host. O que a integração do navegador faz sozinha — checar a sessão e mostrar "Sem conexão" — foi contornado com um pareamento explícito dentro do app, não com a troca das respostas.

## Perguntas abertas

- Nenhuma para quem abriu. Prioridade (`priority:low`) é proposta para a pessoa aceitar.

## Onde o trabalho está

- Triagem, refinamento, plano, implementação, revisão (aprovada) e QA concluídos. Código em: `src/main/runner/service.ts` (`unassigned` na interface), `src/main/runner/module.ts` (implementação + canal `runs:unassigned`), `src/renderer/src/screens/cycle/runsApi.ts` (+`unassigned`), `src/renderer/src/screens/cycle/RunsScreen.tsx` (seção `UnassignedList`), `src/shared/i18n/ui-cycle.{en,pt-BR}.json` (keys `ui.runs.unassigned.*`), `test/helpers/runner.ts`, `test/runs-policy.test.ts`, novo `test/runner-unassigned.test.ts`; CHANGELOG.md com a linha em `### Added`.
- QA desta etapa: página servida pelo servidor web do próprio aplicativo, pareada por código, com pasta de dados descartável fora da pasta de trabalho; capturas no diretório de saída da etapa. Confirmado: cenários 1, 2, 3, 4, 5, 8 e 9 do plano; por leitura: 6, 7, 10 e 11.
- Não verificado: o caminho do clique até a execução devolvida; o fluxo numa sandbox de QA com pasta de navegadores e tela virtual; o tema escuro; a varredura automática numa janela; a contagem de cenários executados derivada de comandos, que esta execução não tem.
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
- Passagem qa-plataforma-2 → pessoa: A QA confirmou por interação numa janela real os critérios do aceite que envolvem a tela: o item listado, o controle de iniciar por item, nada iniciando sozinho, o botão desabilitado para uma issue que já virou execução, o motivo de recusa na tela e a seção escondida quando a lista está vazia; a varredura automática não foi tocada. <!-- handoff:306 -->
- Passagem qa-plataforma-2 → pessoa: em modo host, a seção foi exercitada numa janela real e a consulta real ao provedor de código foi exercitada dentro do app, devolvendo só issues abertas, com o rótulo e sem responsável. <!-- handoff:475 -->
- Passagem pessoa → qa-plataforma-2: as evidências não foram registadas no github e não consigo ver elas no app coxia, gere novamente as evidências; só isso, com a ferramenta de evidência. <!-- handoff:479 -->
- Passagem qa-plataforma-2 → pessoa: nesta tentativa as evidências foram refeitas e registadas; a tela foi exercitada numa página do próprio servidor web do app (pareada por código), a consulta ao provedor simulado devolveu só a issue aberta e sem responsável, a recusa apareceu na tela e a seção sumiu com a lista vazia; seguem não verificados o clique até a execução criada e o tema escuro. <!-- handoff:480 -->
