# A mensagem já na fila passa a ser entregue ao fim de cada passo, e o relógio da etapa volta a bater

Esta passada corrige, no que já existe de código, os achados que a revisão anterior apontou no motor e no relógio da etapa. O que ainda não existe está dito no fim, e nada do que não foi exercitado aparece aqui como feito.

## O que mudou

### A porta da mensagem passa a ser consultada ao fim de cada passo do modelo

Antes, a porta só era consultada quando o modelo devolvia um texto que **não** seguia o esquema. Num passo em que o modelo já terminava respondendo ao formato — que é o caso comum —, a etapa acabava ali e a mensagem que já estava na fila não era entregue ao agente nem anunciada na conversa: a etapa terminava com um resultado que não a considerou, e nada dizia que ela chegou.

Agora, quando o modelo termina um passo e não chamou ferramenta de resposta, a porta é consultada **antes** de qualquer conclusão: se há mensagem, ela entra no diálogo como turno de usuário e a etapa segue; se não há, a chamada de coleta pede a resposta final. Isso vale nos dois motores — no motor aberto no laço de `src/main/engine/open/loop.ts` e no motor do SDK em `src/main/agents.ts`, onde a porta passou a ser consultada na mensagem de resultado, antes de olhar se aquele turno trouxe a saída estruturada.

### A coleta é a última palavra do diálogo

A chamada que pede a resposta final era feita antes de a porta ser consultada, e o laço voltava a consultá-la depois: uma mensagem que chegasse naquela janela entrava na sessão **depois** de o modelo já ter dado a resposta final — a ordem contrária à que o plano fixa. Agora a coleta é uma chamada só, sem ferramenta alguma e com o formato do esquema, e é ela que fecha o diálogo: o motor não consulta mais a porta depois dela, e no ramo do SDK a sessão de entrada é fechada logo que a instrução de resposta final entra, para que nenhum turno de usuário seja empurrado para um diálogo já encerrado.

### A rodada de correção quando o texto não segue o esquema

Uma etapa com porta deixou de ter a ferramenta de resposta final entre as oferecidas (só as ferramentas da própria etapa), porque é a chamada sem ferramenta alguma que fecha o diálogo. Quando o texto do passo e o texto da coleta não seguem o esquema, os erros voltam ao modelo no próprio diálogo e há uma rodada para corrigi-lo — antes, nesse caminho, a etapa podia terminar com erro no primeiro texto que o modelo escrevesse.

### O relógio da etapa bate enquanto o agente espera a pessoa

Enquanto um comando que precisa da autorização da pessoa espera a resposta, os relógios daquele passo param, mas essa pausa não chegava ao relógio de ociosidade da etapa. Com a mensagem podendo entrar nesse ponto do passo, a etapa passou a poder ser encerrada como se o agente tivesse ficado sem dar sinal, só porque a pessoa demorou a responder. Agora a entrega da mensagem conta como sinal de vida do agente e o relógio de ociosidade da etapa é batido com ela.

### A mensagem que pergunta e não é vista diz isso na conversa

A mensagem do agente que trabalha vai para a fila com a marca de que quem a escreveu espera resposta (um sinal de interrogação no fim das palavras da pessoa). Quando a etapa já começou a fechar, a linha da conversa diz que ela não foi vista e indica o caminho que a pessoa tem: devolver a etapa com a mensagem como nota. Antes, as duas situações — um aviso e uma pergunta — eram ditas do mesmo jeito.

## O que foi conferido, e como

Por execução, nesta árvore de trabalho:

| O que | Resultado |
|---|---|
| `npx tsc --noEmit` | **passa**, saída 0 |
| `test/engine-incoming.test.ts` | **10 de 12** — os dois casos novos do motor aberto terminam por tempo limite (ver abaixo) |
| `test/runner-mention-actions.test.ts` | **6 de 6** — o caminho de hoje de uma menção a um agente que não trabalha não mudou |

**Os dois casos que não passam.** Os casos novos que fixam a entrega de uma mensagem já na fila e a rodada de correção usam um roteiro de servidor de mentira que responde em fluxo a uma chamada que o motor pediu sem fluxo; por isso a chamada não termina e o caso estoura o tempo limite. É um defeito do roteiro do teste, não do código de produção — mas, como os dois casos não rodam, o comportamento que eles deveriam fixar **não está confirmado por execução**.

## O que não foi verificado

- **O motor com o SDK real.** Não foi chamado nenhum modelo real; a conferência do encaixe da mensagem numa sessão em andamento foi por leitura do código e por um dublê no teste.
- **A suíte completa, a auditoria de tema, o lint das duas línguas e a auditoria pública:** não foram rodados depois destas mudanças.
- **O sandbox real** com a conversa sobre o worktree e a **corrida entre escritores:** não exercitados.
- **As três ferramentas, a conversa do agente chamado, o dono único do worktree, o uso contado na etapa e o bloco de configuração dos limites:** continuam sem existir no código (commits 3 a 6 do plano). Os três critérios de aceite principais da issue — o desenvolvedor mandar uma nota de andamento, chamar o QA numa conversa nova com o QA rodando comando, e o agente chamado mudar arquivo sem dois escritores — **não podem ser satisfeitos** por esta árvore.
- **Os dois casos de teste novos do motor aberto**, como dito acima: não chegaram a rodar até o fim.
- **O aviso de espera repetido** e o caso em que a mensagem chega a uma execução que não está trabalhando: o comportamento foi preservado, mas não exercitado nesta passada.
