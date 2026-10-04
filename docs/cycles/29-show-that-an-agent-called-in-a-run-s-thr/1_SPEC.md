# O aviso de que um agente chamado está trabalhando

## O que muda para quem usa

Hoje, entre a mensagem que chama um agente com `@` na conversa de uma execução e a resposta dele, nada na tela diz se o chamado foi recebido, se está rodando ou se perdeu. Depois desta mudança o chamado mostra que está vivo, e a mesma informação aparece na conversa, na tela da execução, no quadro de tarefas e no navegador pareado.

**Na conversa.** Logo abaixo da mensagem que fez o chamado aparece, para cada agente chamado, uma linha transitória: primeiro ela diz que o agente está trabalhando (por exemplo, "@desenvolvedor está lendo…") e em seguida mostra o passo ao vivo (por exemplo, lendo um arquivo). A linha sai quando chega a resposta daquele agente ou a mensagem de que o chamado falhou; nos dois casos o que fica é o de sempre — a resposta do agente ou o aviso de falha. Um chamado que ainda espera a vez avisa que está esperando o chamado anterior.

**Na tela da execução.** O painel de atividade ao vivo passa a aparecer enquanto um chamado está rodando, qualquer que seja a situação da execução — inclusive quando ela espera num portão ou numa pergunta, que é quando o chamado costuma acontecer — com o nome do agente chamado à frente.

**No quadro de tarefas.** A entrada do chamado deixa de ser o "Agente" genérico: ela nomeia o agente e a execução, e abrir a entrada leva à conversa daquela execução.

**No navegador pareado (PWA).** O mesmo das três anteriores, porque a conversa e a tela da execução já funcionam lá.

## Regras

1. **Continua somente leitura.** O chamado por `@` não ganha nenhuma escrita no repositório; o aviso só relata o que acontece.
2. **Os limites de sempre continuam.** O chamado mantém os limites de silêncio e de tempo já configurados para a etapa; o aviso não os estende nem os suspende.
3. **Um chamado por vez, por execução.** Enquanto um chamado roda, o seguinte espera a vez, e o aviso do que espera diz que está esperando o anterior. A ordem é a da chegada.
4. **No máximo três agentes por mensagem**, como hoje: cada um com a sua linha e o seu fim próprios.
5. **O aviso mostra só o que o registro de atividade já mostra**: rótulos curtos (o nome de uma ferramenta, um trecho da fala do agente, um estado). Nada de conteúdo de arquivo, resultado de ferramenta ou ambiente.
6. **`@` só chama agente na conversa de uma execução.** Em canais e conversas gerais ele é texto comum — isso não muda.

## Fora do escopo

- A dica no campo de escrita quando o `@` é digitado num canal ou numa conversa geral (a issue a menciona como possibilidade). Fica para outra mudança.
- Chamados em paralelo, ou mais de três agentes por mensagem.
- Guardar o aviso no histórico: ele é transitório e não vira mensagem da conversa.
- O aviso de fim do chamado fora da tela (notificação do sistema, aviso passageiro): o que existe hoje para as tarefas nomeadas não muda.

## Critérios de aceite

1. Com a execução parada num portão (ou numa pergunta), uma mensagem que chama um agente com `@` faz aparecer, logo abaixo dela, uma linha que diz que aquele agente está trabalhando.
2. A linha passa a mostrar o passo ao vivo do agente (por exemplo, um arquivo sendo lido).
3. Quando a resposta do agente chega, a linha sai e a resposta fica na conversa.
4. Quando o chamado falha, a linha sai e o aviso de falha fica na conversa.
5. Uma mensagem que chama dois agentes mostra uma linha para cada; cada linha some com a resposta ou a falha do seu agente.
6. Uma segunda mensagem que chama um agente enquanto o primeiro chamado roda mostra, na linha do segundo, que ele está esperando; ele só começa depois que o primeiro termina.
7. Na tela da execução, com a execução num portão, o painel de atividade aparece enquanto o chamado roda, com o nome do agente chamado.
8. No quadro de tarefas, a entrada daquele chamado traz o nome do agente e o da execução, e abrir a entrada vai para a conversa da execução.
9. O mesmo se confere no navegador pareado.
10. A linha e o painel não mostram nada além dos rótulos curtos que o registro de atividade já mostra.
11. O chamado termina sem nenhuma escrita no repositório e respeitando os limites de tempo e de silêncio.

## Como foi conferido

Nesta etapa só o código foi lido: nenhuma tela foi aberta e nenhum fluxo foi executado. Conferido na leitura: o chamado por `@` roda sob o contexto de atividade da execução e chega ao quadro de tarefas como uma entrada genérica, sem o nome do agente nem vínculo com a execução; o painel de atividade da tela da execução só aparece enquanto a execução está trabalhando; os chamados de uma execução são enfileirados um por vez, no máximo três por mensagem; em canais e conversas gerais o `@` não chama agente. Não verificado em tela: o comportamento real nas quatro superfícies (conversa, tela da execução, quadro de tarefas e navegador pareado).
