# Plano técnico: ação direta, regra de disparo perdido e rotinas do sistema na tela de Agendas

Tudo abaixo vem de leitura do código; nada foi executado. O que é suposição está marcado "não verificado".

## O que existe hoje (lido)

- `src/shared/schedules.ts`: `Schedule` tem `prompt`, `recurrence`, `workdaysOnly`, `thread`, `paused`, `nextRun`, `lastRun`, `lastError`. Não há ação nem regra de perda.
- `src/main/schedules/fire.ts` (`createFirer`): um disparo por vez por agenda (`going`); `markRan` antes do turno; posta linha `schedule.fired`/`schedule.firedLate` (autor app, `params.schedule`) e chama `wake(message, persona, 'schedule')`. Conversa sumida: `markRan(..., 'thread')` e `skipped`.
- `src/main/schedules/service.ts`: `tick` pega `isDue && !running` e dispara com `late: isLate` (2 min, `core.ts`). Ligar o agendador dispara o que passou, uma vez.
- `src/main/schedules/store.ts`: arquivo `schedules.json` (`v: 1`), escrita inteira por arquivo temporário e rename; `read()` filtra linhas sem `id`.
- `src/main/schedules/module.ts`: `fromSchedule` recusa criar/mudar agenda quando `openAct()?.door === 'schedule'`; o job roda a cada minuto.
- `src/main/mentions/module.ts` (`wake`/`accept`): só confere que o agente existe no time; abre linha de chamada via `beginCallActivity(id, { jobId: mentionJob(thread), call, node: { type: 'call', label: message.text } })`. Ou seja, o disparo da persona **já aparece** como nó de chamada da atividade, mas sem referência à agenda. Disparo direto não passaria por aí e não deixaria nada.
- `src/main/rpc.ts`: `Via = 'ipc' | 'web' | 'persona'`; `viaOf()` é o único leitor (há teste que falha para um segundo). `invokePersona` só roda dentro de um ato aberto. `whoNow()` (`persona/who.ts`) vira persona ou pessoa.
- `src/main/persona/door.ts`: o ato (`Act`, com `door`) é criado para cada operação de escrita; a auditoria registra `door` (`auditoria.ts`).
- Canais já existentes que fazem as ações: `runs:start` (`r.start(ref, repo, whoNow())`), `retro:prepare` (`prepareRetro(squad)`), `gate:start`/`qa:prepare` (exigem cartão), `sameday:agenda`. Chamar agente = `wake(message, agentId, door)` (o mesmo caminho da persona).
- Rotinas do sistema: `src/main/scheduler.ts` (`tick`): pré-daily (`schedule.preDaily`, janela de 30 min, `cycleOn('preDaily')`, `notifications`), retro (`retroDay`, `retroTime`, `cycleOn('retro')`), janela de trabalho (`from`, `to`, `days`, `statusEveryMin`). Estado em `status.json`. Nada disso aparece na tela.
- Ações (`src/main/actions.ts`): propostas pendentes; `onActionDone`, `onActionRefused`, `onActionSkipped`, `listActions()`.
- Tela: `src/renderer/src/screens/Schedules.tsx` e `schedulesApi.ts`; porta da persona: `doorTable.ts` (`scheduleCreate` com `prompt:t!`, sem ação nem regra), `doorOps.ts:191`, `toolDocs.ts`.

## Decisões

1. **Modelo de dados.** `Schedule` ganha `action: ScheduleAction` e `missed: 'run' | 'skip'`, mais `waiting: { actionId: string; since: string } | null`.
   - `ScheduleAction = { kind: 'persona'; prompt } | { kind: 'agent'; agent; prompt } | { kind: 'run'; ref; repo? } | { kind: 'ceremony'; ceremony; squad? }`.
   - `prompt` continua no registro (espelha o texto de `persona` e `agent`; vazio nas outras) para a tela e a persona de hoje não quebrarem.
   - Motivo: união discriminada deixa cada ação com só os campos dela e a validação num lugar.
