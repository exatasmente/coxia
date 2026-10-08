# A memória das atividades passa a ser compartilhada entre execuções

## O que mudou

Antes, um agente só sabia do que acontecia na execução em que foi chamado. A memória do trabalho era presa a uma execução e a um repositório de trabalho: um agente chamado em outra conversa — ou chamado de fora da execução — não sabia de nada do que já estava em andamento, e chegava a responder que não havia trabalho quando havia.

Agora o aplicativo mantém um registro das atividades do espaço de trabalho, um item por atividade, que fica fora de todo repositório de trabalho e por isso não aparece em commits nem em pedidos de integração do trabalho. Cada item do registro diz: qual é a atividade, em que etapa do ciclo ela está, que agente está trabalhando nela (e qual mexeu por último), as decisões já tomadas, as perguntas em aberto, onde o trabalho parou e o instante da última atualização. Uma atividade com duas execuções — devolvida e recomeçada — é um item só.

O registro é escrito pelo próprio aplicativo, a partir do que acontece nas execuções; os agentes o consultam, mas nunca o escrevem. Ele sobrevive a fechar e reabrir o aplicativo.

## Como usar

- **Perguntar a um agente o que está acontecendo.** Em qualquer conversa onde se fala com agentes — a conversa de uma execução, o canal de um squad, a conversa geral ou a conversa direta de um agente —, ao mencionar a atividade (pela referência, pelo título ou pelo número) o agente recebe o item inteiro dela e responde em que etapa está e quem está trabalhando. Ao mencionar um agente pelo nome, ele responde em que atividade aquele agente está e onde parou.
- **Perguntar sem nomear nada.** O agente recebe uma lista curta do que está em andamento agora — uma linha por atividade — e pode abrir um item inteiro se a pessoa nomear a atividade.
- **Ver o registro sem gastar nenhuma chamada de modelo.** Na tela que lista as execuções há uma seção com as atividades do registro: referência, título, etapa, agente e onde parou.
- **Corrigir um item.** Na mesma tela, cada item abre uma folha de edição; o que a pessoa escreve fica marcado como correção da pessoa e vale para quem consultar depois, até a atividade andar de novo e o aplicativo reescrever com as palavras dele.
- **Continuar o trabalho depois de reiniciar.** Fechar e reabrir o aplicativo não apaga o registro; uma atividade retomada aparece com o mesmo "onde parou" de antes.

## O que vale saber

- O item do registro de uma atividade nunca é apagado sozinho. O que está encerrado há muito tempo aparece como *provavelmente encerrado*, junto do que ele registra, e nunca como trabalho do presente.
- A memória de cada execução (a que as etapas de uma atividade leem e atualizam) continua existindo como era; o registro compartilhado é um adicional, não uma substituição.
- O que uma mensagem nomeia define o que o agente vê: nomear outra atividade que a pessoa não abriu não abre o registro inteiro — a lista curta do que está em andamento cobre o essencial.
- Três comportamentos ficaram conhecidos nas conferências desta entrega e não bloqueiam o uso, mas cabem conserto próprio: uma mensagem que já traz a frase do aviso ao agente que trabalha pode receber o aviso uma segunda vez; uma correção da pessoa é substituída por completo quando a atividade anda de novo (inclusive o texto dela); e o corte do registro por nome de agente foi verificado, mas ainda não está preso por um teste permanente. Não verificado nesta entrega: dois agentes respondendo ao mesmo tempo num ambiente em execução real, e a resposta de um agente contra um modelo real — o que a entrega muda foi conferido por testes automatizados e pela tela do aplicativo sobre uma pasta de dados de teste.
