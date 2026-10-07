# Revisão: um leitor de uma execução lê só dentro da pasta de trabalho dela

## O que foi revisado

A entrega foi relida contra a especificação (`1_SPEC.md`), o plano (`2_PLAN.md`) e a fronteira de
segurança do squad. O que a mudança promete: um agente que só lê numa execução — etapa de leitura,
menção na conversa da execução e pergunta da cadeia — passa a ter `Read`, `Grep` e `Glob` presos à
pasta de trabalho da execução, com as mesmas regras de recusa do agente que escreve, a recusa dita
na conversa e marcada como bloqueada na atividade, sem afrouxar o filtro de segredo, a censura do
resultado de busca nem a recusa de busca ampla, e sem mudar o agente que escreve.

Esta é a rodada 2. Foram conferidos primeiro os dois bloqueios da rodada 1 e a lacuna de teste que
ela registrou, e depois o conjunto da mudança no diff desta rodada. Foram conferidos por leitura e
por execução: o campo próprio (`read`/`readRoot`), a montagem e a composição dos hooks, o ponto onde
a raiz é ligada nos três caminhos de leitura, o `cwd` da menção de execução, a recusa relatada, o
texto de catálogo e os testes novos.

## Os bloqueios da rodada 1

1. **A recusa de leitura de um agente que escreve voltava a ser muda para o relato — corrigido.**
   `src/main/runner/hooks.ts:78` passa `readGuardOf({ root: o.root, onDenied: o.onDenied })`, e o
   guarda de leitura de `readGuardOf` chama `o.onDenied?.({ tool, target, code })` antes de recusar
   (`hooks.ts:90-96`). O caso novo em `test/worktree-guard.test.ts`
   (`tells the run about a refused read of an agent that writes too, as it does for a write`) afirma
   que a recusa de `Read`/`Glob` de quem escreve chega ao mesmo `onDenied`. Verificado por execução:
   os 10 arquivos de teste tocados passam (148 testes).
2. **A menção numa conversa de execução podia ler fora da pasta de trabalho — corrigido.**
   `src/main/mentions/answer.ts:137` faz o `cwd` cair na pasta de trabalho da execução quando ela
   existe (`place.run && existsSync(place.run.worktree) ? place.run.worktree : deps.env().fallbackCwd`),
   e o `readRoot` da menção tem a mesma pasta como raiz (`answer.ts:150`, `service.ts:1054-1060`). O
   caso novo em `test/runner-lifecycle.test.ts` (`gives an agent named in a run's thread no place to
   read from but the worktree, even when it runs no commands`) afirma `cwd === readRoot.root === a
   pasta de trabalho`, e não a pasta de projetos. Verificado por execução: verde.
3. **Lacuna de teste do motor do Claude Agent SDK — fechada.** O caso novo em
   `test/runner-agent.test.ts` roda um agente leitor com o confinamento de leitura pelo caminho do
   SDK e afirma os matchers dos hooks (`Read|Grep|Glob`, `Grep|Glob`, `PostToolUse`), `Edit`,
   `Write`, `Bash` e a rede negados, um diretório adicional de documentação, e a recusa de leitura
   chegando ao `onDenied`. Verificado por execução: verde. Uma ressalva abaixo, não bloqueante.

## O que está certo

- **O campo é próprio e não abre nada.** `Edit`, `Write`, o shell e o VCS continuam decididos só por
  `confine` (`toolsOf` em `agents.ts:1016-1020`, `disallowedTools` em `sdkOptions`,
  `shellOff` em `agents.ts:407-408`). Um leitor confinado segue sem `Bash`, sem `Edit` e sem `Write`;
  o teste novo do SDK e o do motor aberto confirmam, por execução, que nenhuma dessas ferramentas
  aparece na lista oferecida.
- **Os hooks do leitor somam, não substituem.** `readConfinedHooks` (`hooks.ts:116-124`) põe
  `noSecrets` e o guarda na mesma entrada de `Read|Grep|Glob`, `noBroadSearch` em `Grep|Glob` e
  `redactSecretResults` no `PostToolUse`. Os testes afirmam, por execução, que um nome de segredo, uma
  busca ampla e a censura do resultado continuam valendo num leitor confinado.
