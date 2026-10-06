# Memória do ciclo

## Decisões

- Issue #32 é **bug** (squad Plataforma): no motor do Claude Agent SDK um agente que só lê numa
  execução não tinha a guarda de caminho que o agente que escreve tem. Especificação em `1_SPEC.md`,
  solução em `2_PLAN.md`, implementação em `3_IMPLEMENTATION.md`.
- **Pergunta de escopo respondida pela pessoa: "deixa como está" (`answer:86`).** A raiz de leitura é
  a pasta de trabalho da execução onde ela existe (etapa de leitura, menção numa conversa de
  execução, pergunta da cadeia com pasta de trabalho existente); menção num canal, numa conversa
  geral ou numa cerimônia, e o contato de squad que lê o repositório do próprio squad, continuam
  **sem** confinamento. Nenhum campo de configuração novo, nenhuma migração.
- **Implementado (4 commits, ordem do plano).** (1) inerte: `ReadConfinement` + `EngineRequest.read`,
  `checkPath` aceitando `roots` só para leitura, `extraReadRoots(cwd, role)`, `sdkOptions` escolhendo
  hooks por `confine ?? read` e somando raízes extras aos diretórios adicionais, `readConfinedHooks`;
  (2) ligar: `readConfinement(root, role, onDenied)` em `executor.ts` para `!writes`, cadeia em
  `service.ts`, `MentionDeps.readRoot` em `mentions/answer.ts` preenchido pelo runner; (3) recusa
  cita o alvo e a mensagem do motor aberto cita caminho e pastas; (4) `docs/runner.md` (seção nova
  "Agente que só lê") e `CHANGELOG.md`.
- O campo é próprio: `confine` continua significando "muda arquivos" em `toolsOf`, `wantsVcsTool`,
  `sdkOptions`, `shellEnv`, `writeRoot`. `Edit`/`Write`/shell decididos só por `confine`.
- Os hooks do leitor **somam**: `noSecrets` + guarda em `Read|Grep|Glob`, `noBroadSearch` em
  `Grep|Glob`, `redactSecretResults` no `PostToolUse`. Nada substituído.
- Lista de pastas de documentação permitidas derivada da configuração: as mesmas que o leitor já
  recebia como diretórios adicionais, sem as achadas por auto-detect dentro da pasta de trabalho e
  sem descendentes do `cwd`. Efeito registrado: pasta de documentação achada por auto-detect
  **fora** da pasta de trabalho deixa de ser alcançável.
- A recusa do guarda passa a citar o alvo (`cp('runner.denied.*') + ': ' + alvo`); a chave de
  catálogo `main.engine.text.read.outside` mudou de texto para citar caminho e pastas, e a mudança
  entrou no `INTENDED` de `test/gitlab-catalogs-unchanged.test.ts` (gate de catálogos congelados).

## Restrições

- Bug de confinamento: **não afrouxar** o filtro de segredo, a censura de resultado de busca nem a
  recusa de busca ampla. A mudança só restringe.
- As cerimônias (daily, unblock, retro) leem a pasta de projetos de propósito e ficam fora.
- Toda recusa vai para a conversa da execução (`runner.denied`) e para a atividade ao vivo como
  bloqueada (`reportBlocked`), pela fiação que já existe.
- `wrapUpAnswer` (`agents.ts`) limpa `read` ao retomar sem ferramenta nenhuma; o resto de `confine`
  fica como estava, para não mudar o `disallowedTools` de quem escreve.
- Nenhum teste pode tocar modelo, host ou rede: só os motores falsos de `test/helpers/`.

## Tentado e descartado

- Ligar a leitura no campo `confine`: abriria `Edit`/`Write` e o shell.
- Escolher as pastas permitidas por auto-detect: não é lista explícita, e a raiz de uma menção de
  cerimônia coincide com a raiz do próprio agente, tornando a restrição vazia.
