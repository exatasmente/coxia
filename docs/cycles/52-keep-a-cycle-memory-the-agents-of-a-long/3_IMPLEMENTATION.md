# A memória do ciclo, lida por toda etapa e reescrita por quem conclui

A mudança está no worktree inteira: o arquivo fixo na pasta da execução, a leitura da pasta que o põe primeiro e sem corte, o módulo puro da memória, o campo de retorno no esquema, o texto das etapas, o executor que grava e commita, o canal de edição da pessoa e a documentação. Nada foi executado nesta passada; o que segue é leitura da fonte.

## 1. O que mudou

### O arquivo e a leitura da pasta (`src/main/runner/cycleFolder.ts`)

- `MEMORY_FILE = 'MEMORY.md'`, ao lado de `ISSUE_FILE`.
- `readMemory`, `writeMemory` (mesma guarda de caminho da escrita de artefato, garante a quebra de linha final e devolve se o conteúdo mudou) e `ensureMemory` (grava o esqueleto só quando o arquivo não existe; devolve verdadeiro só na criação).
- `readFolder(wt, folder, keep)`: a memória vem primeiro, depois `0_ISSUE.md`, depois os demais em ordem de nome. A memória, o registro da issue e os documentos que a etapa declara em `reads` são lidos inteiros; entre os demais, os mais antigos são cortados primeiro, cada corte marcado. O filtro por `stage.reads` saiu do executor e passou a viver aqui.

### A memória como módulo (`src/main/runner/memory.ts`, novo)

- Esqueleto de catálogo com título e as cinco seções na ordem, teto `MEMORY_MAX = 10_000`, `memoryOver`, `normalizeMemory` (garante título e seções, descarta seção inventada, junta linhas em branco) e as operações idempotentes da conversa: `factsOfThread` (resposta da pessoa vai a *Decisões*, passagem vai a *Onde o trabalho está*) e `applyFacts`, com marcadores derivados do número da mensagem (`<!-- answer:3 -->`, `<!-- handoff:5 -->`) reaplicados por cima do que a etapa devolveu. Puro, testável sem worktree.

### O campo de retorno (`src/shared/runs/output.ts`)

- `memory` na base de `outputSchema` de todos os tipos (trabalho, revisão e QA), obrigatório como os demais; `StageOutput.memory`; leitura tolerante em `readOutput` com teto próprio (`MEMORY_READ_MAX`, 60.000).

### O texto das etapas (`src/main/runner/prompt.ts`)

- A seção do arquivo já vem na ordem certa pela lista de arquivos (a memória primeiro); `runner.section.memoryOver` quando a memória passa do teto; a instrução de saída `runner.output.memory` pede o arquivo inteiro reescrito; `runner.rules.memory` diz, no texto de sistema, o que a memória é e que a pessoa pode corrigi-la.

### O executor (`src/main/runner/executor.ts`)

- Antes de ler a pasta: `ensureMemory` (execução anterior ganha o esqueleto na próxima etapa) e a aplicação dos fatos da conversa, gravados se mudaram o arquivo.
- `MEMORY_FILE` entra em `written` quando a memória foi tocada no início da etapa, então o commit da etapa o leva e a tela e a conversa o listam.
- A etapa que conclui: normaliza, mascara e reaplica os marcadores, grava e inclui `MEMORY_FILE` (sem duplicar). A etapa que pausa numa pergunta não escreve.

### A execução e o histórico (`src/main/runner/service.ts`, `src/shared/runs/`)

- `editMemory(id, text)`: recusa enquanto um agente trabalha (`memory-busy`), exige worktree (`worktree-gone`) e identidade (`no-identity`); grava com mascaramento e teto de 200.000, commita (`update the cycle memory`) com a identidade do workspace e devolve o texto gravado.
- `memoryEdited` (transitions) registra `memory-edited`, `by: person`, e a mensagem de fórum `runner.memory.edited`. `HISTORY_TYPES` ganhou `memory-edited`; o enum do esquema o pega por `enumOf`, sem outra mudança no esquema da execução.

### A tela (`src/main/runner/module.ts`, `runsApi.ts`, `ArtifactView.tsx`)

- Canal `runs:memory(id, texto)`; o visualizador de documento ganha modo de edição só para o `MEMORY.md`, com salvar e cancelar, tokens de tema e chaves nos dois idiomas.

### Documentação e changelog

- `docs/runner.md` e `docs/cycles.md` ganharam a seção da memória nos dois idiomas (arquivo fixo, forma, o que entra sozinho, teto, edição da pessoa, orçamento a favor da etapa, nada para o host de código); `CHANGELOG.md` ganhou a nota sob `## [Unreleased]`.

### Testes

