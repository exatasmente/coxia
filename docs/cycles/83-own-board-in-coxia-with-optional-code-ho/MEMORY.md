# Memória do ciclo

## Decisões

- Dois blocos na issue 83: o quadro próprio do Coxia (funciona sem host) e o passo desse quadro com o host quando há integração. Esta mudança entrega **só o primeiro bloco**; o segundo é entrega própria.
- Quem abriu decidiu: o **host é canônico** e o quadro do Coxia é o **espelho local**; o espelho lê o host **junto com o app** (sob demanda), sem intervalo próprio.
- **«Abrir um cartão» é salvar sem sair da máquina**, não um segundo quadro ao lado do host. Aqui não há mudança nenhuma num espaço com host.
- O refino fixou que o quadro **só existe onde não há integração utilizável** (`vcsReady()` falso): com host utilizável, nada muda (regra 6 da spec).
- O plano fechou o **como**, e a implementação o seguiu: cartão em `board.json` na pasta de dados (escrita atômica), id curto de 8 caracteres nunca só dígitos (nunca colide com a referência do host), referência `<id do repo>#<id>`, coluna = id de etapa de `devCycle.stages`, `repo` = id de `projects.repos`, `squad`/`priority`/`labels`, hora de criação/atualização, histórico de linhas. Sem configuração nova e sem migração. Os cartões entram no dia por `loadCards` (filtro de ref duplicada, `project` = id do repositório, `sortCards`/`total`/`rest` inalterados). Squad do cartão pelo rótulo (`squadLabel`), como o precedente `docs/<squadId>`. Comandos `board:list/create/update/comment/close/reopen` em `src/main/board.ts`, abertos ao navegador pareado.
- Prioridade proposta: **`priority:low`**; marco proposto: **nenhum**.
- Resposta de quem abriu sobre o ritmo da leitura: **junto com o app**.
- Resposta: > **Aguardando resposta** > > ### A pergunta > Hoje o Coxia lê o quadro do host quando o dia é carregado e guarda uma fotografia do dia anterior para dizer o que mudou. Com o quadro próprio espelhando o host, em que momento essa leitura do host deve acontecer — junto com o resto do app (como hoje), a cada intervalo, quando o quadro for aberto, ou só quando a pessoa pedir — e o que o quadro deve dizer enquanto o espelho estiver atrasado? junto com o app <!-- answer:12 -->

## Restrições

- A fonte de cartões de hoje é somente leitura; sem integração utilizável (`vcsReady()` falso) a fonte interna devolve nada e o dia fica vazio, não é erro (`EMPTY`). `loadCards` devolve `cards` + `total` + `rest`.
- O recorte por squad casa o cartão por rótulo antes do projeto; sem host o caminho por projeto não serve, então o `project` de um cartão do quadro é o **id do repositório** e o vínculo é o rótulo do squad.
- Toda escrita que sai da máquina passa pela porta única; `assertExternalWrite` fecha em espaço de teste e falha fechado. `test/board-policy.test.ts` prende que `src/main/board.ts` não propõe nem executa escrita de host e que cada handler que muda passa a guarda; `test/runs-policy.test.ts` continua prendendo o mesmo para a pasta do runner.
- **`src/main/board.ts` não pode alcançar `vcs/`.** O `boardAvailable` recebe o getter pronto: `index.ts` chama `setBoardReady(() => vcsReady())` no start e passa `deps: (d) => setBoardReady(d.boardReady)` no laço dos módulos. Um getter devolvido ao próprio módulo (`() => d.boardReady()`) faz `boardAvailable()` entrar em recursão e o app responde `RangeError: Maximum call stack size exceeded` em todos os canais do quadro — foi o defeito que só o app rodando mostrou.
- `cycle:view` devolve só alguns campos (não é o config cru); o config cru está em `config:get().config`. `workspace:test` toma `(id, flag)`. O endereço do PWA é `127.0.0.1:<porta do web.json>` com `basePath`; `web.json` fica na raiz de dados e `enabled: true` liga o servidor.
- O projeto é público: nomes de arquivo, fixtures e textos não podem carregar empresa, pessoa, host real, número real nem segredo. Fixtures novas usam `example.test`.

## Tentado e descartado

