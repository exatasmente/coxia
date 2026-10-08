# Qualquer agente sabe o que está em andamento, e o reinício não perde isso

O app passa a manter um registro das atividades do espaço de trabalho — uma frente por atividade, não
por execução — fora de todo worktree, escrito só pelo app a partir do estado que ele já guarda, e
mostrado a um agente como um recorte. Com ele, uma pergunta sobre uma atividade em andamento é
respondida com a etapa dela e quem a trabalha, em qualquer conversa, e o registro sobrevive a fechar e
reabrir o app. A lista das atividades aparece na tela de execuções e pode ser corrigida à mão, sem
nenhuma chamada de modelo. O que segue diz o que foi construído, o que a passada verificou e o que
ficou de fora.

## O que foi construído

### O registro (`src/main/runner/activities.ts`, novo)

Um módulo puro (fora do Electron) com:

- **A forma.** `ActivityFront` (referência, título, endereço, ciclo de vida, `bare` para uma atividade
  conhecida que nunca foi iniciada, etapa com o rótulo já no idioma, `runId`, squad, agente atual,
  último agente, decisões, perguntas em aberto, onde parou, último recado, a correção da pessoa e o
  instante). `ActivityIndex` guarda as frentes por referência e, por agente, onde ele foi visto por
  último.
- **O arquivo.** `<workspace>/memory/activities.json` (`MEMORY_DIR` + `ACTIVITIES_FILE`), escrito de
  forma atômica (arquivo temporário + `rename`). Um arquivo escrito por um app mais novo não é lido e
  nunca é sobrescrito (`readIndex` devolve `null` e o chamador só grava por cima quando ele leu).
- **A projeção.** `frontOfActivity(run, prior, language)` monta uma frente a partir de um `Run` e do
  que a frente já tinha, sem ler disco. `lastHandoff` sai da última resposta da pessoa ou do último
  trabalho devolvido a uma etapa anterior (`handback`); o recado que uma etapa deixa para a seguinte é
  mensagem do fórum e não está no arquivo da execução, então a frente não o afirma.
- **O leitor que reprojeta.** `claimFront(index, store, ref, language)` monta a frente da execução
  mais recente daquela referência; sem execução nenhuma, devolve o que o arquivo guardava. Uma frente
  que a pessoa corrigiu (`source: 'person'`) é mantida enquanto a execução não andar depois da
  correção.
- **O corte para a chamada.** `selectFronts` escolhe o que foi nomeado (a referência, o número, ou o
  agente) e, sem nada nomeado, o que está em andamento; `renderFronts` escreve no idioma da chamada,
  corta por `SELECT_MAX` (2000 caracteres por chamada) e nomeia numa linha o que não coube, sem cortar
  no meio; uma frente com mais de `STALE_AFTER_MS` (30 dias) sai como "provavelmente encerrada" e
  nunca é apagada.
- **A correção da pessoa.** `correct(ref, text, store, language)` mascara (`redact`), corta em
  `CORRECTION_MAX` (20.000) e em linhas curtas, marca `source: 'person'` e grava.

### O escritor (o app, num ponto só)

- `RunForum` ganhou `activities?`. `beginRun` chama o upsert com `null` antes e a execução depois; e
  `moveRun` lê a execução antes, aplica o movimento e chama o upsert com o antes e o depois. `move()`
  do serviço e os movimentos assíncronos passam os dois por aí, então os pontos da regra 3 (início,
  entrada e saída de etapa, resposta, devolução, recusa de portão, pergunta, cancelamento) ficam todos
  cobertos sem nenhum outro ponto de escrita.
- O upsert nunca lança para dentro do movimento: uma falha é registrada no log
  (`[runner] could not update the shared memory`) e engolida, e o leitor reprojeta do store, então a
  perda se recupera sozinha. Um escritor, mescla por chave, escrita atômica: duas atividades avançando
  ao mesmo tempo são duas chaves.
- `create()` do serviço chama `activities.ensure({ ref, iid, title, url }, now())` quando a identidade
  e o repositório já são conhecidos e **antes** de o worktree ser feito: um início interrompido ali
  deixa um registro mínimo da referência.

### O recorte na chamada

- **Etapa:** `StageInput.shared` e a seção `runner.section.shared`, montada no `stagePrompt`. O
  executor a preenche por `d.sharedMemory(run)`; o serviço liga isso a `activities.render(...)` com a
  frente da própria atividade inteira e o resto em resumo.
- **Menção:** `MentionInput.memory` e a mesma seção em `mentionCall`. `answerMentions` a preenche por
  `deps.memory?.(place, message)` em todos os lugares. O runner liga ao registro do workspace; o
  módulo de menções (canal de squad, conversa geral, conversa direta) também, lendo o registro da pasta
  do espaço de trabalho em execução.
- **Aviso ao agente que trabalha:** quem trabalha e recebe uma mensagem é avisado de que o registro
  mudou e pode pedir a atividade pelo nome (`runner.section.sharedMoved`) — uma mensagem, nunca uma
  segunda cópia do registro.
- A seção vai sempre entre `<data>`, com a linha que diz que é material e não instrução. **Nada** do
  registro entra em `allowedTools`, em `extraDirs` ou em raízes de confinamento: a única saída é texto
  no prompt.

### A tela, sem chamada de modelo

- Canais `runs:activities` (leitura) e `runs:activitySave` (correção da pessoa), no módulo do runner.
  Os dois são abertos ao navegador emparelhado como todo `runs:*` (o teste de política confirma).