- Esperar que o SDK negue leitura fora do `cwd` sozinho (`blockReadsOutsideWorkingDirectories`): é
  um interruptor do processo, sem alvo nem código de recusa; a guarda do projeto é a que relata.
- Fechar também os caminhos fora de uma execução (canal, conversa geral, cerimônia, contato de
  squad): descartado **pela pessoa** ("deixa como está"); exigiria campo de configuração novo com
  passo em `STEPS`, tipos/defaults/schema e migração.
- Mudar o `nvm use`: não é executável nesta máquina (nvm ausente; Node 26.5.1).

## Perguntas abertas

- Nenhuma pergunta de escopo. Ponto observado, **não** é pergunta a quem abriu: com a lista derivada
  da configuração, uma pasta de documentação achada por auto-detect **fora** da pasta de trabalho
  deixa de ser alcançável pelo leitor; não há passo de migração que a cadastre. Se a pessoa quiser
  preservá-la, a lista explícita de configuração passa a ser necessária — registrado na seção 3.3 do
  plano, não vira questão agora.

## Onde o trabalho está

Implementação concluída no worktree. Gates do `CLAUDE.md` verdes por execução: `npx tsc --noEmit`
sem erro; `npx vitest run` com **3675 testes em 222 arquivos, todos verdes**; `theme-audit`,
`i18n:lint` (4054 chaves nos dois idiomas, 0 sem tradução), `public-audit` (910 arquivos, limpo) e
`electron-vite build` passaram. Numa primeira passada da suíte o `test/conflict-from-mr.test.ts`
estourou o tempo limite de 5s sob carga; isolado passa (12/12) e a segunda passada completa passou —
não é desta mudança. Não foi exercitado modelo, rede nem host reais; o caminho do Claude Agent SDK
de verdade com um leitor confinado **não foi observado** (só o motor aberto e os motores falsos).
A próxima etapa escreve a verificação a partir de `3_IMPLEMENTATION.md`; o que ainda pode ser
tentado é exercitar o motor do SDK de verdade, que esta etapa não tocou.
- Passagem support → product-owner: Refinamento do produto: confirmar as duas escolhas abertas antes de projetar a solução — (1) se as pastas de documentação listadas fora da pasta de trabalho ficam de fora ou entram por lista explícita, e (2) o alcance das menções e da cadeia de perguntas quando não há conversa de execução (canal, conversa geral) e o caso do contato de outro squad que lê o repositório do próprio squad. A triagem sugere lista explícita curta e derivada da configuração, e raiz igual à pasta de trabalho quando ela existir. Tipo: bug; não é duplicata; nenhuma pergunta a quem abriu. O trabalho começa em src/main/run… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejamento: projetar a solução a partir de `1_SPEC.md` (as 8 regras e os 11 critérios). A leitura confirma que a guarda de leitura já existe em `src/main/runner/hooks.ts` (`readGuard` sobre `Read`/`Grep`/`Glob`, com `checkPath(root, p, { read: true })` e cada recusa relatada via `onDenied`), que `checkPath` já julga leitura e libera a própria raiz, e que hoje o executor só monta `confine` para quem escreve (`executor.ts:430`). O plano deve introduzir um campo de raiz de leitura próprio (por exemplo `readRoot`), sem abrir `Edit`/`Write`/shell, e ligá-lo às chamadas de leitor (etapa de leitura… <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: O desenho está fechado: a resposta de escopo ("deixa como está") confirma que a raiz de leitura é a pasta de trabalho da execução nas três chamadas de leitor (etapa, menção numa conversa de execução, pergunta da cadeia com pasta de trabalho existente) e que menção em canal/conversa geral/cerimônia e contato de squad que lê o repositório do próprio squad ficam como estão, sem campo de configuração novo nem migração. A próxima etapa (testes) escreve o plano de teste a partir da seção 6 do `2_PLAN.md` (11 casos, com os critérios 2 a 7, 9, 10 e 11 cobertos por testes e o 1 e o 8 apoiados na suíte … <!-- handoff:96 -->
