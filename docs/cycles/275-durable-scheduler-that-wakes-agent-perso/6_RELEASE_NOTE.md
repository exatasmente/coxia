# Agendamentos que acordam a persona sozinhos

## O que mudou

O Coxia agora tem uma agenda própria. Um agendamento criado nela fica guardado no computador e acorda a persona na hora marcada, sem depender de nenhuma conversa aberta com o modelo. Antes, os agendamentos criados dentro de uma conversa sumiam quando a conversa terminava e nunca disparavam.

Quando um agendamento dispara, a persona recebe o texto que foi definido e a resposta aparece na conversa do agendamento, identificada como vinda de um agendamento.

## Como usar

1. Abra a nova tela **Agendamentos**.
2. Crie um agendamento: escolha a persona, escreva o texto, defina quando repetir (a cada tantos minutos ou horas, num horário do dia em certos dias da semana, ou uma vez só) e escolha a conversa onde a resposta deve aparecer.
3. Pause, reative, edite ou remova um agendamento quando quiser.
4. A persona também pode listar, criar, alterar e remover agendamentos durante uma conversa; o que ela cria aparece na tela, e o que você remove na tela ela deixa de encontrar.
5. Ao abrir o app com agendamentos ativos, ele pergunta se a agenda deve ser executada nesta sessão. Respondendo "não", nada dispara. Há também um interruptor na tela para ligar depois.

## O que vale saber

- A agenda só dispara com o app aberto e a execução confirmada. Com o app fechado, nada roda.
- Se uma hora marcada passou com o app fechado, o agendamento roda uma única vez ao abrir (se a agenda for ligada) e a mensagem avisa que foi atrasado. Este comportamento é um padrão adotado e ainda pode ser revisto.
- Se um disparo falhar, a falha aparece na conversa e o agendamento continua ativo.
- Um agendamento não roda duas vezes ao mesmo tempo.
- Uma persona acordada por um agendamento não cria nem altera agendamentos, para evitar cadeias sem fim. Só a pessoa liga ou desliga a agenda.
- Fora desta versão: disparo por evento (por exemplo, quando um cartão muda de etapa), reaproveitar a mesma sessão do modelo entre turnos e recorrências no estilo cron completo.
- Conferido com testes automáticos que usam simulações (sem modelo nem rede reais): disparo, persistência após reinício, pausa, disparo perdido e falha. A tela e a pergunta de partida ainda não foram abertas no app rodando. A regra de aprovação para ações de um disparo agendado não tem teste dedicado, e o comportamento com mudança de horário de verão não foi testado.
