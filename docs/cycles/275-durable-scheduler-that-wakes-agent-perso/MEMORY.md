# Memória do ciclo

## Decisões

- Persona e usuário gerenciam os schedules; ao iniciar, o app pergunta se deve executar o scheduler (resposta da pessoa, #12).
- Tipo: pedido de funcionalidade. Spec escrita (1_SPEC.md): agenda persistida em disco, tela + ferramenta da persona, recorrência por intervalo/hora do dia/data única, resultado como mensagem da persona na conversa marcada como "agendamento", falha não pausa o agendamento.
- Prioridade proposta: priority:medium (autonomia da persona; há alternativa manual). Marco: nenhum conhecido.
- Padrões propostos (a confirmar): disparo perdido roda uma vez ao abrir (se agendador ligado) com aviso de atraso; resultado vai na conversa de origem.
- Fora do escopo: gatilho por evento, reuso de sessão do motor, execução com app fechado, cron completo.
- Resposta: A persona e o usuário podem gerenciar os schedules, quando o app iniciar pergunta se deve executar o scheduler <!-- answer:12 -->

## Restrições

- Já existe `src/main/scheduler.ts` (relógio de 60 s, jobs em memória, sem turno de persona nem persistência de definições); reaproveitar em vez de criar outro relógio.
- `src/main/persona/session.ts` createSession tem `door` ("window"/"paired"; aberto a mais, um agendamento).
- Disparo é passo autônomo: segue política (#269) e auditoria (#268).
- Testes com fakes, sem modelo nem rede real; textos nos dois idiomas.

## Tentado e descartado

- CronCreate/ScheduleWakeup da sessão: morrem com a sessão.

## Perguntas abertas

- Confirmar padrões de disparo perdido e conversa do resultado (não bloqueante).
- Não verificado: reaproveitamento de sessão do motor do Claude, turno sem sessão viva ponta a ponta, colisão do schema 29 (#274), sintoma original.

## Onde o trabalho está

- Triagem e refinamento prontos (0_TRIAGE.md, 1_SPEC.md). Próxima: desenho técnico (tl-plataforma): onde persistir, porta de agendamento, ferramenta da persona, tela e pergunta na partida.
- Passagem support → product-owner: Refinamento: definir priority/milestone; especificar persistência dos agendamentos, gerenciamento por persona (ferramenta) e usuário (tela), confirmação de execução do agendador na partida, tratamento de disparo perdido e conversa do resultado. Verificar reaproveitamento de sessão e colisão do schema 29. <!-- handoff:19 -->
