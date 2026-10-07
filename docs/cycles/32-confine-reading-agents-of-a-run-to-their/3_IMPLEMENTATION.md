# A leitura de um agente de execução fica dentro da pasta de trabalho

## O que ficou diferente

Um agente que só lê numa execução — uma etapa de leitura, um agente chamado com `@` na conversa da
execução e um agente que responde a uma pergunta da cadeia — passa a receber o mesmo guarda de
caminho que o agente que escreve já tinha, sobre `Read`, `Grep` e `Glob`: caminho absoluto que sai
da pasta de trabalho, `..`, `~`, link simbólico que leva para fora, link que não leva a lugar
nenhum, qualquer coisa dentro de `.git` e arquivo de segredo ficam recusados. A recusa continua
sendo dita na conversa da execução e marcada como bloqueada na atividade ao vivo.

O que já valia continua valendo por cima: o filtro de arquivo de segredo, a censura do resultado de
busca e a recusa de busca ampla não foram substituídos pelo guarda de caminho, e sim postos ao lado
dele. O agente que escreve não mudou, e as cerimônias seguem lendo a pasta de projetos de propósito.
Menção num canal, numa conversa geral ou numa cerimônia, e o contato de um squad que lê o repositório
do próprio squad, continuam sem confinamento de leitura.

## O que foi feito, por commit

Quatro commits, na ordem do plano.

### `add a read-only confinement to a call, beside the one that writes`

Inerte: só o campo e a montagem dos hooks, sem nenhum chamador preenchendo o campo.

- `src/main/engine/contract.ts`: `ReadConfinement` (raiz, raízes extras, hooks) e `EngineRequest.read`.
- `src/main/engine/guard.ts`: `checkPath` passa a aceitar `roots`, as pastas fora da raiz que uma
  **leitura** ainda pode alcançar; o caminho é julgado contra a raiz que o contém, e a recusa por
  `..`, `.git` e segredo continua valendo dentro dela. A escrita não passa a aceitar raiz extra
  nenhuma.
- `src/main/agents.ts`: `AgentCall.readRoot`, `extraReadRoots(cwd, role)` (as pastas de
  documentação fora da pasta de trabalho, absolutas e sem descendentes do `cwd`; vazio quando o
  `cwd` não é absoluto), e `sdkOptions` escolhendo os hooks por `confine ?? read` e somando as
  raízes extras aos diretórios adicionais. `Edit`/`Write`, o shell, o VCS e os limites continuam
  decididos só por `confine`.
- `src/main/runner/hooks.ts`: `readConfinedHooks` compõe `noSecrets` + o guarda de caminho em
  `Read|Grep|Glob`, `noBroadSearch` em `Grep|Glob` e `redactSecretResults` no `PostToolUse`. O
  guarda de leitura de quem escreve passa a usar a mesma função, sem raízes extras.

### `confine the reading agent of a run to its worktree`

- `src/main/runner/executor.ts`: `readConfinement(root, role, onDenied)` devolve `undefined` quando
  a pasta não existe, e `runStage` a liga para `!writes`; o `confine` de quem escreve ficou como
  estava.
- `src/main/runner/service.ts`: a chamada da cadeia de perguntas e a menção numa conversa de
  execução recebem a mesma raiz, com a recusa relatada na conversa da execução pela linha
  `runner.denied` que já existe.
- `src/main/mentions/answer.ts`: `MentionDeps.readRoot` deixa o núcleo de menções genérico — quem
  tem a pasta de trabalho (o runner) devolve o confinamento; os demais donos devolvem `undefined`.

### `say a refused read of a run in the activity and the thread`

- A recusa do guarda passa a citar o alvo que o agente tentou, para ele poder se corrigir, usando a
  mesma chave de catálogo.
- `src/main/engine/open/tools/read.ts`: a mensagem de fora passa a citar o caminho e as pastas
  permitidas, no lugar do texto que falava só de cerimônia. Nenhuma chave de catálogo nova; a
  mudança de texto da chave existente entrou no `INTENDED` do teste de catálogos congelados.

### `write the reading confinement in the docs and the changelog`

- `docs/runner.md`: uma seção nova, **Agente que só lê**, ao lado da de quem escreve.
- `CHANGELOG.md`, sob `## [Unreleased]` › `### Fixed`.

## Correções desta passada (depois da revisão)

A revisão encontrou dois bloqueios e uma lacuna de teste. Os três foram tratados nesta passada.

1. **O guarda de leitura de quem escreve tinha ficado sem o retorno de recusa.** Em
   `confinedHooks` (`src/main/runner/hooks.ts:78`), o guarda de leitura passou a ser montado por
   `readGuardOf({ root: o.root })`, sem `onDenied`, então uma leitura recusada de um agente que
   escreve não chamava mais o relato do runner e a linha `runner.denied` deixava de ser posta na
   conversa da execução (a atividade ao vivo seguia marcando a chamada como bloqueada). Corrigido
   repassando o retorno: `readGuardOf({ root: o.root, onDenied: o.onDenied })`, exatamente como a
   revisão sugeriu. Um caso em `test/worktree-guard.test.ts` agora afirma que a recusa de leitura
   de quem escreve chega ao mesmo `onDenied`.