- **Perguntar ao dono se a entrega é um marco ou um épico.** O comentário dele já divide a issue em «quadro local» e «sincronização com o host»; virou recorte proposto.
- **Marcar os critérios 6 e 7 como verificados.** Não são: nenhum espaço com host utilizável foi aberto.
- **O histórico do quadro num arquivo append-only separado**: descartado nesta entrega porque nada aqui lê esse histórico; o segundo bloco pode acrescentá-lo sem mudar o cartão.
- **Dirigir a tela pelo servidor de desenvolvimento do Vite.** O servidor de dev serve o renderer, mas não tem o servidor do RPC: as chamadas `/api/rpc/*` voltam 404 e a tela do quadro fica em branco. O caminho que funciona é `electron-vite build` e o app construído, com uma pasta de dados vazia e um `web.json` apontando para uma porta livre.

## Perguntas abertas

- Do review: manter a guarda de escrita de teste em todas as seis escritas do quadro (leitura literal da spec 5) ou só em abrir e fechar, reescrevendo o critério 5? Vale a guarda de sempre; o risco é `isTestWorkspace()` falhar fechado num espaço real de registro reconstruído.
- Do segundo bloco (fora do escopo desta mudança): o passo com o host, a leitura de fundo `statusEveryMin`, o rótulo de bloqueado guardado dia a dia, o histórico dos vigias/dia e retro sem host, a nota do dia gravada no cartão, e o quadro com host mostrado dos dois lados.

## Onde o trabalho está

- Implementado e conferido na worktree: `src/shared/board.ts`, `src/main/board-core.ts`, `src/main/boardSource.ts`, `src/main/board.ts`, a fusão em `src/main/cards.ts`, o registro e a política em `src/main/{modules,webPolicy,module,index}.ts`, a tela em `src/renderer/src/screens/cycle/{BoardScreen.tsx,boardApi.ts}` com o resto do renderer, as chaves nos dois catálogos e as correções de documento (`docs/cycles.md`, `docs/runner.md`, `.coxia/rules/runner.md`, `CHANGELOG.md`).
- Passagem implementação → QA: o quadro próprio funciona sem host (abrir, mover, comentar, priorizar, dar a um squad, fechar, reabrir; o cartão entra no dia e a contagem cresce; espaço de teste recusa as cinco escritas). **Os critérios 6 e 7 ficam não verificados**: nenhum espaço com host utilizável foi aberto. Um espaço com host **sem** token mantém o quadro (o que foi visto).
- Passagem support → product-owner: Ir ao refino do produto com duas decisões já fechadas (o host é canônico e o quadro do Coxia é o espelho local; a leitura do host continua no ritmo do app, hoje sob demanda) e com o que ficou em aberto para lá: (1) o que o quadro mostra entre uma leitura e outra, dado que o intervalo de conferência de fundo (`statusEveryMin`) hoje só roda com um comando externo de cartões e, num quadro espelhado, ou passa a puxar a fonte interna ou deixa de existir o rótulo de bloqueado guardado dia a dia; (2) como o quadro funciona sem host — onde um cartão vive, como é identificado e como chega ao recorte po… <!-- handoff:14 -->
- Passagem product-owner → pessoa: O plano (tech-lead) decide **como**, sem reabrir o comportamento: onde vive um cartão aberto no quadro e o que ele carrega (identidade que não colide com a referência do host, coluna, lugar a que pertence, hora para ordenar e um histórico que se leia), como o quadro acha e serve esses cartões ao lado do relatório do dia (os cartões do dia vêm do relatório; um cartão do quadro precisa entrar nele sem que o host exista), o comando pelo qual um cartão é aberto/movido/fechado/dado a um squad e a classificação dele na política do navegador pareado, como o host mapeia a coluna (primeiro ponto a fech… <!-- handoff:21 -->
- Passagem tl-plataforma → pessoa: Implementar o plano na ordem do próprio documento, sem reabrir o comportamento fechado na spec: (1) o arquivo `board.json` e o módulo `src/main/board.ts` com os canais `board:*` da tabela e a guarda de escrita externa; (2) a fusão em `loadCards` com o filtro de ref duplicada e o `project` pelo id do repositório, e não o `projectPath` (nulo sem host); (3) registrar o módulo em `src/main/modules.ts` e classificar os seis canais em `src/main/webPolicy.ts`; (4) a tela e as chaves `ui.board.*` nos dois catálogos, com a linha de convite abaixo do dia vazio; (5) as correções de documento na mesma mud… <!-- handoff:30 -->
