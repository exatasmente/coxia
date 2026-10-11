# A primeira execução

Uma execução leva uma issue pelo ciclo de agentes: uma branch e um worktree próprios, depois um
agente por etapa, uma etapa por vez, até um gate, uma pergunta ou o fim. O que ela escreve fica no
worktree e na conversa da própria execução; o que vai ao host de código espera o seu "sim".

1. Ponha o rótulo de gatilho numa issue, ou aperte **Iniciar o ciclo** no cartão dela em Hoje.
2. O aplicativo lê a issue, faz a branch e copia a issue para a pasta da execução.
3. Cada etapa trabalha e entrega o seu resultado. Onde o processo pede uma decisão, a execução para
   num **gate** e espera você: aprovar, devolver com um motivo, ou mandar de volta a uma etapa.
4. Um agente que não consegue decidir abre uma **pergunta**; você a responde pelo aplicativo ou pelo
   celular.
5. No fim da última etapa que escreve, o envio da branch e o pull request são propostos, e esperam o
   seu "sim" em **Ações**. Nada é enviado sozinho.

Tudo isso — as etapas, a cerca de um agente que escreve, os comandos, o que vai ao host — está em
[O runner](/reference/runner.pt-br).

**O que você deve ver:** a tela da execução com a linha do tempo das etapas, a atividade ao vivo do
agente que está trabalhando, e a proposta esperando você quando ela chega ao fim.

<!-- site:image-placeholder -->
> **Captura (pendente).** Uma execução em andamento, com a linha do tempo das etapas. Sai do
> aplicativo, de um espaço de trabalho semeado com dados fictícios, refeita a cada versão.
