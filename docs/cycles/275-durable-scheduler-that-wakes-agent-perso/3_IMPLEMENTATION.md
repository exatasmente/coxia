# O que foi construído para a agenda que acorda a persona

## Item 0 do plano: o que a leitura confirmou

- `answerMentions` é chamado por `mentions/module.ts` (conversas fora de run), `runner/service.ts` (thread de run) e por ele mesmo (`CallAgent`). Um turno não depende de sessão preexistente: cada resposta abre a sua chamada ao motor.
- As ferramentas da persona são 11 ferramentas com operações numa tabela (`persona/doorTable.ts`). Cada operação chama um canal IPC sob a origem `persona`, dentro de um *act* (`persona/act.ts`) que carrega a porta. A auditoria (`auditoria.ts`) já grava `door: act.door`.
- Não há código de #268/#269 na árvore. A porta não é lida por nenhuma política, só copiada para a auditoria e para a linha do ato. Logo, um disparo não ganha nem perde permissões: usa as mesmas ferramentas, Actions e auditoria de qualquer resposta.
- O padrão de IPC é `ctx.handle` num módulo listado em `modules.ts`. Eventos vão por `ctx.emit({type:'module'})`. O renderer não tem roteador: a tela é um membro de união em `App.tsx`.
- Não existe teste de `scheduler.ts`. O job novo entra por `ctx.job` (= `registerJob`), sem tocar nas tarefas antigas.
- Decisão 1 do plano mantida: persistência fora da config, sem schema novo.

## O que mudou

- `src/shared/schedules.ts`: os tipos (`Schedule`, `Recurrence`, `ScheduleInput`, `SchedulePatch`, `SchedulesView`), os códigos das linhas `schedule.fired`/`schedule.firedLate`, a porta `schedule`, `activeSchedules` e `asksAtStart`.
- `src/main/schedules/core.ts`: `nextRun` puro, para intervalo, hora do dia + dias e data única, com dias úteis. Também `isDue`, `isLate` (≥ 2 min) e a validação, com códigos de erro ligados ao catálogo.
- `src/main/schedules/store.ts`: `schedules.json` em ATAS com escrita atômica (`.tmp` + `rename`). Um arquivo ilegível é posto de lado (`.broken-<ts>`) antes da próxima escrita, nunca sobrescrito. Guarda `createdBy`/`updatedBy`/`updatedAt`. `markRan` conta o próximo disparo a partir de agora, então os acumulados viram um.
- `src/main/schedules/fire.ts`: um disparo por agendamento de cada vez. O próximo horário é marcado antes do turno. O app posta a linha de sistema com o prompt e chama `wake(..., 'schedule')`. A falha aparece na conversa e o agendamento continua ativo. Se a conversa sumiu, o disparo é pulado e marcado com erro.
- `src/main/schedules/service.ts`: o agendador começa desligado. `setEnabled(true)` dispara na hora os perdidos, marcados como atrasados. `tick` ignora o que já está rodando.
- `src/main/schedules/module.ts` (registrado em `modules.ts`): job `schedules` (`everyMin: 1`, `workHoursOnly: false`, `enabled` = agendador ligado). Canais `schedules:list/create/update/remove/setEnabled`. Quem criou é `user` ou o id da persona, conforme o act aberto. Um turno com porta `schedule` não cria nem altera agendamentos.
- `src/main/mentions/module.ts`: o corpo do `subscribe` virou `accept(...)`, sem mudança de comportamento. A nova `wakePersona(message, persona, door)` usa as mesmas linhas, fila por thread e trava do Stop.
- `src/main/persona/act.ts` + `door.ts`: o act guarda `thread` (opcional), para a persona criar o agendamento na conversa de onde fala. O comentário da porta em `session.ts` foi atualizado.
- `src/main/persona/doorTable.ts`, `doorOps.ts`, `toolDocs.ts`: operações `Conversations.schedules` (leitura), `scheduleCreate`, `scheduleUpdate` e `scheduleRemove`. `schedules:setEnabled` fica fora da porta, com o novo motivo de exclusão `scheduler`.
- `src/main/saude.ts`: rótulo da tarefa `schedules`.
- Renderer: `schedulesApi.ts`, tela `screens/Schedules.tsx` (lista, formulário, pausar/reativar, editar, remover com confirmação, interruptor), `SchedulerAsk.tsx` (Sheet na partida, que só aparece com agendamento ativo e sem resposta nesta sessão; fechar vale como "não"), rota em `App.tsx`, linha na navegação (`home.ts`, `dashboard.ts`, ícone em `navIcons.tsx`) e palavras do ato em `actVerbs.ts`.
- Catálogos (en e pt-BR): `main.schedules.error.*`, `main.forum.code.schedule.fired/firedLate`, `main.saude.task.schedules`, `ui.schedules.*`, `ui.chat.act.did.Conversations.schedule*`. Os arquivos `ui-today` e `ui-persona` foram reordenados só para inserir as chaves em ordem; o diff tem apenas inserções.
- Docs: `CHANGELOG.md` (Unreleased/Added) e a tabela das ferramentas em `docs/persona.md` (pt-BR e en). O AGENTS.md não precisou mudar.
- Teste ajustado: `test/persona-door-table.test.ts`, com as contagens fixadas indo de 304→309 canais, 190→194 operações e 114→115 exclusões.

