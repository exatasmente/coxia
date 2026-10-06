# Memória do ciclo

## Decisões

- Issue #32 é **bug** (squad Plataforma): no motor do Claude Agent SDK um agente que só lê numa
  execução não tinha a guarda de caminho do agente que escreve. Especificação em `1_SPEC.md`,
  solução em `2_PLAN.md`, implementação em `3_IMPLEMENTATION.md`, revisão em `4_REVIEW.md`, teste em
  `5_TEST_PLAN.md`.
- **Pergunta de escopo respondida pela pessoa: "deixa como está".** A raiz de leitura é a pasta de
  trabalho da execução onde ela existe (etapa de leitura, menção numa conversa de execução, pergunta
  da cadeia); menção num canal, numa conversa geral ou numa cerimônia, e o contato de squad que lê o
  repositório do próprio squad, continuam **sem** confinamento. Nenhum campo de configuração novo,
  nenhuma migração (`types/defaults/schema/migrations` intocados).
- **Implementação (4 commits):** `ReadConfinement` + `EngineRequest.read` e `AgentCall.readRoot`;
  `checkPath` aceita `roots` só para leitura; `extraReadRoots(cwd, role)`; `sdkOptions` escolhe os
  hooks por `confine ?? read` e soma `read.roots` aos diretórios adicionais; `readConfinedHooks`
  soma `noSecrets` + guarda em `Read|Grep|Glob`, `noBroadSearch`, `redactSecretResults`; ligação em
  `executor.ts` (`readConfinement(root, role, onDenied)`, `undefined` se a pasta não existe), na
  cadeia (`service.ts`) e na menção numa conversa de execução (`mentions/answer.ts` via
  `MentionDeps.readRoot`); recusa cita o alvo; `docs/runner.md` e `CHANGELOG.md`.
- `confine` continua significando "muda arquivos" em `toolsOf`, `wantsVcsTool`, `sdkOptions`,
  `shellEnv`, `writeRoot`. `Edit`/`Write`/shell decididos só por `confine`.
- Lista de pastas de documentação permitidas derivada da configuração, sem as achadas por
  auto-detect e sem descendentes do `cwd`; pasta de documentação achada por auto-detect **fora** da
  pasta de trabalho deixa de ser alcançável (efeito conhecido, sem passo de migração).
- A chave `main.engine.text.read.outside` mudou de texto e entrou no `INTENDED` de
  `test/gitlab-catalogs-unchanged.test.ts`. A conversa da execução e a menção num canal continuam
  usando a mensagem genérica do motor aberto; só a recusa do guarda nomeia o alvo.
- **Correções pós-revisão (rodada 1):** (1) `confinedHooks` voltou a repassar `onDenied` ao guarda de
  leitura; (2) a menção numa conversa de execução cujo agente não roda comandos passou a usar a pasta
  de trabalho como `cwd` **e** raiz do guarda; (3) teste novo no caminho do SDK com agente leitor.
- Resposta: deixa como está <!-- answer:86 -->

## Restrições

- Bug de confinamento: **não afrouxar** o filtro de segredo, a censura de resultado de busca nem a
  recusa de busca ampla. A mudança só restringe.
- Nada podia mudar para o agente que escreve; as cerimônias leem a pasta de projetos de propósito.
  Em particular, a recusa de leitura de quem escreve continua indo para a conversa (`runner.denied`).
- Toda recusa vai para a conversa da execução (`runner.denied`) e para a atividade como bloqueada.
- O `cwd` de uma chamada de leitor de uma execução tem de ser a mesma pasta da raiz do guarda.
- Nenhum teste pode tocar modelo, host ou rede: só os motores falsos de `test/helpers/`.
- Um "passou" da QA precisa citar um comando que rodou de verdade; o comportamento do SDK real não é
  verificável aqui.

## Tentado e descartado

