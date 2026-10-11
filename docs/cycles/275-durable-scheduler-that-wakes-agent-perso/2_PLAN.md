# Plano técnico: agenda durável que acorda a persona

## Estado da verificação

Lido nesta etapa: `src/main/scheduler.ts`, `src/main/persona/session.ts`, `src/main/mentions/answer.ts`. Nada foi executado.

Não verificado (a confirmar antes de codar, item 0 da ordem): quem chama `answerMentions` e como monta `MentionDeps`; lista e registro das ferramentas da persona (`persona/tools.ts`, `persona/door.ts`); forma do `ForumMessage`; padrão de IPC/preload/renderer; tipos que listam `window`/`paired`; política de autonomia (#269) e auditoria (#268) na árvore atual; reaproveitamento de sessão pelo motor do Claude; colisão do schema 29.

## O que foi lido e o que decide

- `scheduler.ts`: relógio de 60 s (`tick`), `registerJob(Job)` com `everyMin` e `enabled()`. Um `Job` com `everyMin: 1` roda a cada tick. Não há segundo relógio: a agenda entra como um job.
- `answerMentions(place, message, deps)` não exige sessão viva: cada resposta monta sua própria chamada ao motor. Logo um turno agendado é uma chamada a `answerMentions` com `calls: [persona]` e `door: 'schedule'`. `deps.door` e `createSession({door})` já aceitam texto livre (o comentário diz "open to more (a schedule)").
- Um turno que falha já vira linha `runner.mentionFailed` na conversa e não propaga: atende a regra 7 da spec.

## Decisões

1. **Persistência fora da configuração**: `schedules.json` na pasta de dados do workspace (`ATAS`), escrita atômica `.tmp` + `rename`, como `status.json`. Motivo: não toca `types.ts`/`defaults.ts`/`schema.ts` nem cria passo em STEPS, e evita colisão com o schema 29 do #274. Se a leitura do item 0 mostrar que a config é o padrão obrigatório para dados do usuário, reavaliar (então: passo em STEPS + os três arquivos).
2. **Reuso do relógio**: job `schedules` via `registerJob`, `everyMin: 1`, `enabled()` = agendador ligado nesta sessão do app. Sem confirmação, `enabled()` é falso e nada dispara.
3. **Recorrência**: união discriminada `{ kind: 'every', minutes } | { kind: 'daily', time: 'HH:MM', days: number[] } | { kind: 'once', at: ISO }`, mais `workdaysOnly`. A função de próximo disparo é pura (relógio injetado).
4. **Disparo perdido** (padrão da spec, a confirmar com a pessoa): ao ligar o agendador, todo agendamento ativo com `nextRun <= agora` roda no máximo uma vez, com parâmetro `late` que gera aviso de atraso na conversa; `nextRun` é recalculado a partir de agora (acumulados viram um).
5. **Conversa do resultado**: `thread` guardada no agendamento; a persona o cria na conversa de origem, a tela pede a escolha. O disparo posta uma mensagem de sistema `schedule.fired` (prompt e rótulo "agendamento") e chama `answerMentions`; a resposta da persona é postada com `answersTo` dessa mensagem.
6. **Sem reuso de sessão do motor** (fora de escopo na spec).
7. **Pergunta na partida**: só aparece se houver agendamento ativo; a resposta vale para a sessão do app (não é gravada). A tela tem um interruptor para ligar depois.
8. **Sem escrita nova no host de código**: o disparo só chama o caminho de mensagens já existente; ações da persona passam pelas ferramentas e por Actions como hoje.

## Mudanças (arquivo e função)

Nomes de arquivos novos são propostas; os existentes marcados "(confirmar)" dependem do item 0.

1. `src/main/schedules/core.ts` (novo): tipos `Schedule`, `Recurrence`; `nextRun(rec, from, workdays)`; `isDue(s, now)`; validação de entrada (`validateSchedule`, limita prompt, intervalo mínimo 1 min, persona existente).
2. `src/main/schedules/store.ts` (novo): `createScheduleStore(dir)` com `list/get/create/update/remove/markRan`, escrita atômica, leitura tolerante a arquivo ausente/corrompido (cai para lista vazia sem apagar o original), campos `createdBy` (`user`|persona id) e `updatedAt`.
3. `src/main/schedules/fire.ts` (novo): `fireSchedule(s, deps, {late})`; conjunto `running` por id (regra 5); posta a linha de sistema, chama `answerMentions` com `door: 'schedule'`, atualiza `lastRun/nextRun` em `finally` (falha não pausa).
4. `src/main/schedules/service.ts` (novo): `startSchedules(deps)` registra o job em `scheduler.ts` (`registerJob`); `setEnabled(on)` (ao ligar, dispara os perdidos); `hasActive()`.
5. `src/main/persona/tools.ts` (confirmar): ferramentas `ScheduleList`, `ScheduleCreate`, `ScheduleUpdate`, `ScheduleRemove` seguindo o padrão das ferramentas existentes, com `door` e auditoria como as demais. Uma persona acordada por agendamento não pode criar agendamentos (evita cadeia infinita): recusar quando `session.door === 'schedule'`.
6. `src/main/persona/session.ts`: ajustar o comentário do campo `door` (inclui `schedule`); sem mudança de tipo (é `string`).
7. Tipos de porta com união literal (confirmar, `persona/door.ts` e usos): acrescentar `schedule`.
8. IPC (padrão a confirmar): canais `schedules:list/save/remove/setEnabled`, evento de aplicação `schedulerAsk` para a pergunta de partida; tipos em `src/shared`, handler no main, preload e api do renderer.
9. Renderer: tela "Agendamentos" (lista, formulário, pausar, remover, interruptor do agendador) e diálogo da pergunta na partida; só tokens de tema; textos via `t()` nos dois catálogos; rótulo "agendamento" na mensagem do fórum.
10. Documentação: `docs/` do agendador/persona (confirmar o arquivo), `CHANGELOG.md` em `Unreleased`, `AGENTS.md` só se alguma instrução ficar falsa (não esperado).

## Ordem

0. Confirmar os itens não verificados (chamadores de `answerMentions`, ferramentas, IPC, política).
1. `core.ts` + testes.  2. `store.ts` + testes.  3. `fire.ts` + testes.  4. `service.ts` + ligação no `scheduler.ts`/boot + testes.  5. Ferramentas da persona + testes.  6. IPC + tela + pergunta + catálogos.  7. Docs, CHANGELOG, gates do AGENTS.md.

## Testes (um por comportamento; arquivos em `test/`, com fakes)

| Comportamento | Teste |
|---|---|
| próximo disparo por intervalo, hora do dia + dias, data única, dias úteis | `test/schedules/core.test.ts` |
| entrada inválida recusada (intervalo 0, persona inexistente, prompt vazio) | `test/schedules/core.test.ts` |
| criar/listar/alterar/remover; persiste e relê em nova instância (reinício); arquivo corrompido não perde o original | `test/schedules/store.test.ts` |
| dispara na hora com relógio falso e motor falso; resposta na conversa; `door` = `schedule` | `test/schedules/fire.test.ts` |
| falha do motor: linha de falha na conversa e agendamento segue ativo | `test/schedules/fire.test.ts` |
| mesmo agendamento não roda duas vezes ao mesmo tempo | `test/schedules/fire.test.ts` |
| pausado não dispara; reativado volta | `test/schedules/service.test.ts` |
| agendador desligado: nada dispara; ligar roda perdidos uma vez, com `late`, acumulados viram um | `test/schedules/service.test.ts` |
| job registrado no relógio existente; tarefas antigas intactas | `test/scheduler.test.ts` (confirmar nome) |
| ferramentas da persona listam/criam/removem; remover pela tela some para a persona; persona acordada não cria | `test/persona/scheduleTools.test.ts` |
| ação sujeita a aprovação num disparo fica pendente e auditada com a porta `schedule` | teste de integração com a política (confirmar helper) |
| catálogos nos dois idiomas | `npm run i18n:lint` |

Gates finais (AGENTS.md): `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. Nenhum foi rodado nesta etapa.

## Riscos

- **Persona acorda e cria outro agendamento (laço)**: recusado por porta `schedule`; intervalo mínimo 1 min.
- **Custo de modelo sem a pessoa presente**: só dispara com o agendador ligado na sessão; pergunta na partida; limite de turno e orçamento existentes seguem valendo.
- **Disparo com permissões extras**: o turno usa o mesmo caminho de resposta; verificar no item 0 que a política (#269) e a auditoria (#268) leem a porta e tratam `schedule` como passo autônomo. Se a política hoje só conhece `window`/`paired`, tratar `schedule` como o mais restrito.
- **Arquivo corrompido ou escrita interrompida**: escrita atômica e leitura tolerante.
- **Fuso e horário de verão**: o cálculo usa a hora local como o `scheduler.ts`; teste com datas de virada.
- **Prompt com segredo**: o prompt do agendamento é texto da conversa; a mensagem passa pelo mascaramento já existente da sessão da resposta (confirmar).
- **Conversa apagada**: disparo para thread inexistente é pulado e marcado com erro no agendamento, sem apagar.
- **Colisão com o #274 / schema 29**: evitada por não mexer na config (decisão 1); não verificado se há outra mudança em voo.

## Critérios da spec e cobertura

Cobertos pelos testes acima: 1, 2, 3, 5, 6, 7, 9. O 4 (pergunta na partida) tem a lógica testada no serviço e a tela só por inspeção/teste de renderer, se o repositório tiver o padrão (confirmar). O 8 depende da verificação da política no item 0; se ela não ler a porta, entra um ajuste pequeno no código da política, dito no relatório da implementação.

## Pendências para a pessoa

Não bloqueantes, com padrão adotado: disparo perdido roda uma vez ao abrir com aviso de atraso; resultado na conversa de origem (tela: escolhida).
