# A autonomia ligada nos quatro pontos de decisão, a rede aberta na sandbox e a lista dos comandos

## Estado desta passada

A revisão anterior derrubou a entrega por três buracos: o push e o pull request autônomos não estavam ligados, a seção "Comandos" e a mensagem final não existiam, e nem o cabeçalho da execução nem as telas do bloco de autonomia foram escritas. Nesta passada os quatro foram escritos, e o trabalho está **no worktree, sem commit** (quem commita é o app).

## O que foi implementado

### Push e pull request autônomos

- `src/main/runner/publish.ts`: um `chooses(run, choice)` lê `autonomyOf(config, flowKeyOf(run.squad))`, e **uma execução de release fica fora das duas escolhas** pelo próprio resolvedor (`run.subject ? false : ...`), sem tocar em `releaseWaits`/`alwaysWaits`.
- `pushStage`: com `cycle` + `push`, o push sai pela porta em vez de virar proposta. Sem host ou num espaço de trabalho de teste a porta recusa e a conversa diz (`runner.push.refused`); uma falha vira `runner.push.failed`.
- `pullRequest`: com `cycle` + `pullRequest`, o pull request é aberto por `door.post` (auditado) e segue por `pullRequestOpened`; num espaço de trabalho de teste a recusa é dita (`runner.pr.refused`).
- `src/main/actions.ts`: `pushRunBranchAuto` novo — as mesmas checagens do caminho proposto (a execução existe, a branch bate, o worktree existe e está na branch certa, nada por commitar fora da memória do ciclo), uma linha de auditoria com o agente que pediu, a proposta antiga da mesma execução marcada como substituída, e o aviso `told(a, [])` no fim para que o pull request siga o push. A branch é lida do arquivo da execução, nunca de quem chama.
- `src/main/runner/door.ts`: a porta ganhou `push(meta, by)`, que é a única coisa que fala com as Actions.

### A lista dos comandos

- `postRunCommands` (`service.ts`), chamado de um ponto único em `tell` (`reachedEnd`: done, cancelled ou failed) e protegido contra postar duas vezes. Monta o texto por agente e por etapa a partir das mensagens `runner.exec`/`runner.exec.host` que a execução já escreve, e posta uma mensagem `runner.commands.list`.
- `CommandsSection.tsx` (novo) lê a conversa com `useThread` (viva) e agrupa com `groupCommands`; fica na tela da execução, ao lado da timeline.
- Chaves novas `main.runner.commands.*` e `main.forum.code.runner.commands.list` nos dois idiomas.

### O cabeçalho e as telas

- `AutonomyNote.tsx` (novo): uma linha no cabeçalho da tela da execução dizendo que ela roda sozinha, quais das quatro escolhas estão ligadas e de onde vem a decisão. Some numa release.
- `AutonomyFields.tsx` (novo): os cinco campos, com os quatro de baixo desabilitados enquanto a chave geral está desligada. Usado no bloco do espaço de trabalho (Settings › Runner) e no bloco de cada fluxo (Settings › Team e ciclo), este com o interruptor "Usar a configuração do espaço de trabalho" ligado por padrão, os campos desabilitados e a dica enquanto ele está ligado.
- `runnerEdit.ts` e `flowEdit.ts` passaram a carregar e a gravar os dois blocos (`runner.autonomy` e `devCycle.autonomy`, por chave de fluxo); o bloco de um fluxo que o editor não mostra (release, documentação) fica como está.

### A marca do comando `host` sob autonomia

- `hostApproval` (`executor.ts`) registra uma linha `runner.command.autonomy` na conversa quando a escolha liberou o comando, dizendo que ele rodou neste computador sob a autonomia do ciclo (a recomendação que a spec registrava e que não estava seguida).

### Documentação

- `docs/runner.md`: o bloco de autonomia e o que cada escolha faz, a exceção do `shell: host`, o push e o pull request condicionais à escolha (com a release fora e o espaço de trabalho de teste recusando), a rede `open` na descrição da sandbox, o cabeçalho e a seção "Comandos" na tela da execução, a linha do navegador pareado e a seção "Não verificado" dizendo que a rede `open` nasce não exercitada quanto a **alcançar** um endereço público.
- `CHANGELOG.md`, em `## [Unreleased]`: o bloco de autonomia, a rede `open` e a lista dos comandos, com o que está conferido e o que não está.

## O que foi verificado

- `npx tsc --noEmit` limpo; `npx vitest run --exclude test/sandbox-gui.test.ts` (a suíte inteira, uma vez): **4156 casos verdes, 253 arquivos**. Dois casos falharam: `test/sandbox-gui.test.ts` (o da pasta de navegadores, que falha na base e não toca arquivo desta mudança) e um caso de `test/sandbox-hardening.test.ts` que estourou o tempo limite de 5 s sob carga, e passa sozinho.
- Testes novos: push e pull request autônomos, auditados e sem proposta; a recusa no espaço de trabalho de teste com as duas escolhas ligadas; "só o pull request ligado" deixando o push esperar; o comando `host` sem pergunta com a linha de autonomia e a mensagem final; o bloco de autonomia do fluxo no editor.
- `node scripts/theme-audit.mjs`, `npm run i18n:lint` (4422 chaves nos dois idiomas), `node scripts/public-audit.mjs` (1092 arquivos) e `npx electron-vite build` limpos.
- O `test/runs-policy.test.ts` foi ajustado: o contrato "o runner não faz `git push`" continua valendo (nome de função e linha de comando proibidos), e agora fixa que a porta é quem pede o push.

## O que não foi verificado

- **Nada do comportamento novo foi visto funcionando no aplicativo**: nenhuma tela foi aberta, nenhum bloco foi ligado à mão e nenhuma execução foi rodada de ponta a ponta. O que se viu foi o código, os portões e os testes.
- A rede `open` **não alcançou um endereço público de verdade** em teste nenhum: o que o teste real mostra é que existe uma interface da máquina dentro da sandbox e que um nome público é resolvido. A seção "Não verificado" do documento do runner diz isso.
- O push autônomo e o pull request autônomo só rodaram contra o host falso com memória e um repositório git temporário; **nenhum host real**.
