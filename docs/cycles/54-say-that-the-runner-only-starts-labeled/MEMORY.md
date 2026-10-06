# Memória do ciclo

## Decisões

- Escopo aceito, e nada mais: documentação e dica de campo, sem comportamento novo. Os três lugares são `docs/configuration.md` (dois idiomas), a dica `ui.runner.triggerHint` nos dois catálogos e uma linha em `docs/vcs-providers.md` sobre o filtro por responsável nos três hosts. O aviso na tela de execuções para issue com rótulo e sem responsável ficou na issue 105.
- Squad: `experiencia` (é o que a pessoa lê: catálogos, telas e documentos). Fronteira de `plataforma`: só se o filtro por responsável precisar mudar.
- Prioridade proposta pelo refino: `priority:medium`, como a issue já está rotulada — a mudança não altera comportamento, só corrige o texto. Marco: nenhum proposto. Ambas são propostas para a pessoa aceitar.
- A especificação fixa que os três textos contam a mesma história (issue aberta, com o rótulo e atribuída à pessoa) e que nenhum deles diz que o rótulo sozinho basta. Ganho é de entendimento, não de ação do app.

## Restrições

- Nada de comportamento novo e nenhuma tela, mensagem ou aviso novo: a dica do campo é texto de ajuda. O gatilho continua exigindo issue aberta, com o rótulo e atribuída à pessoa; dispensar a atribuição segue descartado.
- Todo texto de interface vai pelos catálogos (`t()`), nos dois idiomas; a rota é a dica do campo, não uma tela nova.
- A documentação deve ser mais estreita que o comportamento observado: o GitHub (`issues?filter=assigned` ou `assignee=<usuário>`), o GitLab (`scope=assigned_to_me`) e o Bitbucket (`assignee.uuid`) filtram por responsável nas leituras, mas o funil comum do runner (`src/main/runner/module.ts:35-40`) só acrescenta estado e rótulo, sem reaplicar a checagem de responsável (não verificado no funil). Não prometer filtro geral sem confirmar.
- Regra pública: sem nome de empresa, pessoa, host ou número real de issue fora do que o repositório já usa; placeholders neutros; a auditoria pública é gate.
- Nenhuma asserção sem verificação: o que só foi lido vai como lido; nada foi executado nesta etapa (nada de `npx vitest`, `tsc`, auditoria pública ou host real).

## Tentado e descartado

- Levar o aviso da tela de execuções junto: já estava fora do escopo no comentário de 2026-10-06 e vive na issue 105.
- Tratar a issue como bug: o comportamento do runner (iniciar só a issue atribuída) é o desenhado; com isso, a única falha é o texto do gatilho.
- Usar as outras issues abertas (53, 52, 29, 16, 58) como duplicatas: nenhuma trata do gatilho, da atribuição ou do filtro por responsável.

## Perguntas abertas

- Nenhuma: falta só o que as etapas seguintes fazem (escrever a documentação e a dica), não uma resposta de quem abriu a issue.

## Onde o trabalho está

- Triagem concluída (`0_TRIAGE.md`) e especificação funcional escrita (`1_SPEC.md`): o que muda para quem usa, o que passa a ser dito, regras, sete critérios de aceite e fora do escopo. Confirmado por leitura: `docs/configuration.md` omite a atribuição nos dois idiomas (linhas 73 e 221); `docs/runner.md` já diz o requisito (linhas 60 e 278); a dica `ui.runner.triggerHint` só fala da caixa (`ui-team.pt-BR.json:253`, `ui-team.en.json:253`) e `ui.runner.enabledHint` (191-192) também omite; os três hosts filtram por responsável. Nada foi implementado nem testado; a conferência dos gates fica para quem escrever.
- Próximo passo: escrever os três textos (configuração do runner e documento de provedores nos dois idiomas, mais a dica do campo nos dois catálogos), mantendo a consistência entre eles, e rodar os gates do repositório.
- Passagem support → product-owner: Escrever as mudanças de documentação e a dica do campo: em `docs/configuration.md` (pt-BR, linha 73, e inglês, linha 221), dizer que o app inicia sozinho só uma issue aberta, com o rótulo `triggerLabel` e atribuída à pessoa, e ligar ao parágrafo de `docs/runner.md` que já diz isso (linhas 60 e 278); trocar a dica `ui.runner.triggerHint` nos dois catálogos (`src/shared/i18n/ui-team.pt-BR.json:253` e `ui-team.en.json:253`) para incluir a atribuição, mantendo o aviso de que a caixa não importa; e acrescentar em `docs/vcs-providers.md` a linha sobre o filtro por responsável nos três hosts (GitHub … <!-- handoff:7 -->