2. **Migração por leitura, sem reescrever.** `store.read()` normaliza: sem `action` vira `{ kind: 'persona', prompt }`; sem `missed` vira `'run'`; sem `waiting` vira `null`. O arquivo só muda na próxima escrita. Não é config do workspace: não entra em `STEPS`, e `types.ts`/`defaults.ts`/`schema.ts` não mudam. `v` continua 1 (campos só se somam). Motivo: agendas antigas se comportam como antes sem a pessoa editar (regra 8, critério 7).
3. **Identidade da ação direta.** Nova origem `'schedule'` no rpc (`Via`), com `invokeSchedule(channel, args)` que só roda dentro de um ato aberto com `door === 'schedule'` e só para uma lista fixa de canais (`runs:start`, o canal da cerimônia). O mesmo canal e o mesmo handler da pessoa e da persona, nenhum caminho novo de escrita no host de código (tudo que escreve lá continua passando por Ações). `viaOf` passa a devolver `'schedule'`; o tipo `Through` de `shared/auditoria.ts` ganha o valor, e `whoNow()` devolve um `Who` de agenda. Primeiro passo da implementação: listar os consumidores de `Through` e `Who` (não verificado quantos são) e manter o teste do leitor único de `viaOf`. Se alargar `Who` for caro, plano B: registrar como pessoa com `door: 'schedule'` no ato (a auditoria já guarda `door`). Motivo: a linha de auditoria precisa dizer que veio de agenda (spec, perguntas em aberto) sem dar permissão própria; a lista fixa limita a agenda ao que persona e pessoa já podem.
4. **Agente.** `kind: 'agent'` reutiliza `wake(message, agentId, 'schedule')`, que já valida o agente no time. A agenda recusa a persona como alvo (para isso existe `persona`) e agente que não está no time. A resposta do agente cai na conversa escolhida pelo caminho de hoje.
5. **Cerimônia.** Registro `directCeremonies` (id, `available(config)`, `run(params)`) com as cerimônias que rodam sem cartão. Entra `retro` (`prepareRetro(squad?)`, exige `cycleOn('retro')`). `preDaily` só entra se `sameday:agenda` rodar sem a janela (não verificado; confirmar no código antes de incluir). `gate` e `qaHandoff` ficam de fora: exigem cartão e uma pessoa respondendo. A disponibilidade é conferida no disparo, não só ao criar: cerimônia que sumiu vira falha dita na conversa (critério 4).
6. **Aprovação pendente.** O resultado de uma ação direta é `done`, `awaiting` ou falha. `awaiting` guarda `waiting.actionId`; o próximo horário avança sem abrir segunda ação e deixa a linha "ainda aguardando". `waiting` limpa por `onActionDone`/`onActionRefused`/`onActionSkipped` (ligados em `module.ts`) e, ao abrir o app, se a ação não está mais pendente em `listActions()`. Sem expiração. **Lacuna dita:** hoje `runs:start`, `retro:prepare` e a chamada de agente não devolvem proposta pendente em Ações (as propostas nascem depois, dentro da execução ou da resposta do agente, como à mão). Então o critério 2 fica coberto pelo mecanismo geral e provado com porta falsa; não há caso real ponta a ponta que o exercite. Se o product owner quiser um caso real, é escopo novo.
7. **Regra de perda.** Avaliada no `Firer`: agenda vencida e `isLate` com `missed === 'skip'` não dispara; avança `nextRun` a partir de agora (`store.markSkipped`), grava `lastSkipped` e posta `schedule.skipped` com o horário perdido. `'run'` mantém o de hoje (uma vez, `firedLate`). Uma agenda `once` pulada fica com `nextRun: null`. Limite conhecido: um computador que dormiu mais de 2 min com o app aberto também conta como perdido, igual ao marcado "atrasado" de hoje.
8. **Falha.** Qualquer falha de ação direta posta `schedule.failed` (motivo com `redact`, até 300 caracteres), grava `lastError` e segue; a agenda não pausa nem some.
9. **Atividade.** Todo disparo abre um nó `schedule` na atividade do `mentionJob(thread)` da agenda: papel `schedule` para run/cerimônia, o do agente nos outros, rótulo com a ação e `node.schedule = id`. Estados: `started`, `finished`, `failed`, `waiting` (aguardando aprovação, já vivo e "à espera da pessoa") e novo `skipped` (terminal). `runActive` passa a tratar `skipped` como encerrado. Disparo da persona: `accept()` lê `message.params.schedule` (já gravado por `fire.ts`) para marcar o nó existente. A fila é em memória (`ACTIVITY_RING` 200): não verificado como `activityTreeModel.ts` mostra nó de papel desconhecido; ler `activityTreeModel.ts` (a partir da linha 164) antes de codar e ajustar o rótulo do papel.
10. **Rotinas do sistema, só leitura.** Função pura nova `src/shared/systemRoutines.ts` (`systemRoutines(settings, cycles)`) devolve pré-daily, retro e janela de trabalho com horário, dias, ligada ou não e a seção de configuração. Canal de leitura `schedules:routines` (`schedules/module.ts`), linha de leitura na tabela da persona (`Conversations.routines`) e entrada nas regras do navegador pareado se o teste da política exigir. `scheduler.ts` não muda de comportamento. Tela: área separada sem botões de editar, pausar ou apagar, com link para a seção de ajustes; a lista relê quando o ajuste muda (evento de ajustes: nome não verificado, achar em `Settings.tsx`/`config.ts`).
11. **Textos e tema.** Chaves novas nos dois idiomas, no mesmo arquivo de `ui.schedules.*`/`main.schedules.*`; cores só por tokens do tema.

