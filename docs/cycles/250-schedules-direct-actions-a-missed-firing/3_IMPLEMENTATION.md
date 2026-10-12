# Agendas com ação direta, regra de horário perdido e rotinas do sistema

## O que foi feito, na ordem do plano

1. **Tipos e regras puras** (`src/shared/schedules.ts`, `src/main/schedules/core.ts`)
   - `ScheduleAction` (`persona`, `agent`, `run`, `ceremony`), `ScheduleMissed` (`run` ou `skip`), `waiting` e `lastSkipped`.
   - `prompt` fica como espelho do texto da ação.
   - `DIRECT_CEREMONIES = ['retro']`.
   - `checkAction` recusa a persona como alvo de agente, um agente fora do time, uma referência que não é número, uma cerimônia fora da lista ou desligada, e uma ação sem o texto que ela pede.
   - `ScheduleInput` sem ação vale como "acordar a persona" e "rodar uma vez".
2. **Arquivo** (`store.ts`)
   - `normalise` na leitura: agenda antiga vira persona + rodar uma vez, sem reescrever o arquivo e sem mudar `v`. Uma ação malformada também vira persona.
   - Novos `markSkipped`, `setWaiting` e `setError`.
   - Um `prompt` sozinho vai para a ação que tem texto.
   - Trocar a ação encerra a espera.
3. **Disparo** (`fire.ts`)
   - Pulo: linha `schedule.skipped` com o horário perdido e próximo horário contado a partir de agora.
   - Espera em andamento: `schedule.stillWaiting`, sem abrir uma segunda ação.
   - Persona e agente: linha da agenda + `wake` pela origem `schedule`.
   - Ação direta: `schedule.done`, `schedule.failed` ou `schedule.waiting`.
   - `settle(actionId, …)` encerra a espera quando a proposta é executada, recusada ou deixada de lado.
4. **Executor direto** (novo `direct.ts`)
   - Lista fixa de duas operações: `Runs.start` e `Ceremonies.retroPrepare`.
   - A cerimônia é conferida no momento do disparo.
   - Uma resposta que é proposta pendente em Ações vira espera (`pendingActionOf`).
5. **Identidade (desvio do plano)**
   - Não foi criada a origem `schedule` no rpc nem alargados `Through` e `Who`; o inventário mostrou uns vinte consumidores.
   - O módulo chama `personaDoor.run` com uma sessão da origem `schedule`. É a mesma porta, a mesma política, a mesma linha de auditoria (que registra essa origem) e a mesma linha na conversa. O ato tem a identidade da persona, não a da pessoa.
6. **Atividade**
   - Tipo de nó `schedule`, campo `node.schedule` e estado `skipped`, tratado como final (`isEndState`, `runActive`, `lend`).
   - `awaitingApproval()` em `RunActivity`.
   - `accept()` marca a chamada da persona ou do agente com a agenda.
   - O modelo da árvore mostra o estado pulado e o título do nó de agenda.
7. **Módulo**
   - Monta o executor e a atividade dos disparos e liga `onActionDone`, `onActionRefused` e `onActionSkipped`.
   - Ao abrir, reconcilia as esperas: proposta pendente, em andamento ou com falha continua esperando.
   - Remover uma agenda que espera encerra a espera.
   - Canal de leitura `schedules:routines`.
   - `refuseFromSchedule` não mudou.
8. **Porta da persona**
   - `scheduleCreate` aceita `action:j` e `missed:e[run,skip]`, e `prompt` deixou de ser obrigatório.
   - Nova leitura `Conversations.routines`.
   - Documentação das ferramentas atualizada.
9. **Rotinas e tela**
   - `src/shared/systemRoutines.ts` (puro) e `src/renderer/src/schedulesModel.ts`.
   - `Schedules.tsx`: seletor de ação e da regra de perda, notas de estado, e área só leitura com botão para Configurações. `repo` e `squad` são mantidos ao editar.
10. **Textos e documentação**
    - Chaves novas nos dois idiomas.
    - CHANGELOG (`Unreleased`) e docs/persona.md.

