# Memória do ciclo

## Decisões

- Persona e usuário gerenciam os schedules; ao iniciar, o app pergunta se deve executar o scheduler (resposta da pessoa, #12).
- Tipo: pedido de funcionalidade. Spec (1_SPEC.md): agenda em disco, tela + ferramenta da persona, recorrência por intervalo/hora do dia/data única, resultado como mensagem da persona na conversa marcada "agendamento", falha não pausa.
- Prioridade proposta: priority:medium. Marco: nenhum.
- Plano (2_PLAN.md): store `schedules.json` em ATAS (fora da config: sem passo em STEPS, sem colisão com schema 29); job `schedules` registrado no relógio existente (`registerJob`, everyMin 1, enabled = agendador ligado na sessão); disparo = `answerMentions` com `door: 'schedule'`, sem sessão preexistente; persona acordada não cria agendamento; disparo perdido roda uma vez com aviso `late`; resultado na conversa guardada no agendamento; pergunta de partida só com agendamentos ativos, resposta vale só na sessão.
- Padrões adotados (a confirmar com a pessoa, não bloqueante): disparo perdido roda uma vez ao abrir; conversa de origem.
- Resposta: A persona e o usuário podem gerenciar os schedules, quando o app iniciar pergunta se deve executar o scheduler <!-- answer:12 -->

## Restrições

- Existe `src/main/scheduler.ts` (tick 60 s, jobs em memória): reaproveitar.
- `answerMentions` (src/main/mentions/answer.ts) não exige sessão viva; `createSession`/`deps.door` aceitam texto livre.
- Disparo é passo autônomo: política (#269) e auditoria (#268) valem; nenhuma escrita nova no host de código.
- Testes com fakes; textos nos dois idiomas; repositório público (sem nomes reais).

## Tentado e descartado

- CronCreate/ScheduleWakeup da sessão: morrem com a sessão.
- Guardar na config: descartado por exigir migração e arriscar colisão com schema 29 (reavaliar se o repo exigir).

## Perguntas abertas

- Não verificado: chamadores de answerMentions e MentionDeps, ferramentas da persona (tools.ts/door.ts), padrão de IPC/tela, uniões literais de door, se #268/#269 leem a porta, reaproveitamento de sessão do motor Claude, colisão do schema 29, sintoma original. O plano manda confirmar tudo no item 0 antes de codar.

## Onde o trabalho está

- Triagem, spec e plano prontos (0_TRIAGE, 1_SPEC, 2_PLAN). Próxima: developer executa o plano, começando pelo item 0 de verificação.
- Passagem support → product-owner: Refinamento: definir priority/milestone; especificar persistência dos agendamentos, gerenciamento por persona (ferramenta) e usuário (tela), confirmação de execução do agendador na partida, tratamento de disparo perdido e conversa do resultado. Verificar reaproveitamento de sessão e colisão do schema 29. <!-- handoff:19 -->
- Passagem product-owner → pessoa: Tech lead plataforma: desenhar a solução reaproveitando o agendador existente (src/main/scheduler.ts) e a porta de agendamento do turno da persona; verificar (1) se um turno de persona abre sem sessão viva e se o motor do Claude reaproveita sessão, (2) onde persistir as definições e se isso muda o schema de configuração (colisão com o schema 29 do #274), (3) interação com as políticas #268/#269. Confirmar com a pessoa o padrão de disparo perdido e conversa do resultado. <!-- handoff:29 -->
