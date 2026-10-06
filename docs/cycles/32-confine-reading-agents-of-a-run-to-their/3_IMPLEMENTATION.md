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

## O que foi verificado nesta etapa (por execução)

- `npx tsc --noEmit` — sem erro.
- `npx vitest run` — **3675 testes em 222 arquivos, todos verdes**. Uma primeira passada teve um
  teste de `test/conflict-from-mr.test.ts` estourando o tempo limite de 5s sob carga; rodado sozinho
  ele passa (12/12) e a segunda passada completa também passou, sem tocar nesta mudança.
- `node scripts/theme-audit.mjs` — passa.
- `npm run i18n:lint` — 4054 chaves nos dois idiomas, 0 sem tradução.
- `node scripts/public-audit.mjs` — 909 arquivos, nada que pertença a uma empresa ou a uma pessoa.
- `npx electron-vite build` — construiu.

Casos de teste acrescentados ou estendidos:

- `test/worktree-guard.test.ts`: o guarda de um leitor recusa absoluto fora, `..`, `~`, link que
  sai, `.git` e o nome de segredo, e registra a recusa no `onDenied`; a composição dos hooks
  (segredo, busca ampla, censura do resultado) segue valendo; uma pasta de documentação dada como
  raiz é alcançável e uma irmã não é; pelo laço do motor aberto o modelo lê a recusa com o caminho.
- `test/runner-agent-open.test.ts`: um leitor confinado não recebe `Write`, `Edit` nem `Bash`;
  quatro leituras fora são recusadas, aparecem como bloqueadas na atividade e o modelo lê o caminho;
  o filtro de segredo continua na frente do guarda; uma pasta de documentação dada como raiz é
  alcançável e uma não dada não é.
- `test/runner-lifecycle.test.ts`: no fluxo real, toda etapa de leitura sai com `readRoot` na pasta
  de trabalho e sem `confine`, e toda etapa que escreve sai com `confine` e sem `readRoot`; uma
  recusa de leitura de uma etapa vira a linha `runner.denied` na conversa; a menção de um agente na
  conversa da execução sai com a raiz.
- `test/runner-chain.test.ts`, `test/runner-squads-requests.test.ts`, `test/forum-mentions.test.ts`,
  `test/mentions-call-line.test.ts`: a cadeia e a menção numa execução recebem a raiz; a menção num
  canal, a de uma conversa geral e o contato entre squads continuam sem ela.
- `test/agent-roles.test.ts`: `extraReadRoots` com `cwd` absoluto devolve as pastas de documentação
  fora dele, e vazio com `cwd` de cerimônia.
- `test/gitlab-catalogs-unchanged.test.ts`: a mudança de texto da recusa de leitura entrou no
  `INTENDED`, com o motivo.

## O que não foi verificado

- **Nenhum modelo real, nenhuma rede e nenhum host de código foram exercitados**: tudo rodou com os
  motores falsos de `test/helpers/`. O comportamento do Claude Agent SDK de verdade com um agente
  leitor não foi observado.
- O gate do `nvm use` não é executável nesta máquina (o `nvm` não está instalado); o Node do
  computador é o 26.5.1. Os demais gates rodaram com ele.
- A lista de pastas de documentação permitidas é derivada da configuração: uma pasta achada por
  auto-detect **fora** da pasta de trabalho deixa de ser alcançável pelo leitor da execução, e não
  consta da árvore nenhum passo de migração que a cadastre. Registrado como efeito conhecido, não
  como promessa contrária.