## Decisões e limites encontrados no código

- **Pré-daily não é cerimônia direta.** `sameday:agenda` só lê e precisa dos cartões; não é algo para rodar sozinho.
- **"Pular" vale só para horário anterior ao momento em que o agendador foi ligado** (app fechado ou agendador desligado). Um disparo atrasado por turno longo ou computador dormindo com o app aberto dispara marcado como atrasado. Com o `isLate` do plano, "pular" perderia esses disparos e diria na conversa que o app estava fechado, o que seria falso.
- **`retro:prepare` usa um modelo para escrever a retro** (não para decidir). Com o provedor desse modelo fora, a retro agendada falha e diz isso na conversa. O "provedor fora" testado é o da persona.
- **O Stop da persona também segura as ações diretas**, porque passam pela mesma porta.
- **A lista de rotinas é relida a cada abertura da tela**; o ajuste não emite evento para ela.
- **O nó de agenda abre com o texto genérico "Agent started"** (não corrigido).

## Testes

- `test/schedules-core.test.ts`: cada ação válida e inválida, regra padrão `run`, `skip`, persona recusada como agente.
- `test/schedules-store.test.ts`: arquivo antigo lido sem reescrita, ação malformada, `markSkipped`, espera e falha guardadas, troca de ação encerra a espera, `prompt` só em ação com texto.
- `test/schedules-fire.test.ts`:
  - execução e retro sem turno da persona;
  - motor da persona caindo;
  - agente pela origem `schedule`;
  - falha que segue ativa;
  - espera sem segunda ação, liberada por aprovação e por recusa;
  - `skip` com app fechado;
  - `skip` não pula atraso com o agendador ligado;
  - persona com `skip`;
  - `run` dispara uma vez marcado como atrasado.
- `test/schedules-direct.test.ts` (novo): operação e argumentos certos, cerimônia desligada ou com cartão, nada além das duas operações, proposta pendente vira espera.
- `test/persona-schedules.test.ts`:
  - a persona cria agenda direta com `skip`, e a tela vê o mesmo;
  - turno de agenda não muda agenda;
  - persona recusada como agente;
  - ação direta pela porta real: a recusa é auditada com `door: 'schedule'`;
  - leitura das rotinas.
- `test/activity-schedule.test.ts` (novo) e `test/system-routines.test.ts` (novo).
- `test/schedules-model.test.ts` (novo).
- Contagens fixadas em `test/persona-door-table.test.ts`: 310 canais e 195 operações.
- Fake de `test/mentions-call-line.test.ts` ganhou `awaitingApproval`.

## Verificações rodadas nesta etapa

- `npm ci --no-audit --no-fund --ignore-scripts` (o worktree não tinha `node_modules`).
- `npx tsc --noEmit`: passou.
- `node scripts/theme-audit.mjs`: saiu com 0. `#250` e `#275` em comentários do renderer contavam como cor literal; os comentários foram reescritos.
- `npm run i18n:lint`: passou.
- `node scripts/public-audit.mjs`: passou.
- `npx vitest run` completo: **não fechou verde**.
  - Última rodada: 9028 passaram e 2 falharam por estourar o limite de 5 s (`agent-assist-prompts`, `modules-registered`).
  - Em rodadas anteriores, o arquivo afetado foi outro (`update-script`).
  - Os três passam rodando sozinhos.
  - `modules-registered` leva 2,8 s sozinho, mas falhou uma vez em 5 s rodado junto com só outros dois arquivos.
  - Não houve comparação com a `main` (sem acesso ao `.git`), então não está verificado que essas falhas já existiam antes.

## Não verificado

- A tela de Agendas no app em execução.
- O critério 2 ponta a ponta: nenhuma operação de hoje devolve uma proposta pendente; só há cobertura com porta falsa.
- A execução real de `Runs.start` e da retro a partir de uma agenda (testado só com falso e com a recusa da porta real).
- `electron-vite build`.
