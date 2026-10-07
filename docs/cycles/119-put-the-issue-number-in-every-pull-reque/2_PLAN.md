# O desenho da mudança: o número da issue no título da pull request e em toda mensagem de commit

## Como o trabalho se divide

O comportamento a entregar está fixado na especificação (`1_SPEC.md`): um molde próprio para o título, os dois moldes obrigados a ter o número, o número em todo commit de uma execução de issue, a migração e os dois idiomas da tela. O desenho abaixo decide **onde** cada um desses pedaços mora e **em que ordem** o trabalho anda; nada aqui reabre o que a especificação fixou.

Uma decisão de fundo atravessa tudo: hoje o número não chega ao commit do conflito porque nenhum caminho o leva até lá. Em vez de criar um caminho novo (o que significaria mexer na porta das Ações e no formato do registro da ação), o desenho **lê o número do registro da execução que já existe** — o `mr_iid` e o `source_branch` que a ação de conflito guarda. Foi essa a leitura do código desta etapa; nenhum comportamento foi executado.

## O que muda, por área

- **Configuração móvel.** Nasce `runner.prTitle` (`{title} #{iid}`), o molde do título, ao lado do molde da mensagem. Quem guarda a configuração ganha um passo de migração que anexa ` #{iid}` a um `commitMessage` sem o número e cria o `prTitle` com o padrão; a validação recusa qualquer um dos dois sem o número.
- **Execução.** O título que a execução mostra e manda para a ação é montado pelo molde, no rascunho e na proposta; o número sai quando a execução não tem issue.
- **Conflitos.** O commit que resolve um conflito de uma branch de execução passa a levar o número, lido do registro da execução; os merges de uma release continuam como estão.
- **Configurações › Runner.** Dois campos lado a lado, nos dois idiomas, com as mensagens de recusa; os dois são graváveis pela tela Time, inclusive num navegador pareado.

## Ordem do trabalho (um commit por passo)

1. **Configuração, tipo e padrão.** `prTitle` no tipo, no padrão neutro e no esquema JSON, com `minLength: 1` e `maxLength: 200` como o molde da mensagem; o esquema vira 13.
2. **Validação.** As duas regras novas em `runnerRules` (`{iid}` obrigatório nos dois moldes, `{summary}` e `{title}` continuam obrigatórios) e a migração v12→v13 com o passo novo em `STEPS`.
3. **Substituição e título.** A função pura que substitui o molde do título (corte do `{title}` antes de o número entrar, número que já está no título não entra de novo, execução sem issue larga o `#` e o número) e as duas chamadas que montam o título.
4. **Commits do conflito.** A mensagem do commit do conflito passa a ser a mensagem dos commits do app com `Merge <branch>` como resumo; o número e o molde vêm do registro da execução e do config, lidos onde a identidade do commit já é lida.
5. **Configurações › Runner.** O campo novo no rascunho, no `runnerOf`, no `runnerOfWeb` (o caminho da tela Time pelo navegador), nos problemas do formulário e nos dois catálogos de i18n.
6. **Tela Time pelo navegador.** `runner.prTitle` na lista de caminhos aceitos, e a documentação da configuração nos dois idiomas citando o campo e o passo novo.
7. **Documentação e nota de lançamento.** `docs/runner.md` (a mensagem dos commits), `docs/configuration.md` (a lista de campos e o histórico do esquema) e o `CHANGELOG.md`.

Cada passo entra com o seu teste, no mesmo commit.

## Onde cada decisão fica no código

Tudo abaixo foi conferido por leitura nesta etapa.

**O molde e o título montado.** A substituição do molde do título mora em `src/main/runner/git.ts`, ao lado de `commitMessage` (`:144`), que já é puro e já é testado por `test/runner-units.test.ts:230`. A leitura do número no título reusa a mesma forma de `ISSUE_REF` (`git.ts`, usada por `commitSummary`, `:130`). O título é montado nos dois pontos que a especificação nomeia, em `src/main/runner/publish.ts`: no rascunho (`:673`) e na proposta que vira a criação no host (`:691`, usada em `:696-697`). `publish.ts` não importa `./git` hoje; o import novo é de uma função pura e não cria nenhum caminho de escrita. O corte de 120 sai do título do agente (`{title}`) e passa a valer sobre o texto final.

**O registro do rascunho.** `recordCommentDraft` (`src/shared/runs/transitions.ts:929`) grava `body`, `headline` e `title` (`CommentDetails`, `src/shared/runs/types.ts:125-129`), e a tela da execução mostra `run.comments.pr?.title` (`src/renderer/src/screens/cycle/RunScreen.tsx:153`). Como o rascunho e a proposta montam o título pela mesma função, o registro e a tela ficam com o título que vai ao host, sem mudar estrutura de dado.