## Testes novos

- `test/schedules-core.test.ts`: próximo disparo por tipo, dias úteis, um único disparo, devido/atrasado, pergunta de partida, entradas inválidas.
- `test/schedules-store.test.ts`: CRUD com autoria; releitura por nova instância (o reinício); pausa e novo ritmo contados de agora; `markRan`; arquivo corrompido preservado.
- `test/schedules-fire.test.ts` (relógio falso, `fakeEngine`, `answerMentions` real):
  - dispara na hora sem sessão: o motor não recebe `resume`, a porta é `schedule` e a resposta tem `answersTo` da linha;
  - falha na conversa sem pausar;
  - não roda duas vezes ao mesmo tempo;
  - conversa sumida;
  - desligado não dispara;
  - pausado e reativado;
  - perdidos disparam uma vez, marcados como atrasados;
  - resposta "não".
- `test/persona-schedules.test.ts` (porta real + módulo):
  - a persona cria na própria conversa e a pessoa vê;
  - a pessoa remove e a persona deixa de encontrar;
  - criado pela pessoa fica marcado `user`;
  - um turno de agendamento é recusado e a recusa é auditada com `door: 'schedule'`;
  - o erro chega em palavras para a persona;
  - o interruptor é só da pessoa, e o job fica ligado ou desligado conforme ele.

## Verificação (rodada nesta etapa)

- `npx tsc --noEmit`: ok.
- `npx vitest run`: 8773 passaram, 15 pulados e 2 falharam, além de 2 arquivos que não carregam. Os quatro arquivos que falham são `browser-contract`, `browser-runtime`, `browser-quit` e `browser-sites`. A causa é `Cannot find module …/node_modules/@playwright/mcp/cli.js`: o pacote não está instalado nesta worktree. Não usam código desta mudança.
- Testes novos e tocados: 167 de 167 passaram (evidência ev-1).
- `node scripts/theme-audit.mjs`: ok. Os comentários com o número da issue no renderer eram lidos como cor literal (`#275`) e foram tirados.
- `npm run i18n:lint`: ok, 6215 chaves nos dois idiomas.
- `node scripts/public-audit.mjs`: ok.

## Não verificado

- A tela e a pergunta de partida no app rodando: não foram abertas nem exercitadas. Só o typecheck e a lógica `asksAtStart` foram testados.
- `electron-vite build`: não rodado.
- Critério 8 (ação sujeita a aprovação fica pendente): segue o caminho existente de Actions; não há teste de integração específico. Está coberto só o carimbo `door: 'schedule'` na auditoria.
- Fuso e horário de verão: o cálculo usa hora local, como o `scheduler.ts`, mas não há teste específico de virada.
- Os testes de navegador que falharam por falta do pacote não foram rodados com o pacote instalado.

## Desvios do plano

- As ferramentas viraram operações da ferramenta `Conversations` existente, e não quatro ferramentas novas. Isso preserva as "onze ferramentas" e o limite de tamanho das descrições.
- Uma persona acordada também não altera agendamentos (o plano dizia "não cria"). Ler e remover continuam permitidos.
- Em vez de um evento `schedulerAsk`, a tela lê `asked` em `schedules:list`. Assim a pergunta sobrevive a uma recarga do renderer.
- O teste de `scheduler.ts` não foi criado: o job entra por `ctx.job`, e o registro foi testado no módulo.
