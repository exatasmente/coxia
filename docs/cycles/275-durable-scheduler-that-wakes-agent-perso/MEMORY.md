# Memória do ciclo

## Decisões

- Persona e usuário podem gerenciar os schedules; ao iniciar, o app pergunta se deve executar o scheduler (resposta da pessoa, #12).
- Tipo: pedido de funcionalidade; compreensível como escrito (só lido).
- Resposta: A persona e o usuário podem gerenciar os schedules, quando o app iniciar pergunta se deve executar o scheduler <!-- answer:12 -->

## Restrições

- Já existe `src/main/scheduler.ts` (relógio de 60 s, jobs em memória, sem turno de persona nem persistência de definições); reaproveitar em vez de criar outro relógio.
- Testes com fakes, sem modelo nem rede real.

## Tentado e descartado

- CronCreate/ScheduleWakeup da sessão: morrem com a sessão.

## Perguntas abertas

- Disparo perdido com o app fechado: rodar ao abrir ou descartar (a pergunta na partida pode cobrir).
- Formato da recorrência; conversa onde o resultado aparece.
- Reaproveitamento de sessão do motor do Claude e colisão do schema 29 (#274): não verificados.

## Onde o trabalho está

- Triagem pronta (0_TRIAGE.md). Sugestão: priority:medium, squad plataforma. Próxima: refinamento do produto.
