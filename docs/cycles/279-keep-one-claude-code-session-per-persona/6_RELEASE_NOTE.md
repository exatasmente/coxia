# A conversa com a persona agora continua a mesma sessão do Claude Code

## O que mudou

Ao conversar com a persona usando o Claude Code já logado na máquina (provedor `anthropic` sem chave), cada mensagem abria uma sessão nova. Uma conversa de dez mensagens deixava dez sessões acumuladas. Agora uma conversa usa uma única sessão: a resposta seguinte continua a da resposta anterior, enquanto ela ainda servir.

O mesmo vale para quando um agendamento acorda a persona e para a resposta que ela dá depois de uma parada.

## Como usar

Não há nada a configurar. Basta conversar com a persona como antes. A sessão fica guardada por conversa e continua valendo depois de reiniciar o app. Conversas diferentes têm sessões diferentes.

## O que vale saber

- Se a sessão não puder ser continuada (foi removida, expirou, está em uso por outro processo ou o provedor da persona mudou), a resposta abre uma sessão nova e a conversa segue normalmente, sem erro e sem pergunta.
- Numa sessão nova, a persona recebe a conversa como antes, então não perde contexto.
- Numa sessão continuada, a persona recebe só o que foi dito depois da última resposta dela, para não repetir o que a sessão já tem.
- O motor `open`, a cópia de teste da persona e as demais conversas ficam como eram.
- Ferramentas, porta, parada e auditoria da persona não mudaram.
- Conferido com testes automáticos usando um Claude Code simulado. Não foi conferido com o Claude Code real: a contagem de sessões na máquina e o que o Claude Code responde quando uma sessão foi removida ficam sem verificação.
- Sessões muito longas não têm limite novo; como o Claude Code lida com elas não foi verificado.
