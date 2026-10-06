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
- **Correções pós-revisão (esta passada):** (1) `confinedHooks` voltou a repassar `onDenied` ao
  guarda de leitura, senão a recusa de leitura de quem **escreve** sumia da conversa da execução;
  (2) a menção numa conversa de execução cujo agente não roda comandos passa a usar a pasta de
  trabalho como `cwd` **e** como raiz do guarda, senão um caminho relativo era aprovado contra uma
  pasta e lido de outra; (3) teste novo no caminho do SDK com agente leitor.
- Resposta: deixa como está <!-- answer:86 -->

## Restrições

- Bug de confinamento: **não afrouxar** o filtro de segredo, a censura de resultado de busca nem a
  recusa de busca ampla. A mudança só restringe.
- Nada podia mudar para o agente que escreve; as cerimônias leem a pasta de projetos de propósito.
  Em particular, a recusa de leitura de quem escreve continua indo para a conversa (`runner.denied`).
- Toda recusa vai para a conversa da execução (`runner.denied`) e para a atividade como bloqueada.
- O `cwd` de uma chamada de leitor de uma execução tem de ser a mesma pasta da raiz do guarda: um
  caminho relativo é julgado contra a raiz e resolvido contra o `cwd`.
- Nenhum teste pode tocar modelo, host ou rede: só os motores falsos de `test/helpers/`.

## Tentado e descartado

## Perguntas abertas

- Nenhuma pergunta de escopo. Ponto de escopo já registrado: pasta de documentação por auto-detect
  **fora** da pasta de trabalho deixa de ser alcançável (seção 3.3 do plano).

## Onde o trabalho está

Os dois bloqueios da revisão foram corrigidos e a lacuna de teste do motor do SDK foi fechada; a
próxima etapa é a revisão/verificação de novo, sobre `3_IMPLEMENTATION.md`, que lista cada correção.

Verificado nesta passada: `npx tsc --noEmit` limpo; guarda/menções/agente/catálogos verdes;
`test/runner-agent.test.ts`, `test/worktree-guard.test.ts` e `test/runner-lifecycle.test.ts` verdes
com os casos novos; `theme-audit`, `i18n:lint` (4054 chaves) e `public-audit` (911 arquivos) verdes;
`electron-vite build` construiu. A suíte completa (3675 passam, 3 falham) falhou só em arquivos fora
da mudança (`conflict-resolve`, `update-script`), testes de espera por relógio que passam sozinhos.
Modelo real, rede e host não exercitados (só motores falsos e a consulta falsa do SDK); o `nvm use`
não é executável nesta máquina (Node 26.5.1).
- Passagem revisor-plataforma → developer: The change gives a run's reading agents a path guard of their own (`read`/`readRoot`) over `Read`/`Grep`/`Glob`, composing it with the secret, broad-search and redaction hooks, wiring it in the stage, the question chain and the run-thread mention, and keeping `Edit`/`Write`/shell decided by `confine` alone. Reviewed against the spec, the plan and the boundary: two blocking defects were found. (1) `confinedHooks` now builds its read guard with `readGuardOf({ root: o.root })`, dropping `onDenied`, so a refused read by an agent that writes no longer posts the `runner.denied` line to the run's thr… <!-- handoff:188 -->
- Passagem support → product-owner: Refinamento do produto: confirmar as duas escolhas abertas antes de projetar a solução — (1) se as pastas de documentação listadas fora da pasta de trabalho ficam de fora ou entram por lista explícita, e (2) o alcance das menções e da cadeia de perguntas quando não há conversa de execução (canal, conversa geral) e o caso do contato de outro squad que lê o repositório do próprio squad. A triagem sugere lista explícita curta e derivada da configuração, e raiz igual à pasta de trabalho quando ela existir. Tipo: bug; não é duplicata; nenhuma pergunta a quem abriu. O trabalho começa em src/main/run… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejamento: projetar a solução a partir de `1_SPEC.md` (as 8 regras e os 11 critérios). A leitura confirma que a guarda de leitura já existe em `src/main/runner/hooks.ts` (`readGuard` sobre `Read`/`Grep`/`Glob`, com `checkPath(root, p, { read: true })` e cada recusa relatada via `onDenied`), que `checkPath` já julga leitura e libera a própria raiz, e que hoje o executor só monta `confine` para quem escreve (`executor.ts:430`). O plano deve introduzir um campo de raiz de leitura próprio (por exemplo `readRoot`), sem abrir `Edit`/`Write`/shell, e ligá-lo às chamadas de leitor (etapa de leitura… <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: O desenho está fechado: a resposta de escopo ("deixa como está") confirma que a raiz de leitura é a pasta de trabalho da execução nas três chamadas de leitor (etapa, menção numa conversa de execução, pergunta da cadeia com pasta de trabalho existente) e que menção em canal/conversa geral/cerimônia e contato de squad que lê o repositório do próprio squad ficam como estão, sem campo de configuração novo nem migração. A próxima etapa (testes) escreve o plano de teste a partir da seção 6 do `2_PLAN.md` (11 casos, com os critérios 2 a 7, 9, 10 e 11 cobertos por testes e o 1 e o 8 apoiados na suíte … <!-- handoff:96 -->
- Passagem developer → revisor-plataforma: A implementação está no worktree, na ordem de quatro commits do plano, com os gates do `CLAUDE.md` verdes (typecheck, suíte completa, theme-audit, i18n:lint, public-audit, electron-vite build). A etapa de testes deve escrever o `4_VERIFICATION.md` a partir daqui, sem reimplementar: o que já está coberto por teste é o guarda de leitura (absoluto fora, `..`, `~`, link, `.git`, segredo), a composição dos hooks, as raízes extras de documentação, a ausência de `Write`/`Edit`/`Bash` num leitor confinado, o relato da recusa na conversa e na atividade, e a ligação da raiz nas três chamadas de leitor. … <!-- handoff:149 -->