**O commit do conflito.** `commitMerge` (`src/main/conflictGit.ts:337-340`) commita com `mergeMessage(branch)` (`:331-333`), chamado por `conflictCommit` (`src/main/actions.ts:848-853`). A ação tem `a.issue` (o número da **issue**; o `issue: 15526` do conflito é a issue do cartão, conferido no teste `test/conflict-resolve.test.ts:268`) e o `unit` com `source_branch`, `mr_iid`, `target_branch` e `project_path` (`src/main/actions.ts:671-689`). O desenho: `mergeMessage` passa a montar a mensagem dos commits do app com `Merge <branch>` como `{summary}` e o número da execução, e `commitMerge` recebe a mensagem já montada; `conflictCommit` monta essa mensagem com o número de `a.issue` e o molde de `getConfig().runner.commitMessage`, na mesma leitura de config que `mergeIdentity` já faz (`src/main/actions.ts:707-711`). `actions.ts` não importa `runner/git` hoje além de `commitIdentity` (`:43`); a importação nova é só de uma função pura. `mergeMessage` continua sendo a mensagem de base quando não há número (0), o que preserva o caso de um conflito sem issue e mantém o caminho do teste atual. O commit leva o molde do workspace **naquele momento**, como todo commit do app (a especificação não pede que o commit carregue a mudança para o registro da execução). A linha que a ação mostra (`src/main/actions.ts:870`) passa a citar a mensagem real; os merges de release (`src/main/releaseGit.ts:440`, `:471`, `:475`) ficam intocados.

**O `prTitle` que volta ao rascunho.** A proposta guarda o título escolhido no registro; `pullRequest` já prefere o registro ao título da issue (`src/main/runner/publish.ts:691`). O ponto que a etapa anterior levantou — a interação com a substituição de uma proposta anterior — não exige reparo: quando o registro `pr` já está **publicado**, o título vai como está; quando está proposto, a mudança só acontece ao propor de novo, e a chave `pr:${run.id}` (`:697`) mantém a proposta idêntica. Um `title` ausente num registro antigo cai no título da issue e passa pela mesma montagem: a leitura tolerante cobre o registro de uma execução anterior à mudança.

**A validação e a migração.** As regras moram em `runnerRules` (`src/shared/config/validate.ts:143-144`), aplicadas sobre o documento já preenchido pelo padrão (`:289`), o que faz um arquivo sem `prTitle` ganhar o padrão **antes** da checagem — o caso "campo ausente" não precisa de tratamento próprio. O passo novo entra ao fim de `STEPS` (`src/shared/config/migrations.ts:263`), no molde de `v11ToV12` (`:253-261`), e a cadeia `while (version < CONFIG_SCHEMA_VERSION)` (`:309-315`) o alcança sozinha. O novo `v12ToV13` cria o `runner` quando a chave existe e faz duas coisas: se o `commitMessage` guardado não tem `{iid}`, anexa ` #{iid}` (sem duplicar quando já tem); cria `prTitle` com o padrão quando falta. Nada mais do documento se move. A escolha do "se falta" como forma da migração é deliberada: um `prTitle` sem número — escrito à mão no arquivo, já que o campo é novo — é reparado pelo `repair` (`:277-289`, que reseta o **caminho do campo**, não o `runner` inteiro) ou pela validação, em vez de ser corrigido pela migração.

**O `prTitle` e a tela Time pelo navegador.** O caminho novo entra em `WEB_EDITABLE` (`src/main/configScope.ts:11-26`), ao lado de `runner.commitMessage` (`:24`), e a lista é espelhada na linha de `docs/configuration.md` que descreve o canal (`:118` e a gêmea em inglês). Sem isso, a diferença calculada contra o config guardado (`refusedPaths`, `:78-80`) faria a gravação pela tela Time no navegador ser recusada. O editor tem o campo no `RunnerDraft` e no `runnerOf` (`src/renderer/src/screens/team/runnerEdit.ts:26`, `:48`, `:67`), o problema próprio no `RunnerField` (`:81`, `:128-130` é o molde do molde a copiar) e o campo novo na `RunnerSection.tsx:133-135`. O `runnerOfWeb` (`runnerEdit.ts:77-79`) reconstrói o config a partir do rascunho e já preserva os caminhos que o navegador não muda; o `prTitle` é um campo que ele pode mudar, logo anda com o rascunho e precisa de decisão explícita (seguir o rascunho ou o guardado) — a especificação manda que salvar pela tela Time no navegador funcione, então ele **segue o rascunho**.

## Riscos e como são cobertos

