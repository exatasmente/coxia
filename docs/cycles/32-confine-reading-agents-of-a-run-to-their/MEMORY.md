# Memória do ciclo

## Decisões

- Issue #32 é **bug** (squad Plataforma): no motor do Claude Agent SDK um agente que só lê numa
  execução não tem a guarda de caminho que o agente que escreve tem. Especificação de produto em
  `1_SPEC.md`; solução projetada em `2_PLAN.md`. Nenhuma duplicata; prioridade `priority:high`; sem
  marco.
- **Pergunta de escopo respondida pela pessoa: "deixa como está" (resposta `answer:86`).** O desenho
  fica como proposto: a raiz de leitura é a pasta de trabalho da execução onde existe (etapa de
  leitura, menção numa conversa de execução, pergunta da cadeia com pasta de trabalho existente), e
  menção num canal, numa conversa geral ou numa cerimônia, e o contato de squad que lê o repositório
  do próprio squad, continuam **sem** confinamento de leitura. Nenhum campo de configuração novo,
  nenhuma migração, `types.ts`/`defaults.ts`/`schema.ts`/`migrations.ts` intocados.
- O plano fixa o desenho: campo próprio `readRoot` no `AgentCall` e `read` no `EngineRequest`, ao
  lado do `confine` (que continua significando "muda arquivos" em toda decisão que já o consulta:
  `toolsOf`, `wantsVcsTool`, `sdkOptions`, `shellEnv`, `writeRoot`).
- Os hooks do leitor **somam**: `noSecrets` + guarda de leitura em `Read|Grep|Glob`, `noBroadSearch`
  em `Grep|Glob` e `redactSecretResults` no `PostToolUse`. Nada é substituído (regressão a evitar).
- A lista de pastas de documentação permitidas é **derivada da configuração** e igual à que o leitor
  já recebe hoje como diretórios adicionais (`extraDirs`, `agents.ts:379-383`): as listas de
  `config.docs`, menos o que o auto-detect achou dentro da pasta de trabalho e menos descendentes do
  `cwd`. Vira a mesma lista de raízes extras da guarda (`extraReadRoots`), num lugar só. Nenhum campo
  de configuração novo, nenhuma migração. Efeito colateral registrado: pasta de documentação achada
  por auto-detect **fora** da pasta de trabalho deixa de ser alcançável.
- A recusa que volta do motor aberto, no caso de caminho fora, é hoje a mensagem genérica
  (`read.ts:34`); o commit 3 a ajusta para citar o caminho, sem chave nova de catálogo.
- Quatro commits: (1) campo e hooks, inertes; (2) ligar a guarda nos leitores de execução; (3)
  redação da recusa; (4) docs e changelog.

## Restrições

- Bug de confinamento: **não afrouxar** o filtro de arquivo de segredo, a censura de resultado de
  busca nem a recusa de busca ampla. O plano só restringe.
- `confine` também abre `Edit`/`Write` e o shell; ligar a leitura nele exporia o leitor. Por isso o
  campo é próprio e `toolsOf`/`disallowedTools` continuam decidindo por `confine`.
- As cerimônias (daily, unblock, retro) leem a pasta de projetos de propósito e ficam fora.
- Toda recusa vai para a conversa da execução (`runner.denied`) e para a atividade ao vivo como
  bloqueada (`reportBlocked`), pela fiação que já existe (`executor.ts:416-422`, `agents.ts:315-325`).
- Fontes conferidas por leitura: `engine/guard.ts:76-98` (`checkPath`, `read: true` na 89);
  `runner/hooks.ts:55-67` (`readGuard`) e `:41-91`; `executor.ts:430`; `agents.ts:379-383`,
  `:388-416`, `:1000-1004`, `:1037-1066`, `:1055`; `mentions/call.ts`, `mentions/answer.ts:125-146`
  e `:181`, `mentions/module.ts`, `mentions/ceremony.ts:57-70`; `runner/service.ts:1104`, `:1113`,
  `:1156-1159`, `:1180`; `engine/open/loop.ts:264-277`, `open/policy.ts:44-50`,
  `open/tools/read.ts:17-37`, `open/tools/search.ts:99`, `:280`; `config-resolve.ts:204-237`.
- Estado de partida verificado nesta etapa: `npx tsc --noEmit` sem erro e `npx vitest run` com 3664
  testes em 222 arquivos, todos verdes, na árvore sem as mudanças. `theme-audit`/`i18n:lint`/
  `public-audit`/`electron-vite build` **não** foram rodados. O Node do computador é 26.5.1 e o `nvm`
  não está instalado aqui.

