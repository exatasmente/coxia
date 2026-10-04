# A memória do ciclo, lida por toda etapa e reescrita por quem conclui

O arquivo fixo na pasta da execução, a leitura da pasta que o põe primeiro e sem corte, o módulo puro da memória, o campo de retorno no esquema, o texto das etapas, o executor que grava e commita, o canal de edição da pessoa e a documentação. Esta é a segunda passada: ela fecha os achados que a revisão marcou como bloqueadores e registra as sugestões que sobraram.

**Nada foi executado nesta passada.** Esta etapa não recebeu comando nenhum; o que segue é leitura da fonte e conferência aritmética da ordem dos artefatos. Nenhum teste foi rodado, e as gravações de referência foram corrigidas **à mão** — não regeradas com `UPDATE_GOLDEN=1 npx vitest run test/runner-golden.test.ts`. Tudo o que depende de execução está em §4 e §6 e segue **não verificado**.

## 1. O que a feature mudou

### O arquivo e a leitura da pasta (`src/main/runner/cycleFolder.ts`)

- `MEMORY_FILE = 'MEMORY.md'`, ao lado de `ISSUE_FILE`.
- `readMemory`, `writeMemory` (mesma guarda de caminho da escrita de artefato, garante a quebra de linha final e devolve se o conteúdo mudou) e `ensureMemory` (grava o esqueleto só quando o arquivo não existe; devolve verdadeiro só na criação).
- `readFolder(wt, folder, keep)`: a memória vem primeiro, depois `0_ISSUE.md`, depois os demais em ordem de nome. A memória, o registro da issue e os documentos que a etapa declara em `reads` são lidos inteiros; entre os demais, os mais antigos são cortados primeiro. O filtro por `stage.reads` saiu do executor e passou a viver aqui.

### A memória como módulo (`src/main/runner/memory.ts`, novo)

- Esqueleto de catálogo com título e as cinco seções na ordem, teto `MEMORY_MAX = 10_000`, `memoryOver`, `normalizeMemory` (garante título e seções, descarta seção inventada, junta linhas em branco) e as operações idempotentes da conversa: `factsOfThread` (resposta da pessoa vai a *Decisões*, passagem vai a *Onde o trabalho está*) e `applyFacts`, com marcadores derivados do número da mensagem (`<!-- answer:3 -->`, `<!-- handoff:5 -->`) reaplicados por cima do que a etapa devolveu. Puro, testável sem worktree.

### O campo de retorno (`src/shared/runs/output.ts`)

- `memory` na base de `outputSchema` de todos os tipos (trabalho, revisão e QA); `StageOutput.memory`; leitura tolerante em `readOutput` com teto próprio (`MEMORY_READ_MAX`, 60.000).

### O texto das etapas (`src/main/runner/prompt.ts`)

- A seção do arquivo já vem na ordem certa pela lista de arquivos (a memória primeiro); `runner.section.memoryOver` quando a memória passa do teto; a instrução de saída `runner.output.memory` pede o arquivo inteiro reescrito; `runner.rules.memory` diz, no texto de sistema, o que a memória é e que a pessoa pode corrigi-la.

### O executor (`src/main/runner/executor.ts`)

- Antes de ler a pasta: `ensureMemory` (execução anterior ganha o esqueleto na próxima etapa) e a aplicação dos fatos da conversa, gravados se mudaram o arquivo.
- `MEMORY_FILE` entra em `written` quando a memória foi tocada no início da etapa, então o commit da etapa o leva e a tela e a conversa o listam.
- A etapa que conclui: normaliza, mascara e reaplica os marcadores, grava e inclui `MEMORY_FILE` (sem duplicar). A etapa que pausa numa pergunta não escreve.

### A execução e o histórico (`src/main/runner/service.ts`, `src/shared/runs/`)

- `editMemory(id, text)`: recusa enquanto um agente trabalha (`memory-busy`), exige worktree (`worktree-gone`) e identidade (`no-identity`); grava com mascaramento e teto de 200.000, commita (`update the cycle memory`) com a identidade do workspace e devolve o texto gravado.
- `memoryEdited` (transitions) registra `memory-edited`, `by: person`, e a mensagem de fórum `runner.memory.edited`. `HISTORY_TYPES` ganhou `memory-edited`; o enum do esquema o pega por `enumOf`.

