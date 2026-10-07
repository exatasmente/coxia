# A etapa ganha as duas ferramentas de conversa, e a verificação de tipos volta a passar

Esta passada fecha o gate vermelho que a revisão apontou no arquivo do motor e acrescenta as duas ferramentas pelas quais a etapa fala enquanto trabalha, mais os limites da conversa na configuração. O que não ficou pronto está dito no fim, e nada do que não foi exercitado aparece aqui como feito.

## O que mudou

### A chamada de coleta entrega a resposta final, e um texto fora do esquema tem uma rodada de correção

No motor aberto, a porta da mensagem passou a devolver o que aconteceu no fim do passo: a mensagem que entrou, a resposta final pedida pela chamada de coleta, ou os erros de um texto que não segue o esquema. Antes, a chamada de coleta acontecia mas o valor dela era descartado, e o laço seguia comparando o texto do passo anterior — o que fazia um texto fora do esquema falhar a etapa no primeiro texto que o modelo escrevesse, e impedia o caso de teste que fixa a coleta de rodar. Agora a coleta é uma chamada só, sem ferramenta alguma, com o formato do esquema; quando o texto dela não segue o esquema, os erros voltam ao diálogo e o passo seguinte do laço (com as ferramentas da etapa) tem uma rodada para corrigir, e a segunda falha encerra a etapa. A porta deixa de ser consultada depois de a coleta entrar, para que nenhuma mensagem entre na sessão depois do resultado.

O desenho da estratégia `prompt` (o texto do passo é um candidato a resultado e a coleta é pedida antes de qualquer conclusão) ficou escrito em comentário junto do caso de teste que o cobra.

### Os dois roteiros de teste que estavam em texto puro

Os dois casos novos do motor aberto passavam o roteiro do servidor de mentira como texto puro (`fakeOpenAI(['a resposta', ...])`), e cada posição do roteiro tem de ser um passo do servidor. O servidor estourava ao receber esse roteiro, e os dois casos não chegavam a exercitar o que deviam fixar. Os dois passaram a usar `textStep(...)`, o auxiliar que o arquivo já importava.

### As duas ferramentas da etapa e a do agente chamado

Um arquivo novo reúne as três ferramentas como ferramentas neutras de motor, para os dois motores oferecerem os mesmos nomes e a mesma política:

- **`SendMessage`** deixa o agente que trabalha publicar na conversa da execução (para a pessoa, para um agente do time ou para todos) sem terminar a etapa. O texto é um post interno do agente; um nome que não é do time é recusado com a lista dos agentes. Uma mensagem para outro agente que está trabalhando entra na etapa dele como entraria uma mensagem da pessoa.
- **`CallAgent`** abre uma conversa com outro agente do time, na conversa da execução ou numa conversa nova do fórum ligada à execução, e devolve ao chamador onde ela acontece. É recusada quando o nome não é do time, quando o agente já está na cadeia de chamadas (o ciclo) ou quando a tentativa já abriu o teto de conversas.
- **`AskConversation`** é a ferramenta do agente chamado: entrega o que ele diz e devolve a próxima mensagem do outro lado. Sem ela, a conversa termina.

Uma etapa que trabalha recebe as duas primeiras; a chamada sem ferramenta alguma (a coleta) não recebe nenhuma.

### A conversa entre dois agentes

Um arquivo novo conduz a conversa: a mensagem do chamador abre, o agente chamado responde, e os dois vão e voltam dentro do teto de rodadas por conversa. Cada mensagem é um post do agente que a disse na thread da conversa; o agente chamado roda pelo mesmo motor, sobre o worktree da execução, e o resultado é devolvido ao chamador pela caixa da etapa, para entrar na sessão dele como uma mensagem. Ao bater o teto, a conversa encerra, escreve na thread por quê e a etapa de quem chamou segue. Quando a conversa acontece numa conversa nova do fórum, a thread da execução ganha uma linha apontando para ela.

### Os limites na configuração

A seção `runner` ganhou `conversations.roundsPerConversation` (padrão 6, faixa 1–50) e `conversations.perStage` (padrão 3, faixa 1–20), nos três arquivos do esquema e no documento da configuração nas duas línguas. O campo é opcional e lido com padrão quando ausente: um arquivo guardado sem o bloco abre com o comportamento novo, **sem** passo de migração — a mesma escolha que `runner.linkDependencies` e `release` já usaram. A tela dos limites do runner transporta o bloco de ida e volta, sem campo próprio.

## O que foi conferido, e como

Por execução, nesta árvore de trabalho:

| O que | Resultado |
|---|---|
| `npx tsc --noEmit` | **passa** (antes falhava com 5 erros no arquivo do motor) |
| `test/engine-incoming.test.ts` | **12 de 12** (antes 10 de 12) |
| `test/runner-send-call.test.ts` (novo) | **5 de 5** |
| `test/config-schema.test.ts` e `test/team-runner-edit.test.ts` | **34 de 34** |
| `npm run i18n:lint` | **passa**: 4080 chaves nas duas línguas |
| `node scripts/theme-audit.mjs` | **passa** |
| `node scripts/public-audit.mjs` | **passa**: 916 arquivos |

Os casos novos cobrem: o `SendMessage` publicando na conversa da execução com a etapa seguindo e o post sendo interno; a recusa de um nome fora do time; a decisão pura de destino de mensagem; a recusa do ciclo e a do teto de conversas; e uma conversa aberta por uma etapa com outro agente do time, com o agente chamado rodando pelo motor e a thread nova ligada à execução.

## O que não foi verificado

- **Um caso do teste novo da conversa não passa.** O caso que abre uma conversa numa conversa nova do fórum falha na montagem do próprio teste (a rotina de apoio devolve a resposta registrada no lugar da função que a recebe), então o comportamento que ele deveria fixar **não está confirmado por execução**; os dois outros casos do arquivo passam.
- **A suíte completa, a auditoria de tema e a auditoria pública depois destas mudanças:** a suíte inteira foi rodada antes destas últimas alterações e ficou 3674 de 3676 (duas falhas de tempo, alheias a esta issue); depois delas, não foi rodada de novo.
- **O motor com o SDK real:** não foi chamado nenhum modelo real; o encaixe da mensagem numa sessão em andamento e a saída estruturada seguem conferidos só por leitura e por dublê.
- **O dono único do worktree**, com a etapa largando o worktree entre passos e a conversa de um chamado que escreve sendo a única dona: **não existe no código**.
- **O commit do trabalho do agente chamado com a etapa que chamou**, e a revisão lendo a mudança por um `head` anotado: **não existem no código**; a revisão continua lendo pelo caminho de hoje.
- **O uso do modelo da conversa somado ao da etapa de quem chamou:** o campo que o recebe está ligado, mas nenhum teste prova a soma, e a tela do uso não foi aberta.
- **O agente chamado com permissão de escrever mudando um arquivo sem dois escritores ao mesmo tempo:** não exercitado.
- **Os critérios de aceite 3, 4 e 5 da issue** (o QA rodando comando na conversa, o agente chamado mudando arquivo, e o ciclo com o teto de rodadas encerrando e dizendo por quê na tela): o teto de rodadas está exercitado no teste da conversa, mas o comando do agente chamado aparecendo sob o nome dele na lista da execução e a mudança de arquivo **não** estão.