- Nada descartado nesta etapa. Não se tentou exercitar o Claude Agent SDK real: um modelo de verdade
  e a rede estão fora do alcance do ambiente, e a suíte inteira proíbe tocar neles.

## Perguntas abertas

- Nenhuma. Ponto de escopo já registrado: pasta de documentação por auto-detect **fora** da pasta de
  trabalho deixa de ser alcançável (seção 3.3 do plano).

## Onde o trabalho está

**QA concluída, sem bloqueio.** Os onze critérios de aceite estão exercitados por teste e os portões
do projeto estão verdes nesta rodada, na árvore com a mudança: `npx tsc --noEmit` limpo; os dez
arquivos de teste tocados, 148 testes; **a suíte completa 3678/3678 em 222 arquivos**;
`theme-audit` verde (as mesmas 8 cores literais de `api.ts`); `i18n:lint` verde (4054 chaves);
`public-audit` verde (911 arquivos, 912 com o `5_TEST_PLAN.md`); `electron-vite build` construiu.
Casos específicos rodados sozinhos, todos verdes (o do SDK com agente leitor, o da menção na
conversa de execução, o da recusa registrada na conversa, `runner-chain` 10/10,
`runner-squads-requests` 10/10, `runner-agent-open` 8/8). As três falhas de tempo limite que a etapa
de desenvolvimento viu na suíte completa não reapareceram.

Não verificado: o **Claude Agent SDK real com um modelo** (a consulta do SDK é trocada por uma
falsa; observou-se o conjunto de opções, os hooks, as ferramentas negadas e a recusa chegando ao
relato, não o SDK em execução); rede e host de código não exercitados; `nvm use` não é executável
nesta máquina (`nvm` não instalado; Node 26.5.1, o do `.nvmrc`); o motor aberto só contra o provedor
local falso.

Observação não bloqueante registrada: o caso novo do SDK troca `read.roots` **depois** de
`readConfinement` montar os hooks, então a guarda estudada por ele não recebeu `docs` como raiz; o
caminho de permissão está coberto por `test/worktree-guard.test.ts` e `test/runner-agent-open.test.ts`.

