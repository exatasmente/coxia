# Memória do ciclo

## Decisões

- Spec (1_SPEC.md) escrita. Quatro ações: iniciar execução, rodar cerimônia, chamar agente, acordar a persona; as três primeiras sem modelo, pelas mesmas portas/autonomia/auditoria.
- Regra de perda por agenda: rodar uma vez (padrão) ou pular; pulo deixa linha na conversa.
- Migração: agendas existentes = acordar a persona + rodar uma vez.
- Rotinas do sistema: só leitura na tela de Agendas, com link; não viram editáveis nesta entrega.
- Aprovação pendente: espera como à mão, sem expirar; sem segundo disparo igual enquanto espera.
- Prioridade proposta: medium.

## Restrições

- Configurações e comportamento atuais das rotinas do sistema não mudam.
- Agenda não ganha permissão própria; turno vindo de agenda não cria agendas.
- Sem cron livre, fuso, gatilhos por evento, app fechado.
- Textos nos dois idiomas, cores do tema, testes com relógio falso e falsos.

## Tentado e descartado

- Nada.

## Perguntas abertas

- Nenhuma bloqueante. Se a pessoa quiser rotinas editáveis ou prazo de expiração de aprovação, é decisão nova.

## Onde o trabalho está

- Refinamento concluído por leitura (nada executado). Próximo: planejamento técnico. Não verificado: o que a árvore de atividade mostra hoje de um disparo (sem referência a agenda em src/shared/activity.ts); conferir primeiro. Código de agendas em src/main/schedules (fire.ts, core.ts, service.ts, store.ts, module.ts), tipos em src/shared/schedules.ts, rotinas do sistema em src/main/scheduler.ts.
- Passagem support → product-owner: Refinamento: decidir se as agendas do sistema viram editáveis, o que acontece com aprovação pendente sem ninguém presente, o modelo de dados da ação e da regra de perda (com migração padrão "rodar uma vez"), e checar primeiro o que a árvore de atividade já registra de um disparo da #275. <!-- handoff:11 -->
