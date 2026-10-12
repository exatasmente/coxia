# Agendamentos que acordam a persona sozinhos

## O que muda para quem usa

Hoje, um agendamento criado numa conversa morre junto com a sessão que o criou: o job some, nada dispara. Passa a existir uma agenda do próprio app, guardada em disco, que acorda uma persona na hora marcada, mesmo com nenhuma sessão aberta e depois de o app ser fechado e reaberto.

- A pessoa vê e gerencia os agendamentos numa tela do app (criar, listar, alterar, pausar, remover).
- A persona também pode criar, listar, alterar e remover agendamentos durante uma conversa.
- Ao abrir o app, ele pergunta se a agenda deve ser executada nesta sessão. Sem a confirmação, nada dispara.
- Quando um agendamento dispara, a persona recebe um turno com o prompt definido e a resposta aparece na conversa.

## Regras

1. Um agendamento tem: persona, prompt, recorrência (ou data única), estado (ativo/pausado) e a conversa onde o resultado aparece.
2. Recorrência: intervalo fixo (a cada N minutos/horas) e hora do dia com dias da semana; uma execução única numa data/hora também é permitida. Respeita o horário e os dias de trabalho do workspace quando o agendamento assim pedir.
3. Os agendamentos persistem em disco e sobrevivem a reinício do app; não dependem de nenhuma sessão de modelo.
4. Ao iniciar, o app pergunta se o agendador deve ser executado. Resposta "não": nenhum agendamento dispara até a pessoa ligá-lo. Se não houver agendamento ativo, a pergunta não aparece.
5. Só o app com o agendador ligado dispara; nunca duas execuções do mesmo agendamento ao mesmo tempo (um disparo que ainda roda não é repetido).
6. O disparo inicia um turno da persona como se viesse de uma nova entrada "agendamento", sem exigir sessão preexistente, com o prompt do agendamento.
7. O resultado (ou a falha) aparece como mensagem da persona na conversa do agendamento, identificada como vinda de um agendamento; a falha não apaga nem pausa o agendamento.
8. Persona e usuário gerenciam os mesmos agendamentos; cada um mostra quem criou e quando foi alterado por último.
9. O que a persona pode fazer num disparo segue a política de autonomia e a auditoria dos passos autônomos do workspace; um disparo não ganha permissões extras.
10. Disparo perdido (app fechado na hora marcada): proposta padrão, a confirmar, é rodar no máximo uma vez ao abrir, se o app foi aberto com o agendador ligado, e avisar que foi atrasado; disparos acumulados do mesmo agendamento viram um só.
11. As tarefas internas já existentes do agendador (status, avisos de pré-daily e retro) continuam como estão e usam o mesmo relógio.
12. Textos novos nos dois idiomas; testes com fakes, sem modelo nem rede reais.

## Fora do escopo

- Disparar por evento (gatilhos como "card mudou de etapa"): a issue cita "and/or event trigger"; fica para depois.
- Reaproveitar a mesma sessão do motor entre turnos (a issue diz "optionally").
- Execução com o app fechado ou em outra máquina (serviço em segundo plano).
- Mudança no fallback de orçamento da CLI (#262/#274).
- Expressões de recorrência completas (cron arbitrário).

## Critérios de aceite

1. Criar na tela um agendamento recorrente (ex.: a cada 5 min) para uma persona, com o app aberto e o agendador ligado, sem nenhuma sessão aberta: no horário, a mensagem da persona aparece na conversa escolhida, marcada como vinda de agendamento.
2. A persona cria um agendamento pedindo numa conversa; ele aparece na tela. Remover pela tela faz a persona não o encontrar mais ao listar.
3. Fechar e reabrir o app: os agendamentos continuam na lista com o mesmo estado.
4. Ao abrir o app com agendamentos ativos, aparece a pergunta sobre executar o agendador; responder "não" mantém tudo sem disparar, mesmo passando da hora; responder "sim" faz disparar.
5. Agendamento pausado não dispara; reativado volta a disparar.
6. Com o app fechado na hora marcada e reaberto com "sim": dispara uma única vez, com aviso de atraso (conforme regra 10, se confirmada).
7. Turno que falha mostra a falha na conversa e o agendamento continua ativo.
8. Disparo agendado que tenta ação sujeita a aprovação fica pendente de aprovação, como qualquer passo autônomo, e aparece na auditoria.
9. Os testes automáticos cobrem criar/listar/alterar/remover, persistência, disparo e disparo perdido com relógio e modelo falsos; as verificações padrão do projeto passam.

## Perguntas em aberto

Nenhuma bloqueia o início; duas decisões de escopo precisam da pessoa e têm padrão proposto:

1. Disparo perdido: confirmar o padrão da regra 10 (rodar uma vez ao abrir) ou descartar.
2. Conversa do resultado: padrão proposto é a conversa de onde o agendamento foi criado (para criação pela tela, a pessoa escolhe a conversa).

Não verificado nesta etapa: o sintoma original (jobs que não disparam), se o motor do Claude reaproveita sessão entre turnos, se o schema 29 de configuração do #274 colide com mudança de configuração desta issue, e a relação detalhada com #268/#269. Verificado por leitura: o agendador atual não guarda definições em disco nem inicia turno de persona, e o turno da persona já tem um campo de porta que prevê um agendamento.
