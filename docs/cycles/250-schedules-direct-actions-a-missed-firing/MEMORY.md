# Memória do ciclo

## Decisões

- Spec (1_SPEC.md): quatro ações (iniciar execução, rodar cerimônia, chamar agente, acordar a persona). As três primeiras rodam sem modelo da persona, pelas mesmas portas, autonomia e auditoria. Regra de perda por agenda: rodar uma vez (padrão) ou pular. Agendas antigas valem como persona + rodar uma vez. Rotinas do sistema só leitura. Aprovação pendente espera sem expirar.
- Implementado (3_IMPLEMENTATION.md):
  - `Schedule` tem `action`, `missed`, `waiting` e `lastSkipped`; `prompt` é espelho da ação.
  - Migração só na leitura (`normalise` em store.ts).
  - Disparo em fire.ts: pulo, ainda aguardando, ação direta, falha; `settle` encerra a espera.
  - Executor em `direct.ts` com lista fixa: `Runs.start`, `Ceremonies.retroPrepare`.
  - Atividade: nó `schedule` com `node.schedule`, estado `skipped` final.
  - Rotinas: `src/shared/systemRoutines.ts` + canal `schedules:routines` + leitura `Conversations.routines`.
- Desvios do plano decididos na implementação:
  - **Identidade:** sem nova origem no rpc (o inventário de `Through`/`Who` deu ~20 consumidores). A ação direta chama `personaDoor.run` com sessão da origem `schedule`: identidade da persona, e a auditoria registra `door: 'schedule'`.
  - **"Pular"** vale só para horário anterior ao momento em que o agendador foi ligado (`onSince` em service.ts). Com `isLate`, um turno longo ou o computador dormindo pulariam por engano.
  - **Pré-daily fora:** `sameday:agenda` só lê e precisa de cartões.

## Restrições

- Configurações e comportamento das rotinas do sistema não mudam (`scheduler.ts` intocado).
- Agenda não ganha permissão própria; turno vindo de agenda não cria nem muda agendas (`refuseFromSchedule`).
- Sem cron livre, fuso, gatilhos por evento ou disparo com o app fechado.
- Textos nos dois idiomas; os catálogos `ui-*` ficam em ordem alfabética e cada chave `ui.*` precisa aparecer literal no renderer.
- Nada de `#NNN` em comentários do renderer: o theme-audit conta como cor literal.
- Textos com "pré-daily" usam `{Ceremony}`/`{ceremony}` (host-terms-leak).

## Tentado e descartado

- Cerimônia direta para gate e QA: exigem cartão e uma pessoa.
- Rotinas do sistema editáveis: fora do escopo.
- Pular por `isLate`: perdia disparos com o app aberto.

## Perguntas abertas

- Nenhuma bloqueante.
- Critério 2 só com porta falsa: nenhuma operação de hoje devolve proposta pendente.
- `retro:prepare` usa um modelo para escrever a retro e falha se o provedor desse modelo cair.
- O Stop da persona também segura as ações diretas.
- O nó de agenda abre com o texto "Agent started".

## Onde o trabalho está

- Implementação feita no worktree.
- Rodados: `npm ci --ignore-scripts`; `npx tsc --noEmit`, theme-audit, `npm run i18n:lint` e public-audit passaram.
- `npx vitest run` completo não fechou verde (9028 passaram, 2 falharam por tempo de 5 s):
  - o arquivo afetado mudou a cada rodada (`agent-assist-prompts`, `modules-registered`, `update-script`), e todos passam sozinhos;
  - `modules-registered` leva 2,8 s sozinho e falhou uma vez em 5 s junto com só outros dois arquivos;
  - sem comparação com a `main`, não está verificado que essas falhas já existiam (ev-1).
- Não verificados: a tela no app e `electron-vite build`.
- Próximo: revisão dos desvios do plano e QA da tela com pasta de dados vazia.
- Passagem developer → revisão: conferir os desvios do plano e os pontos abertos acima; testar a tela de Agendas no app.
- Passagem support → product-owner: Refinamento: decidir se as agendas do sistema viram editáveis, o que acontece com aprovação pendente sem ninguém presente, o modelo de dados da ação e da regra de perda (com migração padrão "rodar uma vez"), e checar primeiro o que a árvore de atividade já registra de um disparo da #275. <!-- handoff:11 -->
- Passagem product-owner → pessoa: Planejamento técnico: modelo de dados da ação e da regra de perda com migração padrão (acordar a persona, rodar uma vez); como cada ação direta entra pelas portas existentes com política e auditoria; como aprovação pendente sem ninguém presente fica visível e impede segundo disparo; verificar primeiro o que a árvore de atividade já registra do disparo da #275 (nenhuma referência a agenda em `src/shared/activity.ts` na leitura); fonte de leitura para as rotinas do sistema (`src/main/scheduler.ts`) sem mudar seu comportamento. <!-- handoff:21 -->
- Passagem tl-plataforma → pessoa: Implementação: seguir 2_PLAN.md na ordem (tipos/regras puras e migração por leitura do arquivo; regra de perda e linhas no disparo; executor direto com origem `schedule` e lista fixa de canais; atividade; módulo; porta da persona; rotinas só leitura e tela; textos e changelog). Antes dos passos de identidade e atividade: inventariar consumidores de `Through`/`Who` e ler `activityTreeModel.ts`. Confirmar no código se o pré-daily roda sem janela antes de incluí-lo. O critério 2 só tem cobertura por porta falsa (nenhuma ação direta de hoje devolve proposta pendente). <!-- handoff:34 -->
