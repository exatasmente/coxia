# Número da issue no título de toda pull request e em todo commit de uma execução

## Que tipo de issue é

Pedido de funcionalidade, com o rótulo `enhancement`. Não relata defeito (o comportamento de hoje é o que a issue descreve: não há erro a corrigir), não é pergunta e não repete outra issue. Pede dois comportamentos novos no runner: um molde próprio para o título da pull request e a garantia de que nem o título nem a mensagem dos commits deixem o número da issue de fora.

## Dá para entender como está escrita

Dá, e o retrato que a issue faz do estado atual confere ponto a ponto. Só foi lido o código: nada foi executado e nenhum comportamento foi visto funcionando.

Conferido na leitura:

- A validação do molde de commit não exige o número: só há a checagem de `{summary}` e a de uma linha (`src/shared/config/validate.ts:143-144`), aplicada sobre o documento já preenchido pelos padrões (`withConfigDefaults`, `src/shared/config/defaults.ts:104`). Um molde sem `{iid}` é aceito.
- O padrão do molde é o que a issue diz (`commitMessage: 'feat: {summary} #{iid}'`, `src/shared/config/defaults.ts:30`) e a substituição já larga o número e o `#` quando `iid` é 0 (`commitMessage`, `src/main/runner/git.ts:144`).
- O título da pull request é montado das duas vezes que a issue aponta, e nas duas a partir do título que o agente escreveu ou do título da issue, com corte em 120 caracteres: no rascunho (`src/main/runner/publish.ts:673`) e na proposta que vira `createMr` (`src/main/runner/publish.ts:691`, usada em `planWrite({ op: 'createMr', ... })` e em `door.propose` nas linhas 696-697). Nenhum dos dois passa o número.
- Os commits de uma execução de issue passam todos por `commitMessage`: a etapa (`src/main/runner/executor.ts:492`), o registro da issue (`src/main/runner/service.ts:627`), o registro da release, com `iid` 0 (`src/main/runner/service.ts:694`) e a memória do ciclo (`src/main/runner/service.ts:825`). Uma etapa que pausa numa pergunta não commita (`src/main/runner/executor.ts:473`).
- O commit da resolução de conflito da branch de uma execução é o único que não carrega o número: `commitMerge` commita com `mergeMessage(branch)` (`src/main/conflictGit.ts:337-340`), que devolve `Merge branch 'main' into '<branch>'` (`:331-333`). Quem chama é `conflictCommit` (`src/main/actions.ts:848-853`), sem o número e sem o config à mão; a identidade sai de `mergeIdentity` (`src/main/actions.ts:707`). A ação de conflito tem o número em `a.issue`/`u.issue_iid` (a criação a partir de um cartão exige número positivo, `src/main/actions.ts:655-657`; a varredura do host grava `u.issue_iid`, `src/main/actions.ts:314-321`).
- Os merges de uma release têm mensagem própria e a issue os deixa de fora: `Merge ${branch}` com `--no-edit -m` (`src/main/releaseGit.ts:475`) e `Merge pull request #${pr} from ${source}` (`:440`); o merge `--ff-only` de `:471` também não passa pelo molde.
- O esquema da configuração tem um passo por versão e o molde do commit é campo obrigatório do esquema (`src/shared/config/schema.ts:451`, `minLength: 1`), enquanto `prTitle` não existe em lugar nenhum; a migração corrente é a v11 → v12 e `CONFIG_SCHEMA_VERSION` é 12 (`src/shared/config/types.ts:5`, `src/shared/config/migrations.ts:263`).
- O editor recusa o molde sem `{summary}`, com chave própria em cada idioma (`src/renderer/src/screens/team/runnerEdit.ts:128-130`; `ui.runner.err.commitSummary` nos dois catálogos, `src/shared/i18n/ui-team.en.json:199` e `ui-team.pt-BR.json:199`), e a importação valida o mesmo documento (`migrateConfig` seguido de `validateConfig`, `src/shared/config/transfer.ts:72-84`).

Dois pontos que a issue não cita e que prendem o trabalho:

1. **A tela Time pelo navegador.** O canal `config:cycle-save` só aceita mudanças em caminhos listados e o molde do commit está na lista, mas o novo campo não estaria: `runner.{enabled, triggerLabel, maxConcurrentRuns, turns, stageIdleMs, stageMaxMs, commitMessage, linkDependencies}` (`docs/configuration.md:118`, aplicado em `src/main/configScope.ts`). Sem acrescentar `prTitle` a essa lista, salvar o novo campo pela tela Time no navegador é recusado.
2. **O número de exemplo da aceitação.** A auditoria pública caça números de issue e de merge request reais, por uma regra codificada no próprio script (`real-issue-number`, `scripts/public-audit.mjs:23-40`); o intervalo listado na regra inclui o número usado nos exemplos de aceitação da issue ("a run of issue #123"), então um teste ou documento que escreva `#123` reprova `node scripts/public-audit.mjs`. A lista de permissão casa por `text.includes(match)` sobre a linha inteira (`scripts/public-audit.mjs:105-106,117`), o que torna uma entrada de permissão para esse exemplo capaz de liberar qualquer outra ocorrência da mesma linha. A saída é escrever o exemplo com número neutro (por exemplo `#321` ou `#456`), como o resto do repositório já faz. Isso foi lido do script e das regras que ele carrega; o script não foi executado nesta etapa.

O que já existe hoje e vai precisar acompanhar a mudança, conferido por leitura:

- `test/runner-config.test.ts:12` fixa o objeto `runner` inteiro do padrão, campo a campo; um campo novo quebra esse teste.
- `test/runner-units.test.ts:230-231` fixa a substituição do molde de commit, o que continua valendo, mas mostra onde mora a cobertura de hoje.
- `docs/configuration.md:42` e `:190` (lista dos campos de `runner`), `:46` e `:194` (histórico do esquema, com o texto do passo novo) e `docs/runner.md:92` e `:310` (o commit do app e o molde) citam `commitMessage` e não conhecem o molde do título.
- O comentário da primeira linha de `src/shared/config/types.ts` diz "schema 11" enquanto a constante da linha 5 diz 12; é uma anotação defasada, não um defeito de comportamento.
- `CHANGELOG.md` não tem nada sobre títulos de pull request em `## [Unreleased]`; a mudança é visível para quem usa, então cabe lá.

Prioridade: a sugestão é `priority:medium`. O pedido é pequeno e localizado (um molde, uma validação, uma migração e o número nos commits de conflito), não bloqueia outra coisa e não corrige perda de dados; fica acima de `low` porque mexe na convenção de histórico de todo repositório que use o runner, e abaixo de `high` porque não quebra nada nem exige a pessoa agir de imediato. É sugestão, não decisão desta etapa.

## O que falta

Nada que só quem abriu possa dizer. A issue traz o comportamento pretendido, o estado atual com os pontos do código, as decisões de borda (o corte de 120 caracteres é do título do agente; um título que já tem o número não ganha repetido; execução sem issue não deixa `#` solto; o que fica fora do pedido) e os critérios de aceitação. As duas dúvidas que restam são de construção, não de quem abriu: onde a resolução de conflito lê o número da issue e o config, e onde o passo novo de migração entra na cadeia que hoje termina na v12.

## Issues relacionadas

Nenhuma. Não há outra issue registrada nesta pasta de ciclos que peça o mesmo comportamento; as triagens anteriores do repositório tratam de chamado de agente pela conversa, memória do ciclo e recusa por orçamento de chave, sem relação com o título da pull request ou a mensagem do commit. Nada parece duplicar esta issue.
