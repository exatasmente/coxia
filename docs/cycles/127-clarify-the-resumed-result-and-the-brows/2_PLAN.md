# Plano para mostrar a qual tentativa pertence um texto falado, manter a timeline do navegador livre das linhas de outra execução e o teste falhando da cadeia

## Com o que este plano parte (verificado antes de escrevê-lo)

- `npx tsc --noEmit` em toda a árvore: passa, sem erros. A árvore compila; o "arquivo que não compila" não existe como tal hoje.
- `npx vitest run`: um teste falha — `test/runner-chain.test.ts` ("is not answered by an agent once the person has answered it"; a asserção perto da linha 207 espera `status: 'question'` com `question.holder: 'tech-lead'` e a execução está `working` com `question: null`). Este é o teste que a revisão relatou: não falha em compilar, falha em passar.
- `npm run i18n:lint`, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs`: passam.
- Código lido: `src/shared/runs/transitions.ts` (como as tentativas começam e como os documentos de uma etapa se fundem), `src/shared/runs/view.ts` e `src/renderer/src/screens/cycle/StageTimeline.tsx` (o que a timeline desenha), `src/main/activity.ts` e `src/shared/activity.ts` (o anel de atividade de um job), `src/renderer/src/activity.ts`, `src/renderer/src/useActivity.ts` e `src/renderer/src/AgentActivity.tsx` (como uma timeline alongada emenda o que recebe).

## Decisões e o porquê

1. **O objeto a esclarecer é a lista de documentos da etapa.** Uma linha da etapa da timeline mostra seu estado, sua contagem de tentativa, suas vezes, seus documentos e seus comentários do tracker. Em uma tentativa retomada (retornada, reintentada, reiniciada), o registro da etapa mescla os novos nomes de documento com os anteriores (`finishStage` em `src/shared/runs/transitions.ts`: `unique([...r.artifacts, ...artifacts])`), e nada na tela diz a qual tentativa um documento listado pertence. A correção atribui cada documento a uma tentativa e marca a lista; nenhum redesign da timeline. Os comentários do tracker já obtêm chaves por tentativa (o padrão `status:<runId>:<stage>:<attempt>`), então eles têm um link de tentativa; a mudança marca os documentos, cuja lista é uniforme.
2. **Tentativas, não "antigos vs. novos".** Em vez de marcar apenas textos de uma tentativa anterior, cada documento recebe a tentativa em que foi produzido (quando os dados o têm). Responder uma pergunta retoma a mesma tentativa (`transitions.ts`, `answer`), então uma resposta gera nenhum novo número — uma tentativa retornada, reintentada ou reiniciada gera. Ambos os casos então leem corretamente sem um segundo tipo de marcador.
3. **Dados opcionais, sem migração.** Um novo campo opcional no registro da etapa (`artifactAttempts`) mantém arquivos de execução antigos válidos e não mostra nada novo quando o campo está ausente; a tela simplesmente não tem tentativa a dizer.
4. **A junção do navegador é aparada, no caminho de um stream reconectado apenas.** Uma tela aberta no meio de uma execução mantém o comportamento de hoje (regra 4 da especificação): o mesmo backfill é executado, as mesmas linhas entram. Somente após o stream de eventos ter caído e voltado (`EVENTS_RECONNECTED` em `src/renderer/src/useActivity.ts`) o que voltou é estreitado às execuções que a timeline já mantém ou que ainda estão em andamento. Isso remove a junção de execuções anteriores encerradas do mesmo job sem mudar a primeira abertura.
5. **O teste de cadeia falhando é tratado como um teste a alinhar, com uma verificação de regressão primeiro.** O código de cadeia ainda define o estado esperado (`ask` em `transitions.ts` define `status: 'question'` com o holder; `answerByAgent` restaura `working`), então uma execução travada em `working` sem pergunta lê-se como o loop de polling do teste (80 waits de 10 ms) correndo com o motor, não como um comportamento perdido. A etapa de implementação confirma isso e alinha o teste a aguardar o estado deterministicamente; se descobre que o estado não pode mais ocorrer, a correção passa para o código de cadeia com o mesmo teste cobrindo-o.
6. **O trecho de documentação que a revisão deixou para trás não entra nesta issue.** É sem nome na issue, na triagem e na especificação, com nenhum critério de aceitação; perseguir um trecho sem nome numa entrega cujos critérios são comportamentais tornaria o trabalho não revisável. É arquivado como um relatório próprio (o handoff carrega a decisão).

## Mudanças, em ordem

### Passo 1 — consertar o teste de cadeia falhando

- Arquivo e função: `test/runner-chain.test.ts`, o caso "is not answered by an agent once the person has answered it".
- Primeiro um diagnóstico: execute o cenário de cadeia uma vez com o loop de polling substituído por uma espera até a execução entrar em `question` com holder `tech-lead`. Se o estado aparecer, apenas a espera muda; as asserções são mantidas. Se nunca aparecer, leia se o comportamento de cadeia mudou em `src/main/runner/` (a parte de handoff de pergunta) e conserte o comportamento em vez disso.
- Alinhamento: a espera faz polling até a execução estar no estado esperado (com um timeout que falha o teste); sem limite de turnos fixo, sem dormir que uma máquina lenta possa sobreviver. Também remova o loop de pré-condição frágil se o estado puder ser aguarado diretamente.

### Passo 2 — atribuir cada documento de uma etapa a uma tentativa, e marcá-lo na timeline

- Arquivos e funções:
  - `src/shared/runs/types.ts`: no tipo de registro de etapa, adicione um `artifactAttempts?: Record<string, number>` opcional (nome do documento → número de tentativa), ao lado de `artifacts`.
  - `src/shared/runs/schema.ts`: o objeto do registro ganha o mesmo mapeamento opcional (não requerido, descrições em inglês); arquivos antigos continuam válidos, daí a forma opcional.
  - `src/shared/runs/transitions.ts`, `finishStage` (e a criação de registro em `enter`): quando novos nomes de documento são mesclados, as entradas de `artifactAttempts` são escritas com o número de tentativa atual (o `attempts` do registro após seu incremento em `enter`). Um nome já presente mantém sua primeira tentativa.
  - `src/shared/runs/view.ts`, `StageRow`: estenda a linha com o mapeamento de tentativa do registro levado fino (dados apenas, nada desenhado aqui).
  - `src/renderer/src/screens/cycle/StageTimeline.tsx`, `Row`: o item de lista de documento mostra um distintivo discreto pequeno com a tentativa quando a etapa tem mais de uma tentativa e o número é conhecido — textos apenas através de `t()`.
  - `src/shared/i18n/ui-cycle.en.json` e `ui-cycle.pt-BR.json`: adicione `ui.cycle.stage.attemptOf` — inglês "attempt {count}", português "tentativa {count}" — na mesma família de textos de `ui.cycle.stage.attempts`.

### Passo 3 — a timeline do navegador mantém apenas a execução em andamento

- Arquivos e funções:
  - `src/renderer/src/activity.ts`: dentro de `createActivityStore`, adicione uma variante de `backfill` que estreita o que entra — uma entrada de entrada entra apenas quando seu `runId` já está no bucket ou a execução ainda está em andamento por `runActive` sobre o lote de entrada (uma execução encerrada antes da queda, sem linha aqui, é descartada; isso é a junção). O `backfill` simples mantém seu comportamento para uma tela que abre recém.
  - `src/renderer/src/useActivity.ts`: marque o backfill que roda do listener `EVENTS_RECONNECTED` como o estreitado; o backfill de abertura de tela do efeito `useActivity` fica sozinho (regra 4 da especificação). O call de variante estreita mantém o mesmo fetch `ACTIVITY_GET`.

## Ordem de todo

1. Passo 1 (o teste de cadeia): independente, rápido uma vez diagnosticado, e ele descongestiona a suíte antes de qualquer coisa ser avaliada nele.
2. Passo 2 (atribuição de tentativa): dados primeiro (`types`, `schema`, `transitions`), depois a linha compartilhada (`view`), depois a tela e os dois catálogos.
3. Passo 3 (junção do navegador): apenas renderizador, depois o trabalho de dados, para que nenhum teste tenha que ser reescrito no meio.
4. Fechamento: `CHANGELOG.md` (`## [Unreleased]`, uma entrada por comportamento), depois as portas completas (`npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`) — verde é o que faz a mudança ficar concluída.

