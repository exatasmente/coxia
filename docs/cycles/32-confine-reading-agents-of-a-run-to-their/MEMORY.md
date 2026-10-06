# Memória do ciclo

## Decisões

- Issue #32 é **bug** (squad Plataforma): no motor do Claude Agent SDK um agente que só lê numa
  execução não tinha a guarda de caminho do agente que escreve. Especificação em `1_SPEC.md`,
  solução em `2_PLAN.md`, implementação em `3_IMPLEMENTATION.md`, revisão em `4_REVIEW.md`.
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
  `test/gitlab-catalogs-unchanged.test.ts`.
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

## Tentado e descartado

## Perguntas abertas

- Nenhuma pergunta de escopo. Ponto de escopo já registrado: pasta de documentação por auto-detect
  **fora** da pasta de trabalho deixa de ser alcançável (seção 3.3 do plano).

## Onde o trabalho está

**Revisão da rodada 2: veredito aprovado.** Os dois bloqueios da rodada 1 foram conferidos e estão
corrigidos. A revisão não achou bloqueio novo.

Verificado nesta passada: `npx tsc --noEmit` limpo; os 10 arquivos de teste tocados, 148 testes
verdes; **a suíte completa 3678/3678 em 222 arquivos** (as três falhas de tempo limite da passada
anterior não reapareceram); `public-audit` 911 arquivos limpo depois de remover a pasta `out/` de
build (a primeira execução acusou dois falsos positivos ali); `i18n:lint` (4054 chaves) e
`theme-audit` verdes. Não verificado: `electron-vite build` nesta passada; modelo real, rede e host
não exercitados (só motores falsos e a consulta falsa do SDK); `nvm use` não é executável nesta
máquina (Node 26.5.1).

Observação não bloqueante registrada: o caso novo do SDK troca `read.roots` **depois** de
`readConfinement` montar os hooks, então a guarda exercitada não recebeu `docs` como raiz; o caminho
de permissão está coberto em `test/worktree-guard.test.ts` e `test/runner-agent-open.test.ts`.

O trabalho está pronto para seguir (publicação / pull request).
- Passagem revisor-plataforma → developer: Round 2. Both round-1 blockers are fixed and verified by execution: `confinedHooks` again hands `onDenied` to its read guard (`hooks.ts:78`), so a refused read by a writing agent posts the `runner.denied` line; the run-thread mention now uses the run's worktree as `cwd` when it exists (`answer.ts:137`), so the guard's root and the working folder are one folder. The SDK test gap is closed. Gates: `npx tsc --noEmit` clean; 148/148 in the touched files; full suite 3678/3678 in 222 files; `public-audit` 911 files clean (its first run hit a false positive in the git-ignored `out/` build folder); `i18n:lint` 4054 keys; `theme-audit` clean. Not verified: no real model/network/host; `electron-vite build` not run; `nvm use` not runnable. One non-blocking observation: the new SDK test mutates `read.roots` after the hooks were built, so it does not exercise the guard's allow-path for a documentation folder. Verdict: approved.
- Passagem support → product-owner: Refinamento do produto: confirmar as duas escolhas abertas antes de projetar a solução — (1) se as pastas de documentação listadas fora da pasta de trabalho ficam de fora ou entram por lista explícita, e (2) o alcance das menções e da cadeia de perguntas quando não há conversa de execução (canal, conversa geral) e o caso do contato de outro squad que lê o repositório do próprio squad. A triagem sugere lista explícita curta e derivada da configuração, e raiz igual à pasta de trabalho quando ela existir. Tipo: bug; não é duplicata; nenhuma pergunta a quem abriu. O trabalho começa em src/main/run… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejamento: projetar a solução a partir de `1_SPEC.md` (as 8 regras e os 11 critérios). A leitura confirma que a guarda de leitura já existe em `src/main/runner/hooks.ts` (`readGuard` sobre `Read`/`Grep`/`Glob`, com `checkPath(root, p, { read: true })` e cada recusa relatada via `onDenied`), que `checkPath` já julga leitura e libera a própria raiz, e que hoje o executor só monta `confine` para quem escreve (`executor.ts:430`). O plano deve introduzir um campo de raiz de leitura próprio (por exemplo `readRoot`), sem abrir `Edit`/`Write`/shell, e ligá-lo às chamadas de leitor (etapa de leitura… <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: O desenho está fechado: a resposta de escopo ("deixa como está") confirma que a raiz de leitura é a pasta de trabalho da execução nas três chamadas de leitor (etapa, menção numa conversa de execução, pergunta da cadeia com pasta de trabalho existente) e que menção em canal/conversa geral/cerimônia e contato de squad que lê o repositório do próprio squad ficam como estão, sem campo de configuração novo nem migração. A próxima etapa (testes) escreve o plano de teste a partir da seção 6 do `2_PLAN.md` (11 casos, com os critérios 2 a 7, 9, 10 e 11 cobertos por testes e o 1 e o 8 apoiados na suíte … <!-- handoff:96 -->
- Passagem developer → revisor-plataforma: A implementação está no worktree, na ordem de quatro commits do plano, com os gates do `CLAUDE.md` verdes (typecheck, suíte completa, theme-audit, i18n:lint, public-audit, electron-vite build). A etapa de testes deve escrever o `4_VERIFICATION.md` a partir daqui, sem reimplementar: o que já está coberto por teste é o guarda de leitura (absoluto fora, `..`, `~`, link, `.git`, segredo), a composição dos hooks, as raízes extras de documentação, a ausência de `Write`/`Edit`/`Bash` num leitor confinado, o relato da recusa na conversa e na atividade, e a ligação da raiz nas três chamadas de leitor. … <!-- handoff:149 -->
- Passagem revisor-plataforma → developer: The change gives a run's reading agents a path guard of their own (`read`/`readRoot`) over `Read`/`Grep`/`Glob`, composing it with the secret, broad-search and redaction hooks, wiring it in the stage, the question chain and the run-thread mention, and keeping `Edit`/`Write`/shell decided by `confine` alone. Reviewed against the spec, the plan and the boundary: two blocking defects were found. (1) `confinedHooks` now builds its read guard with `readGuardOf({ root: o.root })`, dropping `onDenied`, so a refused read by an agent that writes no longer posts the `runner.denied` line to the run's thr… <!-- handoff:188 -->
- Passagem developer → revisor-plataforma: A revisão deve conferir, sobre `3_IMPLEMENTATION.md`: (1) `src/main/runner/hooks.ts:78` repassa `onDenied` ao guarda de leitura de `confinedHooks`, e o caso novo em `test/worktree-guard.test.ts` prova que a recusa de leitura de um agente que escreve chega ao relato; (2) `src/main/mentions/answer.ts:137` alinha o `cwd` de uma menção de execução à pasta de trabalho, e o caso novo em `test/runner-lifecycle.test.ts` prova que `cwd` e `readRoot.root` são a mesma pasta; (3) `test/runner-agent.test.ts` exercita o caminho do SDK com um agente leitor confinado. Os gates rodados e o que não foi verifica… <!-- handoff:244 -->