## Mudanças, na ordem

1. **Tipos e regras puras** (`src/shared/schedules.ts`, `src/main/schedules/core.ts`): `ScheduleAction`, `ScheduleMissed`, campos novos, constantes `SCHEDULE_SKIPPED`, `SCHEDULE_FAILED`, `SCHEDULE_WAITING`; `validateInput`/`validatePatch` checam ação (ref de issue com o mesmo parser do runner, agente no time e não persona, cerimônia na lista e disponível, prompt só onde a ação pede) e `missed`; `ScheduleProblem` ganha `action`, `agent`, `ceremony`, `ref`; `ScheduleInput` ganha `action?` e `missed?` (padrão persona e `run`, para a persona e a tela de hoje continuarem valendo).
2. **Arquivo** (`store.ts`): normalização de leitura, `markSkipped`, `setWaiting`; `update` recalcula `nextRun` só como hoje.
3. **Disparo** (`fire.ts`): ramo da regra de perda; despacho por `action.kind`; linhas `schedule.fired*`, `skipped`, `failed`, `waiting`; `FireDeps` ganha `direct: DirectRunner`.
4. **Executor direto** (novo `src/main/schedules/direct.ts`): `createDirectRunner({ invoke, wake, ceremonies, now })`; `run` e `ceremony` entram por `invokeSchedule`; `agent` por `wake`.
5. **Rpc e identidade** (`rpc.ts`, `shared/auditoria.ts`, `persona/who.ts`, `persona/act.ts` conforme a decisão 3).
6. **Atividade** (`src/shared/activity.ts`: `ActivityNodeType`, `ActivityNode.schedule`, `ActivityState` `skipped`, `runActive`; `src/main/activity.ts`; `mentions/module.ts` `accept`; `renderer/src/activityTreeModel.ts`).
7. **Módulo** (`schedules/module.ts`): monta o executor, liga os ouvintes de Ações, registra `schedules:routines`; `refuseFromSchedule` segue valendo para criar e mudar.
8. **Persona** (`doorTable.ts`, `doorOps.ts`, `toolDocs.ts`): `scheduleCreate` ganha `action:j` e `missed:e[run,skip]`, `prompt` deixa de ser obrigatório; `scheduleUpdate` aceita os dois no `patch`; nova leitura `routines`.
9. **Rotinas** (`src/shared/systemRoutines.ts`) e **tela** (`Schedules.tsx`, `schedulesApi.ts`): seletor de ação com os campos de cada uma, seletor da regra de perda, linha de estado (aguardando, pulado, falhou), área de rotinas só leitura com link.
10. **Textos** (catálogos en e pt-BR), `CHANGELOG.md` (`Unreleased`), documentação que descreve agendas (achar em `docs/`, não verificado onde).

## Um teste por comportamento

Todos com relógio falso e falsos para modelo e portas, no padrão de `test/schedules-fire.test.ts`.