## Tentado e descartado

- Ligar a leitura no campo `confine` existente: descartado, abriria `Edit`/`Write` e o shell.
- Escolher as pastas permitidas por auto-detect (lista derivada das raízes de projetos do espaço de
  trabalho): descartado nesta árvore porque o `cwd` da menção de cerimônia é `config.projects.roots[0] ?? ''`
  (`ceremony.ts:63`, `rc().projectsRoot`) e como raiz de leitura essa pasta coincide com a raiz do
  próprio agente, o que tornaria a restrição vazia; e porque não é uma lista explícita.
- Esperar que todos os paths que o modelo pede estejam "dentro de `cwd`" no SDK: a árvore mostra que
  a negação de leitura fora das pastas de trabalho é um interruptor do processo
  (`blockReadsOutsideWorkingDirectories`, em `node_modules/.../sdk.mjs`), sem alvo nem código de
  recusa, e não é o que a issue pediu. Descartado como mecanismo; a guarda do projeto é a que relata.
- Fechar também os caminhos fora de uma execução (canal, conversa geral, cerimônia, contato de squad):
  descartado **pela pessoa**, que respondeu "deixa como está". Fechá-los exigiria campo de
  configuração novo com passo em `STEPS` e os três arquivos de tipos/defaults/schema, mais migração
  de dados.
- Nada foi tentado em código. As duas escolhas do handoff de support ficaram resolvidas: a das pastas
  de documentação por derivação da configuração (sem campo novo); a do alcance fora de uma execução
  pela resposta da pessoa.

## Perguntas abertas

- Nenhuma pergunta de escopo. Ponto observado, **não** é pergunta a quem abriu: com a lista derivada
  da configuração, uma pasta de documentação achada por auto-detect fora da pasta de trabalho deixa
  de ser alcançável pelo leitor; não consta desta árvore nenhum passo de migração que a cadastre em
  `config.docs`. Se a pessoa quiser preservá-la, a lista explícita de configuração passa a ser
  necessária — registrado na seção 3.3 do plano, não vira questão agora.

## Onde o trabalho está

Planejamento concluído e escopo fechado. `2_PLAN.md` traz o que foi lido com arquivo:linha, as
decisões de desenho (campo próprio, hooks somados, lista derivada da configuração, onde o
confinamento é ligado), os quatro commits, os contratos de `contract.ts`/`hooks.ts`/`agents.ts`/
`executor.ts`/serviço, 11 casos de teste, riscos, gates e o que não foi verificado; a seção 10
registra a resposta da pessoa. A suíte e o typecheck passam na árvore sem as mudanças. A próxima
etapa (testes) escreve o plano de teste a partir daqui; a implementação segue os commits 1 a 4.
- Passagem product-owner → pessoa: Planejamento: projetar a solução a partir de `1_SPEC.md` (as 8 <!-- handoff:11 -->
  regras e os 11 critérios). A leitura confirma que a guarda de leitura já existe em
  `src/main/runner/hooks.ts` (`readGuard` sobre `Read`/`Grep`/`Glob`, com `checkPath(root, p, { read: true })`
  e cada recusa relatada via `onDenied`), que `checkPath` já julga leitura e libera a própria raiz, e
  que hoje o executor só monta `confine` para quem escreve (`executor.ts:430`). O plano introduz um
  campo de raiz de leitura próprio (`readRoot`), sem abrir `Edit`/`Write`/shell, e o liga às chamadas
  de leitor (etapa de leitura, menção numa conversa de execução, pergunta da cadeia). Não afrouxar o
  filtro de segredo, a censura de resultado de busca nem a recusa de busca ampla.
- Passagem (esta etapa) → próxima: com a resposta de escopo dada ("deixa como está"), implementar pelo
  `2_PLAN.md`, commits 1 a 4, e fechar os gates do `CLAUDE.md`.
- Passagem support → product-owner: Refinamento do produto: confirmar as duas escolhas abertas antes de projetar a solução — (1) se as pastas de documentação listadas fora da pasta de trabalho ficam de fora ou entram por lista explícita, e (2) o alcance das menções e da cadeia de perguntas quando não há conversa de execução (canal, conversa geral) e o caso do contato de outro squad que lê o repositório do próprio squad. A triagem sugere lista explícita curta e derivada da configuração, e raiz igual à pasta de trabalho quando ela existir. Tipo: bug; não é duplicata; nenhuma pergunta a quem abriu. O trabalho começa em src/main/run… <!-- handoff:6 -->
