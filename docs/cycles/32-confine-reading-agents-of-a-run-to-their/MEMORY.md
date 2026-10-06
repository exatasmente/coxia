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
  `executor.ts` (`!writes`), na cadeia (`service.ts`) e na menção numa conversa de execução
  (`mentions/answer.ts` via `MentionDeps.readRoot`); recusa cita o alvo; `docs/runner.md` e
  `CHANGELOG.md`.
- `confine` continua significando "muda arquivos" em `toolsOf`, `wantsVcsTool`, `sdkOptions`,
  `shellEnv`, `writeRoot`. `Edit`/`Write`/shell decididos só por `confine`.
- Lista de pastas de documentação permitidas derivada da configuração, sem as achadas por
  auto-detect e sem descendentes do `cwd`; pasta de documentação achada por auto-detect **fora** da
  pasta de trabalho deixa de ser alcançável (efeito conhecido, sem passo de migração).
- A chave `main.engine.text.read.outside` mudou de texto e entrou no `INTENDED` de
  `test/gitlab-catalogs-unchanged.test.ts`.
- Resposta: deixa como está <!-- answer:86 -->

## Restrições

- Bug de confinamento: **não afrouxar** o filtro de segredo, a censura de resultado de busca nem a
  recusa de busca ampla. A mudança só restringe.
- Nada podia mudar para o agente que escreve; as cerimônias leem a pasta de projetos de propósito.
- Toda recusa vai para a conversa da execução (`runner.denied`) e para a atividade como bloqueada.
- Nenhum teste pode tocar modelo, host ou rede: só os motores falsos de `test/helpers/`.

## Tentado e descartado

## Perguntas abertas

- Nenhuma pergunta de escopo. Ponto de escopo já registrado: pasta de documentação por auto-detect
  **fora** da pasta de trabalho deixa de ser alcançável (seção 3.3 do plano).

## Onde o trabalho está

Revisão concluída com **verdict `changes`**: dois bloqueios acima, mais a lacuna de teste (não há
teste do motor do Claude Agent SDK de verdade com um agente leitor — só motores falsos e motor
aberto). A próxima etapa corrige os dois pontos e, se possível, acrescenta o caso no motor do SDK.

Verificado nesta etapa: `npx tsc --noEmit` limpo; testes da guarda/agente leitor/menções/catálogos
verdes; `theme-audit`, `i18n:lint` (4054 chaves) e `public-audit` (910 arquivos) verdes. A suíte
completa terminou com 32 falhas em 9 arquivos, **todas estouro de tempo limite** sob carga alta do
computador; nenhuma nos arquivos da mudança, e a falha de `runner-chain` também ocorre na árvore sem
a mudança. Modelo real, rede e host não foram exercitados; o `nvm use` não é executável nesta
máquina (Node 26.5.1).
- Passagem support → product-owner: Refinamento do produto: confirmar as duas escolhas abertas antes de projetar a solução — (1) se as pastas de documentação listadas fora da pasta de trabalho ficam de fora ou entram por lista explícita, e (2) o alcance das menções e da cadeia de perguntas quando não há conversa de execução (canal, conversa geral) e o caso do contato de outro squad que lê o repositório do próprio squad. A triagem sugere lista explícita curta e derivada da configuração, e raiz igual à pasta de trabalho quando ela existir. Tipo: bug; não é duplicata; nenhuma pergunta a quem abriu. O trabalho começa em src/main/run… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Planejamento: projetar a solução a partir de `1_SPEC.md` (as 8 regras e os 11 critérios). A leitura confirma que a guarda de leitura já existe em `src/main/runner/hooks.ts` (`readGuard` sobre `Read`/`Grep`/`Glob`, com `checkPath(root, p, { read: true })` e cada recusa relatada via `onDenied`), que `checkPath` já julga leitura e libera a própria raiz, e que hoje o executor só monta `confine` para quem escreve (`executor.ts:430`). O plano deve introduzir um campo de raiz de leitura próprio (por exemplo `readRoot`), sem abrir `Edit`/`Write`/shell, e ligá-lo às chamadas de leitor (etapa de leitura… <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: O desenho está fechado: a resposta de escopo ("deixa como está") confirma que a raiz de leitura é a pasta de trabalho da execução nas três chamadas de leitor (etapa, menção numa conversa de execução, pergunta da cadeia com pasta de trabalho existente) e que menção em canal/conversa geral/cerimônia e contato de squad que lê o repositório do próprio squad ficam como estão, sem campo de configuração novo nem migração. A próxima etapa (testes) escreve o plano de teste a partir da seção 6 do `2_PLAN.md` (11 casos, com os critérios 2 a 7, 9, 10 e 11 cobertos por testes e o 1 e o 8 apoiados na suíte … <!-- handoff:96 -->
- Passagem developer → revisor-plataforma: A implementação está no worktree, na ordem de quatro commits do plano, com os gates do `CLAUDE.md` verdes (typecheck, suíte completa, theme-audit, i18n:lint, public-audit, electron-vite build). A etapa de testes deve escrever o `4_VERIFICATION.md` a partir daqui, sem reimplementar: o que já está coberto por teste é o guarda de leitura (absoluto fora, `..`, `~`, link, `.git`, segredo), a composição dos hooks, as raízes extras de documentação, a ausência de `Write`/`Edit`/`Bash` num leitor confinado, o relato da recusa na conversa e na atividade, e a ligação da raiz nas três chamadas de leitor. … <!-- handoff:149 -->