### A tela (`src/main/runner/module.ts`, `runsApi.ts`, `ArtifactView.tsx`)

- Canal `runs:memory(id, texto)`; o visualizador de documento ganha modo de edição só para o `MEMORY.md`, com salvar e cancelar, tokens de tema e chaves nos dois idiomas.

### Documentação e changelog

- `docs/runner.md` e `docs/cycles.md` ganharam a seção da memória nos dois idiomas; `CHANGELOG.md` ganhou a nota sob `## [Unreleased]`.

## 2. O que esta passada corrigiu

### 2.1 As seis gravações de referência (`test/fixtures/runner-golden/`) — achado 1, bloqueador

A mudança que quebrava as gravações é a pretendida: `MEMORY_FILE` entra em `written` e, por `refsOf(written)`, nas referências das mensagens do fórum. As seis gravações foram atualizadas **à mão** (`review-once`, `qa-fail-once`, `review-limit`, `review-and-qa-once`, `waiting-agents`, `gates-and-question`).

A regra que apliquei, derivada do executor e das transições, e que é o que a pessoa revisora deve conferir contra o resultado de `UPDATE_GOLDEN=1`:

1. Por tentativa, `written` = `[MEMORY.md]` **se** a memória foi tocada, e em seguida os artefatos declarados, na ordem da saída (`executor.ts:458-467`). `memoryTouched` é verdadeiro quando o arquivo nasceu naquela etapa (`born`, só a primeira etapa de agente da execução) **ou** quando um fato novo da conversa (resposta ou passagem) apareceu desde a última gravação (`executor.ts:339-345`).
2. O artefato de uma etapa é a união das tentativas, na ordem das tentativas, sem repetir (`finishStage`, `transitions.ts:45-51`, com `unique` preservando a primeira ocorrência).
3. A referência da mensagem `stageDone` é o `written` **daquela tentativa** (`service.ts:479/497`), não a lista acumulada.

Consequência que aparece nas gravações: a primeira etapa (nasce a memória) fica `[MEMORY.md, <doc>]`; uma etapa de implementação cuja primeira tentativa não recebeu fato novo e cuja segunda recebeu (a devolutiva da revisão) fica `[3_IMPLEMENTATION.md, MEMORY.md]`, enquanto a mensagem da segunda tentativa sai com `[MEMORY.md, 3_IMPLEMENTATION.md]`. Conferi essa ordem contra o histórico e a conversa de cada gravação, mensagem a mensagem (o portão que aprova é `decision` e **não** é fato; a rejeição, a devolutiva da revisão, a devolutiva do QA e a passagem de etapa são `handoff` e **são** fato — é o que mantém `implement` de `gates-and-question` como `[3_IMPLEMENTATION.md]`, sem a memória).

### 2.2 A expectativa de `runner-squads` — achado 2, bloqueador

- `test/runner-squads.test.ts:107`: `result.artifacts` passou a `['MEMORY.md', '0_TRIAGE.md']`.
- `test/runner-squads.test.ts:133`: o registro da etapa `triage` depois de `setSquad` passou a `['MEMORY.md', '0_TRIAGE.md']` — `routeSquad` chama `finishStage(out, at, 'done', result.artifacts)` e `result.artifacts` é o `written` da etapa, que traz a memória.

O teste de unidade `test/runs-squads.test.ts` monta o objeto `result` à mão e segue com `['0_TRIAGE.md']`; conferido, não precisa mudar — ele não passa pelo executor.

### 2.3 A ordem das chaves de tradução — achado 3, bloqueador

Nas duas cópias (`ui-cycle.en.json`, `ui-cycle.pt-BR.json`), o bloco `ui.cycle.artifact.*` ficou em ordem: `cancel`, `clipped`, `edit`, `editLabel`, `gone`, `loading`, `save`.

### 2.4 O mascaramento do texto da conversa — achado 4, bloqueador

