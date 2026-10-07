# Memória do ciclo

## Decisões

- A issue é **pedido de funcionalidade**. `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e `4_REVIEW.md` estão na pasta. A branch está sobre a **`release/0.7.0`**; a migração de autonomia é **`v15ToV16`** (**`CONFIG_SCHEMA_VERSION` 16**), idempotente e que **nunca toca na rede**.
- **Bloco de autonomia de cinco campos**, em dois lugares: `runner.autonomy` (espaço de trabalho) e `devCycle.autonomy` por fluxo (chave `''`, id do squad, `release`), com `useWorkspace` ligado por padrão. Resolvedor puro `src/shared/config/autonomy.ts` (`autonomyOf`, `choiceOn`, `onChoices`, `flowKeyOf`, `newFlowAutonomy`): fluxo com `useWorkspace` desligado decide; senão o espaço de trabalho. `choiceOn` só é `true` com `cycle` ligado.
- **Rede `open`**: `SANDBOX_NETWORKS` ganha `open`; `bwrapArgs` não põe `--unshare-net` em `open`; `sandboxEnv` sem proxy; `nameResolverBinds` (`system.ts`) monta o alvo real de `/etc/resolv.conf` somente leitura; prompt (`prompt.ts`, `mentions/call.ts`) e catálogos dizem que o agente tem rede.
- **Navegador pareado só desce**: `runner.autonomy` e `runner.sandbox` fora de `WEB_EDITABLE`; `devCycle.autonomy` dentro, com `raisedAutonomy` recusando `false → true` e `useWorkspace true → false`.
- **As quatro escolhas lidas nos pontos de decisão**: etapa (`enter` faz `rec.autonomous = cycleAutonomous || autonomous`); gate automático (`gateBy(..., 'app')`, com motivo e origem); comando `host` sem pergunta (`hostApproval`) com uma linha `runner.command.autonomy` na conversa; **push e pull request autônomos** (`publish.ts` → `chooses` → `door.push` / `door.post`), com `pushRunBranchAuto` novo em `actions.ts` e `door.push` em `door.ts`.
- **A lista de comandos**: `CommandsSection.tsx` lê a conversa viva e `postRunCommands` (`service.ts`, chamado de `tell` quando a execução termina) posta **uma** mensagem `runner.commands.list`, por agente e etapa.
- **Cabeçalho e telas**: `AutonomyNote.tsx` no cabeçalho da execução; `AutonomyFields.tsx` no bloco do espaço de trabalho (`RunnerSection.tsx`) e no de cada fluxo (`FlowEditor.tsx`), com o interruptor "Usar a configuração do espaço de trabalho".
- **Uma execução de release fica fora das escolhas de push e pull request**, por construção (`run.subject ? false : ...`), e o cabeçalho não aparece nela.
- Decisões da pessoa já respondidas: rebasear sobre `release/0.7.0`, migração `v15ToV16`; uma passada só; push/PR de release fora das escolhas; a linha do comando `host` sob autonomia (recomendação seguida); o bloco do fluxo em Time e ciclo; `open` desligada numa instalação nova.
- Resposta: (1) Continuar na próxima tentativa, sem fechar esta passada como está. Uma passada só, na ordem da seção 9 do plano. Critério de saída: suíte verde, migração v16 com teste próprio (a branch passa a partir da release/0.7.0, que já está no esquema 15), a chave ui.runner.warn.networkOpen na ordem do catálogo, raisedAutonomy escrita, a autonomia lida nos pontos de decisão, a lista de comandos por agente, e docs/runner.md, docs/configuration.md e CHANGELOG.md atualizados. (2) Não fatiar em dois cortes. (3) Confirmo: o push e o pull request de uma execução de release ficam fora das duas escolhas e s… <!-- answer:69 -->
- Resposta: (1) Rebasear sobre a release/0.7.0; ela segue aberta (beta.10, sem v0.7.0 estável). A migração de autonomia vira v15ToV16 e os testes de esquema passam a esperar 16. Não reaplique o stash às cegas: a implementação foi escrita sobre o esquema 12 e 27 dos arquivos mudaram na release. Refaça a parte de configuração (types, schema, migrations, defaults, testes de esquema, catálogos i18n) sobre o código da release, aproveitando o stash só como referência. O restante (sandbox, prompt do runner, Time e ciclo) deve passar com conflitos pequenos. Rebase e troca da base da execução ficam com a sessão pr… <!-- answer:123 -->

## Restrições

- A migração **nunca eleva**: todo espaço de trabalho existente fica com os cinco campos desligados e a rede como estava. Espaço de trabalho de teste recusa toda escrita externa; a elevação só no computador.
- `types.ts`, `defaults.ts` e `schema.ts` andam juntos; toda string nova vai ao catálogo nos dois idiomas; o repositório é público; nenhum teste alcança modelo, host ou rede de verdade.
- A rede `open` é a rede do computador inteira, sem filtro: escolha de risco da pessoa, padrão fechado. Onde não há sandbox, nada muda.

## Tentado e descartado

- Guardar o bloco do fluxo dentro de `devCycle.stages`/`flows`: descartado, listas não guardam um objeto; usa-se o mapa irmão `devCycle.autonomy`.
- Um campo novo no run para a lista de comandos: descartado; ela é feita do que a execução já registra.
- A justificativa de que o `push` autônomo não podia usar `'push'` como valor no `publish.ts` caiu: a porta precisa de um método com esse nome, e o `test/runs-policy.test.ts` foi reescrito para proibir só o comando de git e a função de push, fixando que a porta é quem pede.

## Perguntas abertas

- **Da implementação** (observações da revisão, não bloqueiam): o rótulo da etapa na seção de comandos vai como o identificador interno, sem passar pelo catálogo; e a lista do fim só carrega o que virou linha de conversa, deixando de fora um comando recusado antes de escrever qualquer linha.

## Onde o trabalho está

**As alterações de código estão commitadas** no assunto `feat: wire the autonomy of a run, the open network and the commands list #118` (quem commita é o app). 21 arquivos modificados e 3 novos (`AutonomyNote.tsx`, `CommandsSection.tsx`, `AutonomyFields.tsx`), além dos quatro da passada anterior (`src/shared/config/autonomy.ts`, `src/shared/runCommands.ts`, `test/autonomy.test.ts`, `test/run-commands.test.ts`).

