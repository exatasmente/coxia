# Memória do ciclo

## Decisões

- Spec (1_SPEC.md): quatro ações (iniciar execução, rodar cerimônia, chamar agente, acordar a persona); as três primeiras sem modelo da persona, pelas mesmas portas/autonomia/auditoria; regra de perda por agenda: rodar uma vez (padrão) ou pular, pulo deixa linha na conversa; migração: agendas antigas = acordar a persona + rodar uma vez; rotinas do sistema só leitura na tela de Agendas, com link; aprovação pendente espera sem expirar e sem segundo disparo igual. Prioridade proposta: medium.
- Plano (2_PLAN.md): `Schedule` ganha `action` (união persona/agent/run/ceremony), `missed` ('run'|'skip') e `waiting`; `prompt` fica como espelho. Migração só na leitura do `schedules.json` (v continua 1, fora de STEPS e dos três arquivos de config).
- Ação direta entra por nova origem `schedule` no rpc (`invokeSchedule`, lista fixa de canais, só com ato aberto de porta `schedule`); mesmo handler de pessoa/persona, nada novo no host de código. Chamar agente reutiliza `wake` (persona recusada como alvo). Cerimônia direta: registro das que rodam sem cartão (retro; pré-daily só se rodar sem a janela, a confirmar).
- Regra de perda avaliada no Firer (`isLate` + `missed==='skip'` → `markSkipped` + linha `schedule.skipped`). Falha não pausa a agenda. Aprovação: `waiting.actionId`, limpa pelos ouvintes de Ações.
- Atividade: nó `schedule` por disparo (estados started/finished/failed/waiting/skipped novo; `runActive` trata skipped como encerrado); disparo da persona já tem nó de chamada, ganha `node.schedule` lido de `message.params.schedule`.
- Rotinas do sistema: função pura `systemRoutines` + canal de leitura `schedules:routines` + linha de leitura na porta da persona; `scheduler.ts` não muda.

## Restrições

- Configurações e comportamento atuais das rotinas do sistema não mudam.
- Agenda não ganha permissão própria; turno vindo de agenda não cria nem muda agendas (`refuseFromSchedule`).
- Sem cron livre, fuso, gatilhos por evento, app fechado.
- Textos nos dois idiomas, cores do tema, testes com relógio falso e falsos. Repositório público: sem nomes/hosts reais.

## Tentado e descartado

- Escrever cerimônia direta para gate e QA: exigem cartão e uma pessoa; fora.
- Tornar as rotinas do sistema editáveis: fora do escopo da spec.

## Perguntas abertas

- Nenhuma bloqueante. Lacuna dita: nenhuma das três ações diretas de hoje devolve proposta pendente em Ações; o critério 2 fica coberto por mecanismo geral e porta falsa, sem caso real ponta a ponta. Prazo de expiração de aprovação e rotinas editáveis seguem sendo decisão nova.
- Não verificado: consumidores de `Through`/`Who`, como `activityTreeModel.ts` mostra papel desconhecido, nome do evento de ajustes, padrão de teste de tela, quais ciclos abertos tocam `doorTable.ts`/`activity.ts`/catálogos.

## Onde o trabalho está

- Plano técnico escrito (2_PLAN.md), só por leitura; nada executado nem testado. Próximo: implementação seguindo a ordem do plano (puros e migração primeiro; inventário de `Through`/`Who` e leitura de `activityTreeModel.ts` antes da identidade e da atividade; confirmar pré-daily sem janela).
- Código de agendas em src/main/schedules (fire, core, service, store, module), tipos em src/shared/schedules.ts, rotinas do sistema em src/main/scheduler.ts, porta da persona em src/main/persona/doorTable.ts e door.ts, rpc em src/main/rpc.ts.
- Passagem support → product-owner: Refinamento: decidir se as agendas do sistema viram editáveis, o que acontece com aprovação pendente sem ninguém presente, o modelo de dados da ação e da regra de perda (com migração padrão "rodar uma vez"), e checar primeiro o que a árvore de atividade já registra de um disparo da #275. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento técnico: modelo de dados da ação e da regra de perda com migração padrão (acordar a persona, rodar uma vez); como cada ação direta entra pelas portas existentes com política e auditoria; como aprovação pendente sem ninguém presente fica visível e impede segundo disparo; verificar primeiro o que a árvore de atividade já registra do disparo da #275 (nenhuma referência a agenda em `src/shared/activity.ts` na leitura); fonte de leitura para as rotinas do sistema (`src/main/scheduler.ts`) sem mudar seu comportamento. <!-- handoff:21 -->