`src/main/runner/memory.ts:88-99`: `factsOfThread` monta a linha da resposta **e** a da passagem passando `m.text` por `redact` (de `../errorlog-core`), como os outros dois caminhos de escrita da memória já faziam. O marcador (`<!-- answer:n -->` / `<!-- handoff:n -->`) vem de `m.seq` e não é afetado. O texto continua entrando no worktree e no ramo, agora sem credencial em claro.

Estendi o mascaramento à **passagem**, não só à resposta: a devolutiva do portão rejeitado é uma passagem escrita pela pessoa e carrega texto tão sensível quanto uma resposta. Um comentário curto acima do laço diz por quê (a memória é versionada e vai no pull request).

### 2.5 As sugestões 5 e 6 — registradas

- **5 — momento do commit dos fatos.** Fica como divergência aceita e documentada (§5, item 1): os fatos entram no início da etapa seguinte e vão no commit dela; uma execução que pare logo depois de uma resposta não leva o acréscimo ao disco. O efeito que a spec pede (o fato sobrevive à janela de 40 mensagens) continua valendo enquanto a execução anda. Não bloqueio a etapa por isso; fica para a pessoa decidir se quer o commit no instante da resposta.
- **6 — documento deixado de fora em silêncio.** Anterior a esta mudança; a ordem nova (mais antigos primeiro) torna o silêncio o desfecho provável, e o teste de orçamento codifica isso (`1_A.md` ausente). Não mexi no comportamento: sem executar teste, trocar a leitura da pasta é risco desnecessário. Fica registrado como item para uma passada própria.

## 3. Arquivos tocados nesta passada

- `test/fixtures/runner-golden/review-once.json`, `qa-fail-once.json`, `review-limit.json`, `review-and-qa-once.json`, `waiting-agents.json`, `gates-and-question.json` (editados à mão).
- `test/runner-squads.test.ts` (linhas 107 e 133).
- `src/shared/i18n/ui-cycle.en.json`, `src/shared/i18n/ui-cycle.pt-BR.json` (ordem do bloco `ui.cycle.artifact.*`).
- `src/main/runner/memory.ts` (mascaramento de resposta e passagem).

## 4. O que não foi verificado

- **Nenhuma porta rodou nesta etapa** — ela não recebeu comando. `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` e `electron-vite build` seguem **não verificados**.
- As seis gravações foram corrigidas à mão a partir da leitura do executor e das transições; **não** foram regeradas por `UPDATE_GOLDEN=1` nem vistas passando. Se a minha derivação da ordem errar em alguma mensagem, o vermelho aparece só quando a suíte rodar.
- O mascaramento novo em `memory.ts` não foi exercitado; conferi por leitura que nenhum texto afirmado nos testes existentes (`Plan X and leave Z out.`, `Ship it behind a flag.`, `The plan is settled.`, `The constant must be 2.`) casa com os padrões de `redact`, mas isso é leitura, não execução.
- Nenhum comportamento foi observado no aplicativo em execução e nenhum modelo real foi usado.

## 5. Divergências do plano

1. **Os fatos da conversa entram no início da etapa seguinte, não no instante em que a resposta ou a passagem é gravada.** O item 7 do plano pedia acrescentar o fato ao `MEMORY.md` e commitá-lo no próprio caminho de escrita. A implementação aplica `factsOfThread` + `applyFacts` no começo de cada etapa e o commit que leva o acréscimo é o da etapa seguinte. Um acréscimo feito entre etapas não é commitado enquanto nenhuma etapa seguinte começa. Risco conhecido e aceito (sugestão 5 da revisão).
2. **O teste de orçamento existente foi reescrito** para esperar o corte pelos mais antigos com os declarados em `reads` inteiros — mudança de expectativa, não de comportamento inesperado.
3. **O mascaramento foi estendido à passagem, além da resposta**, por ser o mesmo caminho sensível (devolutiva do portão). Paridade com os outros dois caminhos de escrita, que já mascaram.

## 6. Gates

Nenhuma porta do repositório rodou nesta etapa (§4). A suíte e o restante seguem **não verificados**. A confirmação do fechamento do achado 1 depende de rodar `npx vitest run test/runner-golden.test.ts` (e, se a ordem divergir, `UPDATE_GOLDEN=1` só depois de confirmar que a mudança é a pretendida).