- `test/schedules-core.test.ts`: ação válida e inválida de cada tipo; `missed` padrão `run`; persona recusada como alvo de `agent`.
- `test/schedules-store.test.ts`: arquivo antigo (sem `action`/`missed`) lê como persona + rodar uma vez, sem reescrever; `markSkipped`; `waiting` persiste.
- `test/schedules-fire.test.ts`: `skip` fechado além do horário não dispara, deixa linha com o horário perdido e o próximo horário futuro; `run` com vários horários passados dispara uma vez como atrasado; falha de ação posta a falha e a agenda segue ativa; `awaiting` não abre segunda ação no horário seguinte e libera quando a ação é feita, recusada ou pulada (porta falsa); agenda direta dispara com o motor da persona caindo e sem nenhum `wake` da persona; agenda `run` e `ceremony` não chamam o motor.
- `test/schedules-direct.test.ts` (novo): cada ação chama o canal certo com os argumentos certos; canal fora da lista fixa é recusado; o ato carrega `door: 'schedule'` e a linha de auditoria o registra; cerimônia que sumiu vira falha.
- `test/persona-schedules.test.ts`: a persona cria agenda de ação direta e uma com `skip`; a tela devolve o mesmo; turno por `schedule` ainda não cria nem muda agenda (continua valendo `fromSchedule`).
- `test/persona-door-table.test.ts`: nova operação e canal coerentes com a tabela.
- `test/system-routines.test.ts` (novo): lista de pré-daily, retro e janela de trabalho; mudar a configuração muda a lista; rotina desligada aparece como desligada.
- Testes de atividade (arquivo existente de `activity` e do modelo da árvore): cada resultado (feito, falhou, pulado, aguardando) aparece com a agenda de origem; disparo da persona traz `node.schedule`; `runActive` com `skipped`.
- Teste existente de `viaOf` (leitor único) e o da política do navegador pareado seguem verdes com o valor novo.
- Tela: seguir o padrão de testes de tela do repositório (não verificado qual); no mínimo o modelo puro das linhas de estado e da área de rotinas.

Verificações do projeto antes de dar por pronto: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. Nenhuma foi rodada nesta etapa.

## Riscos e como se evitam

- **Agenda ganhar permissão própria.** Lista fixa de canais em `invokeSchedule`, só com ato aberto da porta `schedule`; teste de recusa. Nenhum caminho novo para o host de código.
- **Alargar `Through`/`Who` quebrar consumidores** (auditoria, política do navegador pareado). Inventário primeiro; teste do leitor único; plano B de registrar como pessoa com `door`.
- **Agenda de agente chamar a persona ou criar agenda.** Persona recusada como alvo; `refuseFromSchedule` intocado; teste.
- **Disparo duplicado** (aprovação pendente, execução longa). `going` do `Firer` mais `waiting` persistido; testes.
- **Arquivo antigo.** Normalização só na leitura, sem mudar `v`; teste com arquivo antigo.
- **Atividade em memória** (200 linhas) perde histórico ao fechar o app: o registro durável segue sendo a conversa e a auditoria; dito como limite.
- **Cerimônia que precisa de cartão ou de pessoa.** Fora do registro; a lista só tem as que rodam sozinhas.
- **Colisão com outros ciclos** (`doorTable.ts`, catálogos, `activity.ts` são tocados por outras issues): rebasear antes do passo 6; não verificado quais ciclos abertos tocam esses arquivos.
- **Lacuna do critério 2** (ver decisão 6): coberto por mecanismo e porta falsa, sem caso real.

## Critérios da spec e cobertura

- 1 (três ações sem turno da persona, auditoria e conversa): passos 3, 4, 5; testes de fire e direct.
- 2 (aprovação): mecanismo e porta falsa; sem caso real (lacuna). Recusar encerra com a falha dita: coberto.
- 3 (provedor da persona fora): teste com motor caindo.
- 4 (falha e agenda segue): coberto.
- 5 e 6 (pular, rodar uma vez): passo 3; testes de fire.
- 7 (agenda antiga): passo 2; teste de store.
- 8 (rotinas, link, reflete a configuração): passos 9 e tela; teste puro; a tela não foi testada nesta etapa.
- 9 (atividade, incluindo persona): passo 6; testes de atividade.
- 10 (persona cria agenda direta e `skip`; turno de agenda não cria): passo 8; teste de persona.
- 11 (relógio falso, falsos, verificações): descrito acima.

## Passagem

Não há pergunta bloqueante. Para a implementação: começar pelos passos 1 e 2 (puros), depois 3 e 4; fazer o inventário de `Through`/`Who` e a leitura de `activityTreeModel.ts` antes dos passos 5 e 6; confirmar se `preDaily` roda sem janela antes de incluí-la na lista de cerimônias diretas.