- `RunsScreen.tsx` ganhou uma seção abaixo dos filtros: uma linha por atividade com referência, título,
  etapa, agente e onde parou, e uma folha de edição; `runsApi.ts` ganhou `activities` e
  `saveActivity` e o tipo `ActivityFrontView`.

### Documentação

- `docs/runner.md` ganhou a seção "O registro das atividades" / "The record of the activities", nos
  dois idiomas; `CHANGELOG.md` ganhou a nota sob `## [Unreleased]`. `AGENTS.md` não mudou (nada nele
  ficou falso: as instruções universais não dizem onde a memória mora).

## O que a passada corrigiu, na prática

Ao escrever os testes, três coisas apareceram e foram corrigidas no código:

1. **A leitura do recado.** A primeira versão procurava por uma entrada `hand-off` no histórico, que
   não existe: o recado de uma etapa é mensagem do fórum. Passou a ler `answer` e `handback`, que são
   o texto que a execução realmente guarda.
2. **A correção se perdia na releitura.** `read()` reprojetava a frente do store e descartava a
   correção da pessoa, mesmo com a execução parada desde antes dela. Agora uma frente com
   `source: 'person'` é mantida enquanto a execução não andar depois da correção (`claimFront` e o
   `upsert`), e isso está preso por teste.
3. **O idioma.** A primeira versão usava `shownText`, que lê o idioma do processo em execução, e a
   seção saía em português numa chamada em inglês. Passou a `cycleText(..., language)`.

## O que foi verificado, e como

| O que | Resultado |
|---|---|
| `npx tsc --noEmit` | **passa** |
| `npx vitest run` (suíte inteira) | **4374 de 4374**, 291 arquivos |
| `test/activityIndex.test.ts` (novo) | **14 de 14** |
| `test/sharedMemoryCall.test.ts` (novo) | **4 de 4** |
| `test/sharedMemoryRun.test.ts` (novo) | **4 de 4** |
| `test/runs-policy.test.ts` | **passa** (a lista ganhou os dois canais) |
| `test/cycle-prompts.test.ts` | **passa** (a seção e o aviso entram nos prompts do ciclo) |
| `test/ui-i18n.test.ts` | **passa** (chaves nos dois catálogos, em ordem) |
| `node scripts/theme-audit.mjs` | **passa** (8 cores literais em `api.ts`, que a mudança não toca) |
| `npm run i18n:lint` | **passa**: 4647 chaves nas duas línguas |
| `node scripts/public-audit.mjs` | **passa**: 1218 arquivos |

Os testes cobrem, por comportamento: uma frente por referência e uma segunda execução atualizando a
mesma; a frente dizendo etapa, agente, pergunta em aberto, onde parou e o instante; a decisão de um
portão e o estado de uma execução terminada; uma frente antiga renderizada como provavelmente
encerrada e nunca apagada; o arquivo indo e voltando, e um arquivo mais novo sendo recusado e
preservado; a frente reprojetada do store e o registro mínimo de uma atividade que nunca teve
execução; o corte por nome e por agente; o teto da resposta por chamada; a correção da pessoa
sobrevivendo à releitura e não sendo recusada enquanto uma etapa trabalha; a seção entrando no prompt
de uma menção entre `<data>` e não abrindo nenhuma ferramenta; e, no caminho inteiro de uma execução,
um início deixando a frente e um movimento a mantendo em dia, com a lista da tela sem chamar modelo.

O `sharedMemoryRun.test.ts` drive o runner de verdade (com o motor de mentira e o host falso dos
testes): o `start` grava o arquivo, a frente fica com a execução certa, o arquivo está fora do
worktree, a seção chega ao prompt da etapa, e a correção da pessoa aparece no arquivo. **Nenhum modelo
real foi chamado, nenhum host real foi tocado, e a interface não foi aberta.**

## O que não foi verificado

- **A tela, no app em execução**: a seção das atividades e a folha de edição foram escritas e o
  typecheck as aceita, mas nenhuma tela foi aberta e nenhum clique foi dado; os testes cobrem os
  canais e o que eles devolvem, não o desenho.
- **O reinício de verdade**: os testes mostram que o registro é um arquivo lido do disco e não estado
  de processo, mas fechar e reabrir o app com a pasta de dados e conferir a resposta de um agente não
  foi feito.
- **O QA do relato, em pessoa**: o caminho foi exercitado por teste (a seção no prompt, o aviso ao
  agente que trabalha), mas a conversa do relato não foi reproduzida num app aberto.
- **Vários espaços de trabalho e vários computadores**: fora do escopo, como a especificação diz.
- **O serviço de menções fora de uma execução** foi ligado ao registro do workspace em execução
  (`sharedMemory()` em `mentions/module.ts`) por leitura; o teste do caminho de menção usa a montagem
  da chamada, não o módulo de menções inteiro rodando com um fórum real.

## Divergências do plano

1. **As miniaturas por agente entram no arquivo e no prompt, mas não têm teste próprio do corte.**
   `index.agents` é preenchido no upsert e aparece no render quando agentes foram nomeados; não há um
   caso dedicado a "o que fulano está fazendo". É o item mais fraco da entrega.
2. **`folded()` do plano não existe.** O plano previa `folded(index, run)` puro; a implementação
   ficou com o upsert no store (o mesmo efeito, um só ponto de escrita) porque era o único chamador.
   `frontUpsertOf`/`runFileOf`/`frontFromRunFile` do plano também não existem: o leitor reprojeta
   pelo store, que é o que a entrega precisava.
3. **`SHARED_MAX` do plano virou `SELECT_MAX`** (2000 caracteres por chamada), o mesmo papel, nome
   ajustado ao que a função faz.