## Resumo teste-por-comportamento

| Comportamento | Arquivo de teste |
|---|---|
| Documentos de uma etapa mantêm a tentativa em que foram produzidos; um nome repetido mantém seu primeiro | `test/runs-flow.test.ts` (ou o arquivo de transições `runs-*` adjacente) |
| A linha da timeline mostra um distintivo de tentativa quando o mapeamento é conhecido, e nenhum quando não é | o teste de tela da StageTimeline sob `test/` |
| O backfill estreitado de um stream reconectado descarta uma execução encerrada ausente do bucket, mantém a que está em andamento | `test/activity-store.test.ts` |
| O backfill simples (tela aberta) ainda entra em tudo o que obtém, como hoje | `test/activity-store.test.ts` |
| Uma pergunta mantida por agente não é respondida por um agente uma vez que a pessoa a respondeu, deterministicamente | `test/runner-chain.test.ts` |

## Riscos e como o plano os evita

- **Arquivos de execução antigos sem `artifactAttempts`.** Campo opcional, sem migração; a tela mostra nenhum distintivo quando está faltando. Coberto pelos testes de antigos-arquivos da store e pela teste de fallback da tela.
- **Uma tentativa retomada cujos documentos foram produzidos antes do número de tentativa subir** (uma resposta retoma a mesma tentativa): o distintivo diz o que aquela tentativa é, então nada é rotulado de forma errada; o critério pede "o mais antigo ou o que retomou", e o número responde a ambos.
- **O backfill estreitado descartando linhas de uma execução ativa.** Uma execução ainda em andamento é mantida pela verificação `runActive` sobre o lote de entrada; apenas execuções encerradas antes da queda, cujas linhas o bucket nunca manteve, são deixadas de fora — o que é exatamente a junção que a issue relata. Coberto pelos dois testes da store.
- **Uma mudança de comportamento escondida atrás do estreitamento reconectado.** A mudança é confinada ao caminho `EVENTS_RECONNECTED`; o caminho que uma tela abre primeiro mantém sua busca e sua mesclagem intocadas, então um navegador pareado que recarrega uma página não muda o que mostra.
- **O teste de cadeia lutando contra uma regressão real.** O plano coloca o diagnóstico antes do alinhamento; a implementação lê a cadeia primeiro e move a correção para o código se o estado esperado não puder ocorrer, em vez de mascarar um comportamento perdido com uma asserção reescrita.
- **O texto da tentativa da timeline lendo-se como uma nova palavra sem contexto.** O distintivo reutiliza a redação que o cabeçalho da etapa já imprime (`ui.cycle.stage.attempts`, "attempt {count}"), então o vocabulário na tela permanece um.

## Critérios de aceitação e onde o plano os cobre

1. (Pergunta respondida; a timeline diz a qual tentativa um texto falado pertence) — coberto pelo Passo 2 (a resposta sendo o mesmo número de tentativa) e pela teste de renderização da StageTimeline.
2. (Enviado de volta, reintentado, reiniciado) — coberto pelo mesmo mecanismo; cada caso é uma elevação do número de tentativa em `enter`; o teste de transições cobre um caso enviado-de-volta, e um reiniciado comporta-se da mesma forma através da mesma função.
3. (Navegador, queda com retorno, sem emendas) — coberto pelo Passo 3.
4. (Verificação de compilação, incluindo o arquivo de teste relatado) — coberto pelo Passo 1 mais as portas de fechamento (`tsc` passa já hoje; o teste falhando torna-se um passando).
5. (Novos textos em ambos os catálogos) — coberto pelos catálogos no Passo 2 e pela porta `i18n:lint`.

## Item de aceitação extra não reescrito por um simples arquivo

- A suíte de teste também mostra seu resultado sob dois lis diferentes; a verificação de compilação da árvore cobre o `tsc` e a suíte em conjunto, e o fechamento verifica a suíte inteira, não uma só linha.
