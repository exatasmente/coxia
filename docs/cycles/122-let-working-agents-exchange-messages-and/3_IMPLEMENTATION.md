# Trocar mensagens durante a etapa: a entrega volta ao dev com o que já está de pé

> Nota de implementação. A **maior parte do plano ainda não foi escrita**: a árvore tem os commits 1 e 2 (`EngineRequest.incoming`, a fase de coleta nos dois motores, a caixa da etapa, a fiação da mensagem à etapa). Os commits 3 a 6 — as três ferramentas, a conversa do agente chamado, o dono único do worktree, o uso contado e o bloco `runner.conversations` — **não existem no código**. Os três critérios de aceite principais da issue, portanto, **não podem ser satisfeitos** por esta árvore. Tudo o que não foi exercitado está dito como **não verificado**.

## O que esta passada mudou

Esta tentativa fechou a verificação de tipos e os dois achados de leitura que a revisão anterior marcou como bloqueio, mais uma correção de comportamento da fiação.

### A verificação de tipos fecha

O gate `npx tsc --noEmit` estava vermelho com 7 erros, todos no arquivo de teste novo `test/engine-incoming.test.ts`: o dublê de turnos do pacote estava declarado com um tipo que não servia para lista de turnos de uma chamada, e o alvo passado ao motor não era um `ResolvedRole` completo (faltavam `modelRole`, `envFile`, `options` e `legacyCustomEndpoint`). Os dois foram corrigidos no próprio arquivo de teste; **nenhum erro era do código de produção**. O gate passa agora (saída 0).

### A resposta final da etapa volta a ser pedida ao modelo

O bloqueio real que a revisão encontrou: no motor aberto, quando o modelo terminava um passo sem responder ao formato e a porta de entrada não tinha mais mensagem, o laço **não pedia nada** — marcava `collecting`, escrevia um pedido de resposta final no diálogo e fazia `continue` sem chamada nenhuma; o laço voltava ao topo, chamava o modelo com as mesmas mensagens (só as ferramentas vazias) e era **aquele texto** que passava a valer como resultado da etapa. Como a mensagem entregue descreve o que quem escreveu quer ("use o helper existente"), a resposta que o modelo deu ao pedido da mensagem virava o resultado da etapa — exatamente o que o plano diz que a coleta existe para impedir.

O que o código faz agora, na coleta: pede o final de verdade, numa chamada **sem nenhuma ferramenta** (`tools: []`) com o formato do esquema, e só o que sai **dessa** chamada é o resultado da etapa; um texto fora do esquema ali vira erro de formato, não resultado. A chamada de coleta acontece aqui, e não num passo seguinte do laço, porque responder é o ponto dela: um texto solto que descreve a mensagem nunca vira o resultado da etapa.

### A mensagem repetida ao mesmo agente não perde mais a segunda chamada

A fiação guardava em `toStage` todas as ocorrências do agente que trabalha e removia **todas** elas da chamada paralela. Como hoje `@developer @developer` abre uma chamada por ocorrência (o `calls` é chaveado por mensagem e agente), a segunda ocorrência sumia em silêncio — e a issue diz que só a mensagem a um agente que **não** trabalha mantém o comportamento de hoje, não pede mudança para a repetida.

A fiação agora manda **uma** ocorrência para a fila da etapa e passa o **resto da lista como está** para o caminho paralelo: a segunda menção ao mesmo agente abre a chamada de hoje, como sempre abriu. A menção a um agente que **não** trabalha continua intocada.

## O que foi conferido, e como

Por execução, nesta árvore de trabalho:

| O que | Resultado |
|---|---|
| `npx tsc --noEmit` | **passa**, saída 0 (era vermelho, 7 erros) |
| `test/engine-incoming.test.ts` | **7 de 7**, incluindo o caso novo da coleta |
| `test/engine-open-loop.test.ts`, `test/engine-open-tools.test.ts`, `test/engine-open-e2e.test.ts`, `test/agent-sdk.test.ts` (como `runner-agent.test.ts`), `test/runner-agent.test.ts` | **77 de 77** |
| `test/runner-mention-actions.test.ts`, `test/runner-golden.test.ts`, `test/runner-sandbox.test.ts` | **27 de 27** (o `runner-golden` não moveu) |
| `node scripts/theme-audit.mjs` | passa |
| `npm run i18n:lint` | passa (4061 chaves nas duas línguas) |
| `node scripts/public-audit.mjs` | passa (913 arquivos) |

**O caso de teste novo.** O roteiro do modelo devolve primeiro o texto que responde à mensagem ("vou usar o helper existente"), que **não** é o esquema, e depois a resposta boa. O teste confere que o resultado da etapa é a resposta boa, e que a chamada de coleta — a terceira — **não oferece ferramenta alguma** e carrega a instrução de resposta final. Sem a correção, esse caso era o que o bloqueio descrevia.

**A suíte inteira foi tentada e é instável nesta árvore.** Uma execução completa terminou com 16 falhas em 4 arquivos que a branch **não toca** (`conflict-resolve`, `update-script`, `release-actions`, `runner-release`), sob carga de 223 arquivos em paralelo; rodando só esses quatro arquivos na mesma árvore, **80 de 80 passam**. É a mesma instabilidade que as duas revisões anteriores viram, e não há confirmação de que ela venha desta branch — o resultado da suíte completa continua **inconclusivo** e isso não foi conferido contra a base.

## O que não foi verificado

- **O motor com o SDK real.** Se o pacote aceita uma mensagem de usuário numa sessão em andamento e se a saída estruturada sobrevive a isso: conferido pelos tipos, pelo código do pacote e por um dublê no teste — **nenhum modelo real foi chamado**. O dublê do teste entrega o turno antes de o código de produção pedir a entrega, então o verde dele cobre a mecânica do teste, não o encaixe real.
- **A suíte completa**, como dito acima: instável, resultado inconclusivo.
- **As três ferramentas, a conversa do agente chamado, o dono único do worktree, o uso contado na etapa e o bloco de configuração dos limites**: não implementados (commits 3 a 6). Nada do comportamento de ponta a ponta da issue foi visto funcionando.
- **Os achados de leitura do plano** que a revisão apontou nos caminhos de hoje (a sessão de uma menção sobre o worktree não é só leitura, o commit ignora pastas ligadas por nome sigiloso e a auditoria da limpeza do arquivo de configuração do host): ficam registrados para quem implementar os commits 4 e 5; **não foram mexidos nesta passada**.
