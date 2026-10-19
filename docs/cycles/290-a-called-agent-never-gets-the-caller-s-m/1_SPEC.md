# Especificação: chamada entre agentes que entrega a mensagem e nunca trava a etapa

## O que muda para quem usa

Hoje, quando um agente da equipe chama outro durante uma etapa, o agente chamado não lê o assunto que o chamador enviou: só o vê na conversa, como quem olha de fora. Ele responde que não recebeu, repete a resposta em sessões novas e, se escreve no repositório, pode deixar a etapa parada por mais de uma hora, sem erro e sem alteração, até alguém matar o processo à mão.

Depois da mudança:

- O agente chamado lê o assunto do chamador (e cada mensagem seguinte) como parte do que recebe, na mesma sessão entre os turnos.
- Um chamado que responde sem pedir mais encerra a conversa, em vez de ser chamado de novo sem nada de novo.
- Uma conversa nunca fica esperando por si mesma, nem quando o chamado escreve no repositório.
- Uma conversa sem progresso por um tempo limite termina com uma linha de sistema na conversa dizendo o motivo, e o chamador recebe essa mesma explicação como retorno da chamada.
- Quem acompanha a etapa (a parada da conversa da execução e a tela da execução) consegue parar uma conversa em andamento entre agentes.

## Regras

1. A primeira mensagem do chamador faz parte do que o agente chamado lê no seu primeiro turno.
2. Toda mensagem seguinte do chamador chega ao chamado como parte do que ele lê, dentro da mesma sessão, sem repetir o histórico como se fosse novo.
3. Um turno do chamado que termina sem pedir mais mensagem encerra a conversa; não começa outro turno sem mensagem nova do chamador.
4. A conversa não pode esperar por uma mensagem que só o próprio chamador poderia enviar enquanto ele aguarda a conversa terminar. Vale para chamado que escreve no repositório (`permission: worktree`) e para chamado que só lê. O resultado esperado é que o chamado receba resposta ou um aviso imediato, e a chamada do chamador volte dentro do limite da regra 5. O mecanismo (responder ao chamador ou devolver o aviso na hora ao chamado) é decisão da análise técnica.
5. Uma conversa que não progride (sem mensagem nova, sem trabalho do chamado) por um tempo limite termina. O tempo limite é registrado na conversa como linha de sistema com o motivo, e a chamada do chamador retorna uma mensagem que diz que a conversa terminou por falta de progresso.
6. O encerramento por tempo limite segue o fim normal de uma conversa: o que um chamado que escreve alterou continua sendo registrado junto com a etapa, e a conversa aparece como encerrada.
7. A parada da conversa da execução (e a tela da execução) interrompe uma conversa de agente em andamento e responde que parou algo; sem conversa em andamento, continua respondendo que não havia o que parar.
8. O relógio de ociosidade da etapa (10 minutos) deve continuar valendo: uma conversa travada não pode mantê-lo vivo indefinidamente.

## Fora do escopo

- Mudar o limite de ociosidade da etapa ou o limite de rodadas de uma conversa.
- Mudar quem pode chamar quem (ciclos, limite de conversas por etapa).
- Redesenhar a tela da conversa além do necessário para parar uma conversa e mostrar o motivo do fim.
- Conversas iniciadas por menção ou persona (já têm parada própria).

## Critérios de aceite

Todos com agentes e modelos de mentira, sem rede.

1. Um chamador chama um chamado que escreve, com um assunto. Conferir: o que o chamado lê no primeiro turno contém o assunto.
2. Um chamado que escreve e pede mais mensagem no primeiro turno, com o chamador aguardando. Conferir: a chamada do chamador não trava e volta dentro do limite.
3. Um chamado que responde sem pedir mais. Conferir: roda exatamente um turno e a conversa termina com a linha de encerramento.
4. Uma conversa sem progresso pelo tempo limite. Conferir: termina, a conversa mostra uma linha de sistema com o motivo e a chamada do chamador retorna uma mensagem que diz isso.
5. Uma conversa de agente travada e a parada da conversa da execução. Conferir: a parada responde que parou algo e a conversa termina; sem conversa em andamento, responde que nada havia.
6. Uma mensagem seguinte do chamador. Conferir: o chamado a lê na mesma sessão e a conversa continua normalmente.
7. Conversa com chamado que só lê. Conferir: continua rodando ao lado da etapa, sem regressão nos testes existentes.
8. Uma conversa travada não impede o relógio de ociosidade de disparar. Conferir: com fakes, a etapa expira no limite configurado.

## Perguntas em aberto (não bloqueiam o refino)

- Valor do tempo limite sem progresso da conversa e se é configurável. Sugestão: um valor menor que o da ociosidade da etapa, definido pela análise técnica.
- Causa de o relógio de ociosidade da etapa não ter disparado em 70 minutos. Hipótese, não verificada: cada resposta do chamado entra na caixa de entrada da etapa, e a chegada de mensagem reinicia o relógio; ou a pausa do relógio durante a espera. Confirmar com teste.
- Não foram pesquisadas issues duplicadas no tracker.

## Prioridade sugerida

`priority:high`: regressão da beta; a etapa fica parada sem erro por mais de uma hora e só sai matando o processo à mão; afeta qualquer chamada a um agente que escreve. Sugestão, não definida aqui.

## O que foi verificado

Leitura do código do runner (conversa entre agentes e executor da etapa) confirmou: a primeira mensagem só é postada na conversa e não entra no prompt do chamado; o laço chama novo turno sem esperar o chamador; com chamado que escreve, a chamada aguarda a conversa inteira enquanto a espera do chamado só se alimenta de nova chamada do chamador; as conversas do runner não se registram na parada. Nada foi executado nem reproduzido; os testes ainda não existem.
