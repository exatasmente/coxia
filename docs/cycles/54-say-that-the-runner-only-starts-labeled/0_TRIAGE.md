# O gatilho só inicia issue atribuída à pessoa, e isso não está dito onde se lê

## Tipo

Pedido de funcionalidade (enhancement) reduzido a documentação e dica de campo. Não relata defeito no comportamento do runner, e sim que o comportamento atual — iniciar sozinho só uma issue aberta, com o rótulo e **atribuída à pessoa** — não está dito onde a pessoa procura: o bloco `runner` de `docs/configuration.md` (nos dois idiomas) e a dica do campo do rótulo na tela de Configurações › Runner. O aviso na tela de execuções quando uma issue tem o rótulo e ninguém atribuído saiu deste escopo e foi para a issue 105.

## Dá para entender como está escrita

Dá, e o que ela descreve do estado atual confere com o código. Tudo abaixo foi conferido **só por leitura** da issue, do código e dos documentos; nada foi executado e nenhum host foi consultado.

- O gatilho filtra por issue aberta, rótulo e responsável. A busca é `listMyIssues`, e o filtro por estado e rótulo vem depois: `triggered(label)` lê `provider.listMyIssues({ project, limit: 100 })` e guarda `state === 'open'` com alguma label igual ao `triggerLabel` (`src/main/runner/module.ts:35-40`).
- Os três hosts filtram por responsável na própria leitura:
  - GitHub, com o projeto de issues: `repos/<proj>/issues?assignee=<usuário atual>&state=open&sort=updated`; sem ele, `issues?filter=assigned&state=open&sort=updated` (`src/main/vcs/github.ts:285-292`; o endpoint `issues?filter=assigned` na rota "minhas" está coberto por `test/vcs-github.test.ts:52-58`, e a rota por projeto em `test/vcs-github.test.ts:60-65`, que espera `assignee=ana-dev`).
  - GitLab: `scope=assigned_to_me&state=opened` (`src/main/vcs/gitlab.ts:282-286`; `test/vcs-gitlab.test.ts:42-43` confere `scope=assigned_to_me`).
  - Bitbucket: consulta `assignee.uuid="<uuid do meu usuário>" AND (state="new" OR state="open" OR state="on hold")` (`src/main/vcs/bitbucket.ts:247-262`, com `ISSUE_OPEN` em `src/main/vcs/bitbucket.ts:32`; `test/vcs-bitbucket.test.ts:49-53` confere a consulta).
- `docs/runner.md` já diz o requisito: "lista as issues abertas atribuídas à pessoa que levam o rótulo `runner.triggerLabel`" (`docs/runner.md:60`; a versão em inglês, `docs/runner.md:278`).
- `docs/configuration.md` deixa a atribuição de fora nos dois idiomas: "faz o app iniciar execuções sozinho para as issues que levam o rótulo `triggerLabel`" (`docs/configuration.md:73`; a mesma frase em inglês, `docs/configuration.md:221`). Nenhuma linha do bloco `runner` cita atribuição.
- A dica do campo é só "Maiúsculas e minúsculas não importam." (`src/shared/i18n/ui-team.pt-BR.json:253`) e "Case does not matter." (`src/shared/i18n/ui-team.en.json:253`), ligada ao campo "Rótulo que pede uma execução" (`src/renderer/src/screens/team/RunnerSection.tsx:68`).
- O escopo de documentação é mais estreito do que o código de fato faz, e isso **não** foi reconferido aqui: a leitura dos três hosts filtra por responsável, mas o funil comum do runner só acrescenta estado e rótulo (`src/main/runner/module.ts:39-40`), sem reintroduzir a checagem de `assignees`. A única lista de "minhas issues" que não filtra por responsável é a dos cartões do dia, que por desenho pode ser alargada (`src/main/vcs/cards.ts:127-132`; `src/shared/cardScope.ts:41-49`); não se verificou se ela alimenta alguma origem de issues do runner. O texto de `vcs-providers.md` precisa descrever o filtro por responsável sem prometer mais do que o código garante.
- `docs/vcs-providers.md` não tem linha própria sobre o filtro por responsável: a linha "Lista 'minhas'" (`docs/vcs-providers.md:33`, e a equivalente em inglês na linha 177) cobre `issues?scope=assigned_to_me` no GitLab, `issues?filter=assigned` no GitHub e `pullrequests/{uuid}` no Bitbucket, sem o filtro das issues do Bitbucket. A linha "Issues do projeto" (`docs/vcs-providers.md:32`, inglês na linha 176) diz "sem filtro de responsável" para o Bitbucket.

Verificação: leitura da issue, do código, dos catálogos e dos documentos; nada foi executado, e o comportamento não foi visto funcionando no app nem contra um host real.

## O que falta

Nada que só quem abriu possa dizer. O pedido nomeia os arquivos, o texto desejado e o escopo revisado no comentário de 2026-10-06, quem revisou a issue. A única ressalva é de quem for trabalhar nela, e está acima: confirmar por leitura, no funil comum, se o filtro por responsável atravessa antes de prometê-lo como regra geral em `vcs-providers.md`.

## Issues relacionadas

- **Issue 105** (citada na própria issue, no escopo e no comentário): o aviso na tela de execuções para uma issue com o rótulo e ninguém atribuído, com um jeito de iniciar à mão, saiu deste escopo e ficou lá. Não é duplicata: aqui não se pede tela nova, só documentação e dica.
- Nenhuma das outras issues abertas lidas neste ciclo (53, 52, 29, 16, 58) trata do gatilho do runner ou da atribuição por responsável; não parecem duplicadas.

## Prioridade sugerida

`priority:medium` — a issue já leva esse rótulo e o pedido não muda comportamento, só corrige o que a documentação e a tela dizem; continua como sugestão, não como decisão da triagem.

## Squad proposto

`experiencia`. O escopo aceito é documentação e dica de campo: `docs/configuration.md` nos dois idiomas, a chave `ui.runner.triggerHint` nos dois catálogos (`src/shared/i18n/`, pasta do squad `experiencia`) e uma linha em `docs/vcs-providers.md`. O núcleo do comportamento — o runner e o filtro por responsável nos três provedores — vive em `src/main/runner` e `src/main/vcs`, do squad `plataforma`; por isso `plataforma` também reivindica a issue. A issue deixa o runner como está e mexe só no que a pessoa lê, então `experiencia` é o squad que a leva; se o filtro precisar mudar, aí sim é `plataforma`.
