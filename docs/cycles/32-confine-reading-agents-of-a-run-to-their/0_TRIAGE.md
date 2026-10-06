# Um leitor de uma execução pode ler fora da pasta de trabalho

## Que issue é

É um **bug**. O comportamento de um agente que só lê numa execução não é o que o app promete: a leitura dele alcança arquivos fora da pasta de trabalho da execução. O texto foi escrito como um defeito, com o que existe hoje, o que se quer e o que fica fora do escopo, e traz uma atualização de escopo e um comentário do autor afinando o alvo.

O que se quer, nas palavras da issue:

> A reader on either engine reads only inside its run's worktree (and the cycle folder in it), with the same rules the guard applies to writers: no absolute path outside, no `..`, no `~`, no link that leads out, nothing under `.git`, no secret files. A refused read goes to the run's thread and the live activity as "blocked", like the other refusals.

## Dá para reproduzir ou entender

Dá para entender como está escrita, e a leitura do código confirma a causa que a issue aponta. **Só foi lido, não foi exercitado**: nenhuma execução com agente leitor foi rodada, e nenhuma leitura fora da pasta de trabalho foi vista acontecendo. O que se sabe foi conferido assim:

- a guarda de caminho do agente que escreve (`src/main/engine/guard.ts`, `checkPath`) recusa absoluto fora da raiz, `..`, `~`, link que sai, link que não leva a lugar nenhum, `.git` e arquivo de segredo, e, para leitura, libera a própria raiz e as pastas de hooks;
- a chamada de etapa monta essa guarda **somente para quem escreve** (`src/main/runner/executor.ts:430`, `confine: writes ? { root: wt, hooks: confinedHooks(...) } : undefined`), e um agente leitor da execução fica com `confine` indefinido;
- os hooks que um leitor recebe nesse caminho são os das cerimônias (`noSecrets`, a recusa de busca ampla e a redação de resultados de busca, `src/main/agents.ts:299`), que tratam só de nomes de segredo e de busca ampla, não de caminho;
- sem `confine`, as ferramentas são montadas por `allowedFor` e nada recebe a raiz da execução; o diretório de trabalho é só o ponto de partida dos caminhos relativos;
- no motor aberto a leitura é limitada pelas raízes passadas ao contexto (`src/main/engine/open/loop.ts:264`: o diretório de trabalho, as pastas extras, as pastas de documentos e as de skills), e toda ferramenta de leitura passa por essa conferência. É a diferença entre os dois motores que a issue descreve.

Uma consequência que a issue não diz e que vale levar para o refinamento: hoje, na chamada de um leitor, o app também autoriza o motor a ler as pastas listadas na configuração como documentação, que ficam fora da pasta de trabalho — a lista de diretórios adicionais entregue ao motor (`src/main/agents.ts:1055`, `extraDirs: call.confine ? [] : extraDirs(call.cwd, modelRole)`). Fechar o caminho do Claude Agent SDK sem decidir isso deixaria essas pastas inalcançáveis para o leitor.

## O que falta

Nada que só quem abriu a issue possa dizer. A issue diz o que se quer, o que fica fora (as cerimônias) e os casos de teste. Duas escolhas ficam para o refinamento do produto, porque mudam o escopo do que entra:

- **As pastas de documentação listadas fora da pasta de trabalho.** Ou ficam de fora, ou entram numa lista explícita de permitidos. A issue levanta a pergunta e não a responde; a resposta decide se a leitura do leitor alcança só a pasta de trabalho e a pasta do ciclo, ou também essas pastas. Sugestão: uma lista explícita, curta e derivada da configuração do workspace, sem `~` nem `..`, com a mesma validação que o sandbox já faz das pastas extras.
- **Alcance das menções e da cadeia de perguntas.** A issue diz que as duas são leitores e ganham o mesmo confinamento, mas uma menção e uma pergunta que andam **fora** da conversa de uma execução não têm pasta de trabalho para servir de raiz; e o contato de um squad chamado por um pedido de outro squad lê o repositório do próprio squad. Sugestão: a raiz é a pasta de trabalho da execução quando ela existe, inclusive quando a menção nasceu num canal; onde não existir, a chamada fica como está hoje.

## Issues que parecem duplicadas

Nenhuma. Nada no repositório repete este pedido: a busca por "confinar a leitura de agentes de uma execução" e por um campo de raiz de leitura não encontra outra issue nem outro documento, e a conversa desta issue não cita nenhuma.

Ficam registradas como próximas, sem duplicar:

- **#30 (permissões por agente, já integrada)** deixou esta lacuna declarada como decisão aberta, aprovada para virar mudança separada: no modelo de ameaças, o item do link simbólico plantado na pasta de trabalho diz que um leitor sem confinamento no motor do SDK pode ler fora, e a decisão **D6**, aprovada em 2026-10-03, mandou abrir esta mudança em separado. É a origem desta issue.
- **#52 (memória do ciclo, integrada)**: mudou o que a execução lê e o que ela escreve, e mexe nos mesmos arquivos que esta mudança provavelmente toca (a pasta do ciclo e o executor). Não é duplicata; só convém olhar as duas juntas para não reabrir o que já está fechado.

## Prioridade (sugestão)

`priority:high`, como a issue está rotulada. É uma lacuna de confinamento que já existe hoje e que o autor encontrou escrevendo o modelo de ameaças; fechá-la não amplia nada, só restringe, e é pré-requisito para o guarda-chuva de permissões prometer o que promete.

## Onde olhar quando o trabalho começar

- A guarda de caminho única (`src/main/engine/guard.ts`, `checkPath`) já sabe julgar uma leitura, inclusive liberando a própria raiz; a mudança é levá-la à chamada de um leitor.
- Os hooks de confinamento (`src/main/runner/hooks.ts`) já montam a guarda de leitura sobre `Read`, `Grep` e `Glob` e já relatam cada recusa; o que falta é a chamada de um leitor receber esses hooks.
- A recusa já é dita na conversa da execução (`runner.denied`, com agente, ferramenta, alvo e motivo) e marcada como bloqueada na atividade ao vivo, pela mesma fiação que o agente que escreve usa.
- Não afrouxar o que já existe: os nomes de segredo, a redação de resultados de busca e a busca ampla continuam valendo por cima.
- Os casos de teste que o escopo pede, segundo o escopo da própria issue: um link para fora, `..`, `~`, `.git` e um caminho absoluto, num agente que só lê.