- `test/runner-memory.test.ts` (novo): esqueleto e ordem, idioma, teto, normalização, fatos da conversa e idempotência.
- `test/runner-units.test.ts`: memória primeiro, memória acima do teto lida inteira, corte pelos mais antigos com os declarados inteiros.
- `test/runs-results.test.ts`: `memory` na lista exata de propriedades de cada tipo.
- `test/runs-policy.test.ts`: `runs:memory` entre os canais de escrita.
- `test/runner-e2e.test.ts`: quatro casos — a memória nasce com a execução e o commit a leva; a resposta e a passagem sobrevivem à janela das 40 mensagens; a edição da pessoa é a versão que a etapa seguinte lê, registrada como dela; a memória é a primeira seção e o aviso de teto aparece quando ela passa de 10.000.

## 2. Arquivos tocados

Novo: `src/main/runner/memory.ts`, `test/runner-memory.test.ts`.

Modificados: `src/main/runner/cycleFolder.ts`, `src/main/runner/executor.ts`, `src/main/runner/prompt.ts`, `src/main/runner/service.ts`, `src/renderer/src/screens/cycle/ArtifactView.tsx`, `src/renderer/src/screens/cycle/runsApi.ts`, `src/shared/runs/output.ts`, `src/shared/runs/transitions.ts`, `src/shared/runs/types.ts`, `src/shared/i18n/main.en.json`, `src/shared/i18n/main.pt-BR.json`, `src/shared/i18n/ui-cycle.en.json`, `src/shared/i18n/ui-cycle.pt-BR.json`, `test/runner-e2e.test.ts`, `test/runner-units.test.ts`, `test/runs-policy.test.ts`, `test/runs-results.test.ts`, `docs/runner.md`, `docs/cycles.md`, `CHANGELOG.md`.

## 3. O que foi verificado nesta etapa

Nada foi executado: esta etapa não recebeu comando nenhum. Verificado por leitura da fonte:

- A leitura da pasta monta a memória antes do registro da issue e dos demais, e o texto da etapa já monta as seções na ordem em que os arquivos chegam, então a memória fica naturalmente primeiro.
- Os marcadores da conversa derivam de `ForumMessage.seq` e a aplicação é idempotente, então reaplicar sobre o que a etapa devolveu não duplica linha.
- O commit da etapa roda depois da gravação da memória, então o mesmo commit leva a memória e os documentos; `finishStage` deduplica artefatos com `unique`, então incluir `MEMORY_FILE` mais de uma vez é seguro.
- `HISTORY_TYPES` alimenta `enumOf` no esquema, então `memory-edited` entra no enum sem outra edição.
- Cada chave nova existe nos dois catálogos (paridade por chave, sem ordenação).
- Os `anchors` novos das seções de documentação existem nos dois arquivos (a seção da memória foi criada em `docs/runner.md` e em `docs/cycles.md`, nos dois idiomas).

## 4. O que não foi verificado

- `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` e `electron-vite build`: **não rodados** — esta etapa não tem comandos. Nenhum teste foi executado; os quatro casos novos de ponta a ponta e o arquivo de unidade não foram vistos passando.
- Nenhum comportamento foi observado no aplicativo em execução, e nenhum modelo real foi usado (os testes são de motor com script).
- Se o modelo de verdade preenche `memory` sem truncar, e se preserva o que a pessoa escreveu: depende de modelo real, não observado.
- Se a tela renderiza o editor da memória como descrito: não há teste de tela renderizada; a prova é leitura da fonte.

## 5. Divergências do plano

1. **Os fatos da conversa entram no início da etapa seguinte, não no instante em que a resposta ou a passagem é gravada.** O item 7 do plano pedia acrescentar o fato ao `MEMORY.md` e commitá-lo no próprio caminho de escrita. A implementação aplica `factsOfThread` + `applyFacts` no começo de cada etapa, antes de o texto ser montado, e o commit que leva o acréscimo é o da etapa seguinte. O efeito que importa — a resposta e a passagem continuam na memória depois de a conversa passar da janela — é o mesmo, porque o arquivo está no worktree e é versionado antes de qualquer leitura posterior; o que muda é só que um acréscimo feito entre etapas não é commitado enquanto nenhuma etapa seguinte começa (por exemplo, uma execução cancelada logo depois de uma resposta). Fica registrado como risco conhecido.
2. **O teste de orçamento existente foi reescrito** para esperar o corte pelos mais antigos com os declarados em `reads` inteiros, como manda a decisão 10 do plano — mudança de expectativa, não de comportamento inesperado.

## 6. Gates

Nenhuma porta do repositório rodou nesta etapa (§4). A suíte e o restante seguem **não verificados**.