- **A raiz de leitura é ligada nos três caminhos pedidos** e só neles: a etapa de leitura
  (`executor.ts:442`), a pergunta da cadeia com pasta de trabalho existente (`service.ts:1123`) e a
  menção numa conversa de execução (`service.ts:1054-1057` via
  `MentionDeps.readRoot`). Canal, conversa geral, cerimônia e contato entre squads seguem sem
  confinamento de leitura; `readConfinement` devolve `undefined` quando a pasta não existe, o que
  `test/runner-chain.test.ts` e `test/runner-squads-requests.test.ts` cobrem.
- **A guarda cobre tudo o que a especificação pede**: absoluto fora, `..`, `~`, link que leva para
  fora, link que não leva a lugar nenhum, `.git` e arquivo de segredo (`guard.ts:78-108`). Uma pasta
  de documentação dada como raiz extra é alcançável e uma irmã não é.
- **A escrita não passa a aceitar raiz extra nenhuma**: para um agente que escreve, o guarda de
  leitura é montado sem `roots` (`hooks.ts:78`), então `checkPath` o julga só contra a pasta de
  trabalho.
- **A recusa cita o alvo**, e a mensagem do motor aberto cita o caminho e as pastas permitidas; o
  texto novo do catálogo entrou no `INTENDED` de `test/gitlab-catalogs-unchanged.test.ts` com motivo.

## O que foi conferido por execução

- `npx tsc --noEmit`: sem erro.
- Os 10 arquivos de teste tocados pela mudança: 148 testes, todos verdes.
- A suíte completa: **3678 passam, 0 falham, em 222 arquivos**. As três falhas de tempo limite
  relatadas pela etapa anterior não reapareceram nesta execução, no mesmo worktree; ficam como
  instabilidade sob carga, sem relação com os arquivos tocados.
- `node scripts/public-audit.mjs`: 911 arquivos, nada que pertença a uma empresa ou a uma pessoa. A
  primeira execução acusou dois acertos dentro de `out/` (a pasta de build, ignorada pelo git, que
  sobrou de uma build anterior na cópia de trabalho); removida a pasta, a auditoria passa limpa. Não
  é um vazamento do que a mudança escreve.
- `npm run i18n:lint`: 4054 chaves nos dois idiomas, 0 sem tradução.
- `node scripts/theme-audit.mjs`: passa (as 8 cores literais de `api.ts`, as mesmas de antes).

## Abaixo disso (não bloqueia)

- O caso novo do SDK (`test/runner-agent.test.ts`) monta o confinamento com
  `readConfinement(root, 'deep', …)` e **depois** troca `read.roots = [docs]`. Os hooks dentro do
  objeto foram construídos antes da troca, então a guarda que o teste exercita não recebeu `docs`
  como raiz: o caso prova a recusa fora da pasta de trabalho e o relato ao `onDenied`, mas não prova
  que uma pasta de documentação permitida é alcançável pelo guarda. O caminho de permissão está
  coberto em `test/worktree-guard.test.ts` e `test/runner-agent-open.test.ts`, que exercitam o guarda
  do leitor direto; a lacuna é só do caso novo, não do produto.
- A composição descrita pela etapa anterior para `sdkOptions` vale igualmente para o motor aberto,
  porque o motor aberto recebe as mesmas `Options` e mapeia `additionalDirectories` para as raízes do
  seu contexto (`engine/open/bridge.ts:91`, `engine/open/tools/read.ts:32-34`); conferido por leitura,
  não exercitado com modelo real.

## O que não foi verificado

- Nenhum modelo real, nenhuma rede e nenhum host de código foram exercitados. O teste do SDK troca a
  consulta do SDK por uma falsa; o comportamento do Claude Agent SDK de verdade com um agente leitor
  confinado não foi observado — o que se observou foi o conjunto de opções e os hooks que o app
  entrega a ele.
- O gate de versão de Node do projeto não é executável nesta máquina; os demais comandos rodaram
  com o Node disponível (26.5.1).
- `electron-vite build` não foi rodado nesta passada.