2. **Uma menção numa conversa de execução ainda podia ler fora da pasta de trabalho.** Em
   `src/main/mentions/answer.ts:137`, quando o agente nomeado não rodava comandos, o `source` ficava
   nulo e o `cwd` da chamada caía na pasta de projetos do espaço de trabalho, enquanto a raiz do
   guarda era a pasta de trabalho da execução; o guarda julgava o caminho escrito contra a pasta de
   trabalho e o motor resolvia o mesmo caminho relativo contra a pasta de projetos, então um caminho
   relativo era aprovado pelo guarda e lido fora da pasta de trabalho no motor do Claude Agent SDK.
   Corrigido fazendo o `cwd` cair na pasta de trabalho da execução quando ela existe
   (`place.run && existsSync(place.run.worktree) ? place.run.worktree : deps.env().fallbackCwd`),
   exatamente como a revisão sugeriu: a pasta de trabalho da menção e a raiz do guarda passam a ser
   a mesma pasta. Um caso em `test/runner-lifecycle.test.ts` afirma que, numa menção de execução cujo
   agente não roda comandos, `cwd` e `readRoot.root` são a pasta de trabalho, nunca a pasta de
   projetos.
3. **Nenhum teste exercitava o motor do Claude Agent SDK de verdade com um agente leitor.** Um caso
   em `test/runner-agent.test.ts` roda um agente leitor com o confinamento de leitura pelo caminho do
   SDK (o mesmo motor, com a consulta falsa do arquivo) e afirma: os hooks vêm do confinamento de
   leitura (os dois grupos de `PreToolUse` e o de `PostToolUse`), `Edit`, `Write`, `Bash` e a rede
   continuam negados, os diretórios adicionais trazem a pasta de documentação permitida, e uma
   leitura recusada chega ao `onDenied` do runner. Esse caso cobre, no motor que a issue nomeia, o
   1º bloqueio e a ausência de ferramentas a mais para o leitor.

## O que foi verificado nesta etapa (por execução)

- `npx tsc --noEmit` — sem erro, com as correções e o teste novo.
- `npx vitest run` — **3675 passam, 3 falham**, em 222 arquivos. As três falhas estão em arquivos que
  esta mudança não toca (`test/conflict-resolve.test.ts`, duas, e `test/update-script.test.ts`, uma),
  são testes com espera por relógio e passam quando rodados sozinhos (`update-script` 12/12;
  `runner-chain`, que falhou numa passada anterior, também passa sozinho). A suíte inteira roda sob
  carga alta do computador, com centenas de processos de teste; nenhuma falha é dos arquivos tocados.
- `node scripts/theme-audit.mjs` — passa (8 cores literais em `api.ts`, as mesmas de antes).
- `npm run i18n:lint` — 4054 chaves nos dois idiomas, 0 sem tradução.
- `node scripts/public-audit.mjs` — 911 arquivos, nada que pertença a uma empresa ou a uma pessoa.
- `npx electron-vite build` — construiu.

Casos de teste acrescentados ou estendidos (o que já existia da passada anterior continua):

- `test/runner-agent.test.ts` (novo nesta passada): o agente leitor confinado pelo caminho do SDK —
  hooks do confinamento, sem `Edit`/`Write`/`Bash`, diretórios adicionais, e a recusa de leitura
  chegando ao `onDenied`.
- `test/worktree-guard.test.ts` (novo nesta passada): a recusa de leitura de um agente que escreve
  chega ao `onDenied` do runner, como a recusa de escrita.
- `test/runner-lifecycle.test.ts` (novo nesta passada): a menção numa conversa de execução cujo
  agente não roda comandos usa a pasta de trabalho como `cwd` e como raiz do guarda.
- `test/worktree-guard.test.ts`, `test/runner-agent-open.test.ts`, `test/runner-lifecycle.test.ts`,
  `test/runner-chain.test.ts`, `test/runner-squads-requests.test.ts`, `test/forum-mentions.test.ts`,
  `test/mentions-call-line.test.ts`, `test/agent-roles.test.ts`,
  `test/gitlab-catalogs-unchanged.test.ts`: como na passada anterior (guarda de leitura sobre
  absoluto fora, `..`, `~`, link, `.git` e segredo; composição dos hooks; raízes extras de
  documentação; ausência de `Write`/`Edit`/`Bash` num leitor; ligação da raiz nas três chamadas de
  leitor; `extraReadRoots`; e a mudança de texto do catálogo).

## O que não foi verificado

- **Nenhum modelo real, nenhuma rede e nenhum host de código foram exercitados**: tudo rodou com os
  motores falsos de `test/helpers/` e com a consulta falsa do SDK que o teste do motor troca. O
  comportamento do Claude Agent SDK de verdade com um agente leitor não foi observado — o que se
  observou foi o conjunto de opções que o app entrega a ele.
- O gate do `nvm use` não é executável nesta máquina (o `nvm` não está instalado); o Node do
  computador é o 26.5.1. Os demais gates rodaram com ele.
- A lista de pastas de documentação permitidas é derivada da configuração: uma pasta achada por
  auto-detect **fora** da pasta de trabalho deixa de ser alcançável pelo leitor da execução, e não
  consta da árvore nenhum passo de migração que a cadastre. Registrado como efeito conhecido, não
  como promessa contrária.
- As três falhas da suíte completa não foram confrontadas com a árvore sem a mudança nesta passada;
  elas estão em arquivos que a mudança não toca e passam quando rodados sozinhos, e ficam marcadas
  como não verificadas contra a base.
