# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (`enhancement`), completo, sem pergunta pendente para quem abriu nem para a pessoa.
- Refino (esta etapa): especificação funcional escrita em `1_SPEC.md`, nas palavras do produto, com o que muda para quem usa, as regras, o fora do escopo e dez critérios de aceite. Nenhuma solução foi projetada.
- Sugestão de prioridade no documento e no campo da etapa (não decidida aqui): `priority:medium` — mudança pequena e localizada, mas mexe na convenção de histórico de todo repositório que use o runner. Sem marco.

## Restrições

- Só leitura de código e de script nesta etapa: nenhum teste foi rodado, nenhum comportamento foi reproduzido, nenhuma migração foi executada, nenhuma auditoria pública foi executada. O único comando executado imprimiu as regras de auditoria que estão codificadas no script.
- O campo novo `prTitle` precisa entrar na lista de caminhos que a tela Time pelo navegador aceita (`WEB_EDITABLE`, `src/main/configScope.ts`, espelhada em `docs/configuration.md` nos dois idiomas); fora dela, salvar o campo no navegador é recusado.
- A regra `real-issue-number` da auditoria pública (`scripts/public-audit.mjs`, regras codificadas) inclui o número usado nos exemplos de aceite da issue: teste ou documento com ele reprova `node scripts/public-audit.mjs`. Escrever os exemplos com número neutro (`#321`, `#456`). A lista de permissão casa por `text.includes(match)` na linha inteira, o que liberaria o resto da linha junto.
- Documentos, catálogos e testes que a mudança obriga a mover, conferidos por leitura: `docs/configuration.md` (listas de campos e histórico do esquema, nos dois idiomas), `docs/runner.md:92/310`, `CHANGELOG.md` em `## [Unreleased]`, `ui-team.en.json`/`ui-team.pt-BR.json`, `test/runner-config.test.ts:12`, `test/runner-units.test.ts:230`, `test/conflict-resolve.test.ts:257`, `test/config-web-scope.test.ts:45`, `test/team-runner-edit.test.ts:12`.

## Tentado e descartado

- Escrever a especificação com o número de exemplo que a issue usa: descartado, porque reprova a auditoria pública; os exemplos foram escritos com número neutro.

## Perguntas abertas

- Nenhuma para quem abriu ou para a pessoa. Ficam para o desenho: onde o commit do conflito da branch de execução lê o número da issue e o molde; onde o passo novo de migração entra na cadeia que hoje termina na v12; como o `prTitle` guardado é reparado num config vindo sem o campo.

## Onde o trabalho está

- Etapa concluída: `1_SPEC.md` na pasta do ciclo, com a especificação funcional. Antes dela, `0_TRIAGE.md`.
- Conferido por leitura nesta etapa, além do que a triagem já trazia: o título do rascunho e o da proposta saem de `output.pr.title`/título da issue com corte em 120 (`src/main/runner/publish.ts:673` e `:691`) e a proposta vai como `summary` para a ação (`proposeVcsAction`, `src/main/actions.ts:167`); o molde de commit é substituído em `commitMessage` (`src/main/runner/git.ts:144`), largando `#` e número quando `iid` é 0; a validação só exige `{summary}` (`src/shared/config/validate.ts:143-144`); o editor tem checagens próprias e um `RunnerField` por campo (`src/renderer/src/screens/team/runnerEdit.ts:26/48/67/81/128-130`); o esquema declara `runner.commitMessage` (v12) e `prTitle` não existe (`src/shared/config/schema.ts:451`); a migração corrente é v11→v12 e `STEPS` termina em 11 (`src/shared/config/migrations.ts:253-263`); a tela do runner é um form que mostra o campo de commit sempre (também no navegador) e grava via `config:cycle-save` (`src/renderer/src/screens/team/RunnerSection.tsx:133-135`, `teamApi.ts:12`); o commit do conflito commita com `mergeMessage(branch)` sem número (`src/main/conflictGit.ts:331-345`), chamado de `conflictCommit` (`src/main/actions.ts:848-853`), que tem o número em `a.issue` e no registro `mr_iid`/`source_branch`/`target_branch`/`project_path`, e `mergeIdentity(clone)` já lê o config ali (`:707-710`); os merges de release têm mensagem própria e ficam fora (`src/main/releaseGit.ts:440/471/475`); o texto do prompt pede ao agente um título "under 70 characters, without the issue number" (`src/shared/i18n/main.en.json:970`); a tela da execução mostra o título guardado no registro do pull request (`src/renderer/src/screens/cycle/RunScreen.tsx:153`); o campo novo precisa voltar ao rascunho no `planWrite` (`src/main/runner/module.ts:87-92`).
- Próxima etapa: desenho/planejamento a partir de `1_SPEC.md`; a passagem para lá está no campo handoff.
- Passagem product-owner → design: o comportamento está fixado e as decisões de construção listadas no handoff (onde o conflito lê o número e o molde; onde a migração entra; como o `prTitle` guardado é reparado); os itens de auditoria pública e a lista de documentos/testes a mover estão nas restrições acima.
- Passagem support → product-owner: Refino do produto (1_SPEC.md). A triagem é de um pedido de funcionalidade completo, sem pergunta pendente para quem abriu nem para a pessoa. O que a próxima etapa precisa carregar: (1) os três comportamentos da issue foram conferidos no código e continuam os mesmos — a validação só exige `{summary}` (`src/shared/config/validate.ts:143-144`), o título do rascunho e o da proposta nunca levam o número (`src/main/runner/publish.ts:673` e `:691`, com `createMr` em `:696-697`), e o commit do conflito usa `mergeMessage` sem número (`src/main/conflictGit.ts:331-340`, chamado de `src/main/actions.ts:84… <!-- handoff:6 -->