O trabalho está pronto para seguir (publicação / pull request).
- Passagem support → product-owner: Refinamento do produto: confirmar as duas escolhas abertas antes de projetar a solução — (1) se as pastas de documentação listadas fora da pasta de trabalho ficam de fora ou entram por lista explícita, e (2) o alcance das menções e da cadeia de perguntas quando não há conversa de execução (canal, conversa geral) e o caso do contato de outro squad que lê o repositório do próprio squad. A triagem sugere lista explícita curta e derivada da configuração, e raiz igual à pasta de trabalho quando ela existir. Tipo: bug; não é duplicata; nenhuma pergunta a quem abriu. O trabalho começa em src/main/run… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejamento: projetar a solução a partir de `1_SPEC.md` (as 8 regras e os 11 critérios). A leitura confirma que a guarda de leitura já existe em `src/main/runner/hooks.ts` (`readGuard` sobre `Read`/`Grep`/`Glob`, com `checkPath(root, p, { read: true })` e cada recusa relatada via `onDenied`), que `checkPath` já julga leitura e libera a própria raiz, e que hoje o executor só monta `confine` para quem escreve (`executor.ts:430`). O plano deve introduzir um campo de raiz de leitura próprio (por exemplo `readRoot`), sem abrir `Edit`/`Write`/shell, e ligá-lo às chamadas de leitor (etapa de leitura… <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: O desenho está fechado: a resposta de escopo ("deixa como está") confirma que a raiz de leitura é a pasta de trabalho da execução nas três chamadas de leitor (etapa, menção numa conversa de execução, pergunta da cadeia com pasta de trabalho existente) e que menção em canal/conversa geral/cerimônia e contato de squad que lê o repositório do próprio squad ficam como estão, sem campo de configuração novo nem migração. A próxima etapa (testes) escreve o plano de teste a partir da seção 6 do `2_PLAN.md` (11 casos, com os critérios 2 a 7, 9, 10 e 11 cobertos por testes e o 1 e o 8 apoiados na suíte … <!-- handoff:96 -->
- Passagem developer → revisor-plataforma: A implementação está no worktree, na ordem de quatro commits do plano, com os gates do `CLAUDE.md` verdes (typecheck, suíte completa, theme-audit, i18n:lint, public-audit, electron-vite build). A etapa de testes deve escrever o `4_VERIFICATION.md` a partir daqui, sem reimplementar: o que já está coberto por teste é o guarda de leitura (absoluto fora, `..`, `~`, link, `.git`, segredo), a composição dos hooks, as raízes extras de documentação, a ausência de `Write`/`Edit`/`Bash` num leitor confinado, o relato da recusa na conversa e na atividade, e a ligação da raiz nas três chamadas de leitor. … <!-- handoff:149 -->
- Passagem revisor-plataforma → developer: The change gives a run's reading agents a path guard of their own (`read`/`readRoot`) over `Read`/`Grep`/`Glob`, composing it with the secret, broad-search and redaction hooks, wiring it in the stage, the question chain and the run-thread mention, and keeping `Edit`/`Write`/shell decided by `confine` alone. Reviewed against the spec, the plan and the boundary: two blocking defects were found. (1) `confinedHooks` now builds its read guard with `readGuardOf({ root: o.root })`, dropping `onDenied`, so a refused read by an agent that writes no longer posts the `runner.denied` line to the run's thr… <!-- handoff:188 -->
- Passagem developer → revisor-plataforma: A revisão deve conferir, sobre `3_IMPLEMENTATION.md`: (1) `src/main/runner/hooks.ts:78` repassa `onDenied` ao guarda de leitura de `confinedHooks`, e o caso novo em `test/worktree-guard.test.ts` prova que a recusa de leitura de um agente que escreve chega ao relato; (2) `src/main/mentions/answer.ts:137` alinha o `cwd` de uma menção de execução à pasta de trabalho, e o caso novo em `test/runner-lifecycle.test.ts` prova que `cwd` e `readRoot.root` são a mesma pasta; (3) `test/runner-agent.test.ts` exercita o caminho do SDK com um agente leitor confinado. Os gates rodados e o que não foi verifica… <!-- handoff:244 -->
- Passagem revisor-plataforma → qa-plataforma-2: Review round 2 over `3_IMPLEMENTATION.md`: both round-1 blockers are fixed and verified by execution. (1) `src/main/runner/hooks.ts:78` again hands `onDenied` to the read guard (`readGuardOf({ root: o.root, onDenied: o.onDenied })`), so a refused read by an agent that writes posts the `runner.denied` line to the run's thread; the new case in `test/worktree-guard.test.ts` asserts the denial reaches the same callback. (2) `src/main/mentions/answer.ts:137` now sets the mention's `cwd` to the run's worktree when it exists, so the guard's root and the engine's working folder are the same folder; th… <!-- handoff:263 -->
- Passagem qa-plataforma-2 → publicação: A QA rodou os portões na árvore com a mudança e exercitou os onze critérios por teste: typecheck limpo; 148/148 nos dez arquivos tocados; suíte completa 3678/3678 em 222 arquivos; theme-audit, i18n:lint (4054 chaves), public-audit (911 arquivos, 912 com o `5_TEST_PLAN.md`) e `electron-vite build` verdes; casos avulsos verdes (SDK com agente leitor, menção na conversa de execução, recusa registrada, `runner-chain` 10/10, `runner-squads-requests` 10/10, `runner-agent-open` 8/8). Veredito: sem bloqueio. Não verificado: o SDK real com um modelo (a consulta é falsa), rede, host de código e o gate `nvm use`; pasta de documentação por auto-detect fora da pasta de trabalho deixa de ser alcançável. Pronto para publicação / pull request. <!-- handoff:302 -->
