# Os agentes de uma execução trocam mensagens e se chamam enquanto trabalham

## O que mudou

Uma etapa que um agente está trabalhando deixa de ser um bloco fechado. Antes, a única forma de o time trocar informação durante a execução era a pergunta que parava a etapa, a menção que respondia numa cópia descartável do código, ou esperar o fim da etapa. Agora:

- **O agente recebe mensagens enquanto trabalha.** Escrever `@` para o agente que está trabalhando, na conversa da execução, entrega a mensagem a ele **durante** a etapa, no próximo ponto entre dois passos, **sem a etapa recomeçar**. A tela mostra que a mensagem foi entregue (e quando) ou que ela espera o próximo passo. Um `@` para um agente que **não** está trabalhando mantém o comportamento de hoje (contínua chamando aquele agente para responder).
- **O agente manda mensagem sem encerrar a etapa.** Com a ferramenta de mensagem, ele publica na conversa da execução uma nota de andamento, uma descoberta ou uma pergunta que não precisa parar o trabalho — para a pessoa, para um agente ou para todos — e segue trabalhando. Uma pergunta que bloqueia continua pelo caminho de sempre (a etapa pausa).
- **O agente chama outro agente para discutir um ponto.** Com a ferramenta de chamada, ele abre uma conversa com outro agente do time — na conversa da execução ou numa conversa própria do fórum ligada a ela (a tela liga as duas nos dois sentidos) — e os dois vão e voltam, dentro de um limite. O agente chamado responde na conversa, e cada resposta chega ao agente que o chamou como mensagem (como acima).
- **O que o agente chamado pode fazer segue as permissões dele no time, nunca mais.** Ele começa lendo; quando o ponto exige, pode rodar os comandos dele (na sandbox da execução) e, com permissão para mudar arquivos, mudar arquivos — **sem nunca dois agentes escrevendo no mesmo trabalho ao mesmo tempo**. O trabalho e os comandos dele aparecem na execução **sob o nome dele**, e o que ele muda fica commitado com a etapa que o chamou. O que exige a decisão da pessoa (um comando que precisa do seu sim, uma escrita externa, um push) continua esperando a pessoa, como numa etapa.
- **Há limites, e eles seguram a conversa.** Uma conversa aceita até **6 mensagens de cada lado** por padrão e uma etapa abre até **3 conversas** por padrão; os dois números são configuráveis no workspace. Uma conversa que passa do limite de rodadas, ou uma cadeia de agentes que se chamariam em ciclo, é interrompida e a própria conversa diz por quê. O uso do modelo de uma chamada conta na etapa de quem chamou, e os relógios da etapa continuam andando.

## Como usar

1. Enquanto uma etapa trabalha, escreva `@` seguido do nome do agente e a mensagem na conversa da execução. A mensagem chega a ele no próximo passo, e a tela mostra que foi entregue ou que está esperando; a etapa não recomeça.
2. Se o agente mandar uma nota com a ferramenta de mensagem, ela aparece na conversa da execução na hora, sem a etapa parar.
3. Se o agente abrir uma conversa com outro agente, a conversa aparece ligada à execução; você vê as mensagens ao vivo e pode escrever nela. Um `@` seu continua chamando quem não está trabalhando, como antes.
4. Se uma mensagem sua chegar quando a etapa já estava terminando, a etapa fecha com o que já tinha e a mensagem volta como mensagem na conversa, dizendo que não foi vista; a etapa não recomeça por causa disso.

## O que vale saber

- Os limites das conversas (6 rodadas por conversa e 3 conversas por etapa, por padrão) ficam nas configurações do runner do workspace, e valem os padrões quando um arquivo guardado não os tem.
- Uma pergunta que bloqueia continua exatamente como era: ela para a etapa e a etapa seguinte recomeça com a pergunta e a resposta. A novidade é o caminho que **não** bloqueia.
- Nada do que um agente troca por esses caminhos sai para o repositório de código por si; só o que a saída da etapa publica. O que um agente chamado muda é commitado com a etapa que o chamou.
- **Não verificado:** o comportamento foi conferido com modelos e sandbox de mentira nos testes e pelos portões do repositório (tipos, a suíte inteira, tema, traduções, auditoria pública). Não foi observado ainda um modelo real recebendo uma mensagem no meio de uma sessão já em andamento, o sandbox de verdade para uma conversa com comandos, as telas do uso e da revisão, nem o fluxo inteiro com o aplicativo aberto de uma pessoa escrevendo `@` e a mensagem chegando ao agente que trabalha — é o que a avaliação em uso deve mostrar.