**Verificado nesta etapa da revisão**: `npx tsc --noEmit` limpo; a suíte inteira em uma corrida — **4156 casos verdes em 255 arquivos**, com duas falhas que não são desta mudança (`test/host-terms-leak.test.ts` estourou 5 s sob carga e `test/update-script.test.ts` falhou por tempo; as duas passam sozinhas na mesma máquina); `theme-audit`, `i18n:lint` (4422 chaves) e `public-audit` (1092 arquivos) limpos. Testes novos cobrem o push/pull request autônomos e auditados, a recusa no espaço de trabalho de teste, o comando `host` sem pergunta com a linha de autonomia e a mensagem final, a lista por agente e etapa, e o bloco do fluxo no editor.

**Nada foi visto funcionando no aplicativo** — nenhuma tela aberta, nenhum bloco ligado à mão; e a rede `open` não alcançou um endereço público de verdade num teste (só resolveu um nome e viu a interface da máquina).

- Passagem support → product-owner: a triagem não achou nada faltando que só quem abriu possa dizer; a etapa seguinte foi o refinamento do produto, que escreveu a spec funcional. <!-- handoff:6 -->
- Passagem product-owner → pessoa: a especificação funcional está em `1_SPEC.md`. <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: o plano está em `2_PLAN.md`, com as quatro frentes e a ordem da seção 9. <!-- handoff:20 -->
- Passagem developer → revisor-plataforma: os quatro buracos da revisão anterior foram escritos nesta passada (push e pull request autônomos, seção Comandos com a mensagem final, cabeçalho e as duas telas do bloco). <!-- handoff:539 -->
- Passagem revisor-plataforma → pessoa (esta tentativa): **aprovado**. Os quatro bloqueios foram conferidos como feitos, os três pedidos não bloqueantes foram seguidos, e ficam duas observações menores (o rótulo da etapa sem tradução na lista; a recusa que não virou linha de conversa fora da mensagem final).
- Passagem developer → revisor-plataforma: 1. **Antes de tudo, recuperar o trabalho**: rodar `git stash pop` (ou `git stash apply stash@{0}`) no worktree. O último comando desta etapa não voltou e as alterações de código estão presas no stash (entrada "wip4"); o worktree agora só tem o estado commitado (os documentos do ciclo sobre a `release/0.7.0`). Conferir com `git status` que os arquivos mudados voltaram. Se o `pop` conflitar, o stash tem a versão completa.\n2. Com o código de volta, conferir `npx tsc --noEmit` e `npx vitest run` (em lotes: a suíte inteira estoura o tempo da máquina).\n3. O que falta implementar, na ordem do plano… <!-- handoff:331 -->
- Passagem revisor-plataforma → developer: The work was recovered from the stash and reviewed against `1_SPEC.md` and `2_PLAN.md`. Nine of the ten spec acceptance criteria that this pass set out to cover are implemented and pass their gates: the config block (types/defaults/schema/`v15ToV16` migration and the pure `autonomyOf`/`choiceOn` resolver), the `open` sandbox network (`--unshare-net` withheld, no proxy env, `nameResolverBinds` for the real resolver target, exercised by a real `bwrap` test), the decision read at the stage start, the gate auto-approval recorded as `by: 'app'` with its origin, the `shell: host` command without the… <!-- handoff:364 -->