- **O número de exemplo da issue reprova a auditoria pública.** A regra `real-issue-number` (regras codificadas em `scripts/public-audit.mjs`) caça o número que a issue usa nos exemplos de aceite; a lista de permissão casa por `text.includes(match)` na linha inteira, o que liberaria o resto da linha junto. Contenção: todo teste, documento, comentário e mensagem de commit desta mudança usa número neutro (`#321`, `#456`), como a especificação já escreveu.
- **A migração mexer mais do que deve.** O passo novo só toca em `runner.commitMessage` e `runner.prTitle`; um teste sobre um documento v11 (e um v1) compara o resto do config antes e depois. Um `commitMessage` que já tem o número fica como está — a checagem de `{iid}` antes de anexar evita o número duplicado.
- **Um documento "atual" que nunca passa pela migração.** Um arquivo com `schemaVersion` 13 **sem** `prTitle` não é migrado e chega à validação sem o campo: o padrão preenche antes da checagem, então a proposta continua salvando. Coberto por um teste que salva essa forma.
- **A mensagem do conflito divergir do resto do histórico.** O número e o molde só existem se a execução for encontrada; sem ela (número 0, execução já removida), a mensagem volta a `Merge <branch>`, como hoje. O teste do caminho existente (`test/conflict-resolve.test.ts:257`) fixa a mensagem com a execução presente e **precisa mudar**: com o molde padrão e uma issue, a mensagem esperada passa a ser `Merge release/bugfix/1234 #15526`, e o número 15526 é neutro nesta issue (o caso da issue é outro).
- **A tela Time pelo navegador recusar o campo novo.** O caminho entra em `WEB_EDITABLE` no mesmo commit do campo; o teste de escopo (`test/config-web-scope.test.ts:44-48`) ganha o caso do `prTitle` aceito e o caso de o `runner` inteiro continuar recusando o resto (`commands`, `worktreeDir`, `identity`, `release`).
- **O corte de 120 caracteres.** O corte passa a valer sobre `{title}`, antes da montagem; um título longo não pode perder o número. Coberto por teste com título maior que o limite.
- **O título que já tem o número.** A leitura procura o número da issue no texto antes de montar; o teste usa as duas formas (`#456` no fim, `#456` no começo) que a especificação cita.
- **Testes que fixam objetos inteiros.** `test/runner-config.test.ts:12` (objeto `runner` completo), `:41` (chaves do esquema) e `test/team-runner-edit.test.ts:12` (round trip do rascunho) quebram com o campo novo: atualizar, não contornar. `test/config-migrations.test.ts` fixa o `schemaVersion` 12 em cinco pontos (`:53`, `:112`, `:134`, `:208`, `:257`) e o passo novo o leva a 13; não há nenhum documento de schema 12 guardado como fixture para copiar (percorrido nesta etapa: os fixtures levam `4`), então esse teste é o lugar do caso do documento atual sem o campo.

## Como será testado

Testes de unidade e de configuração, sem modelo, sem host de código e sem rede:

- **A substituição do molde do título** (`test/runner-units.test.ts`, junto do bloco do commit): padrão, `#{iid} {title}`, título com o número no fim e no começo, execução sem issue (o `#` e o número saem, sem `#` solto), título longo cortado com o número preservado, e um molde sem `{title}` ou sem `{iid}` recusado.
- **A mensagem do commit do conflito** (`test/conflict-resolve.test.ts`): com a execução no registro, a mensagem segue o molde do workspace e leva o número da issue; sem o número, volta à mensagem atual.
- **A configuração** (`test/runner-config.test.ts`): o objeto neutro com o campo novo, a recusa de um molde sem `{iid}` (nos dois moldes) e a recusa de um molde de título sem `{title}`, guardando as mensagens atuais.
- **A migração** (`test/config-migrations.test.ts`): um documento com um `commitMessage` sem número ganha ` #{iid}`; um que já tem fica igual; `prTitle` nasce com o padrão; o resto do config sai idêntico; o documento resultante valida; um documento de schema 13 sem o campo continua válido ao salvar.
- **A tela Time pelo navegador** (`test/config-web-scope.test.ts`): o `prTitle` aceito, o resto do `runner` recusado como hoje.
- **O editor** (`test/team-runner-edit.test.ts`): o campo novo no rascunho e no config de volta, e a mensagem de recusa do molde sem número.

Depois dos testes, as portas do repositório: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs` (o campo novo usa os componentes existentes, sem cor literal), `npm run i18n:lint` (as chaves novas existem nos dois catálogos), `node scripts/public-audit.mjs` (nenhum número de issue real, nenhum nome, nenhum host) e o build do CI (`electron-vite build`).

## O que este plano não viu funcionando

Nenhum teste foi rodado, nenhum comportamento foi reproduzido, nenhuma migração foi executada e nenhuma porta foi rodada nesta etapa: tudo o que está acima vem de leitura do código e dos documentos. Em particular, não foram executados `node scripts/public-audit.mjs`, `npx vitest run`, `npx tsc --noEmit` nem o `i18n:lint`; a contagem de testes a mover e a lista de pontos que fixam o `schemaVersion` 12 vêm dessa leitura.

## Fora do escopo (mantido como está)

- Os commits que uma pessoa faz à mão na branch da execução.
- O título de uma pull request que já existe: o app não a renomeia.
- As mensagens dos merges de uma release (`src/main/releaseGit.ts`).
- O texto do título e do resumo em si.
- Qualquer caminho novo de escrita no host de código: nada nesta mudança sai da porta das Ações.
