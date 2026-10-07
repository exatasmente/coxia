# Um agente que só lê numa execução lê apenas dentro da pasta de trabalho dela

## O que se pede

Um agente que só lê numa execução do motor Claude Agent SDK passa a ler apenas dentro da pasta
de trabalho da execução, com as mesmas regras que já valem para o agente que escreve. Nas
palavras da issue:

> A reader on either engine reads only inside its run's worktree (and the cycle folder in it), with the same rules the guard applies to writers: no absolute path outside, no `..`, no `~`, no link that leads out, nothing under `.git`, no secret files. A refused read goes to the run's thread and the live activity as "blocked", like the other refusals.

E o comentário que afina o alvo:

> Escopo afinado: a sandbox só cobre o `Shell`; `Read`, `Grep` e `Glob` de um agente leitor no motor SDK não passam pelo `readGuard`, que hoje só é montado para quem escreve (`src/main/runner/executor.ts`, `confine: writes ? … : undefined`). Prioridade alta mantida.

O escopo da issue também diz, no próprio texto:

> Tests: a link out, `..`, `~`, `.git`, an absolute path.
>
> Do not loosen the secret and broad-search guards.

## O que muda para quem usa

- Um agente que só lê — uma etapa de leitura de uma execução, uma menção (`@agente`) numa
  conversa de execução, uma pergunta de outro agente — passa a alcançar apenas arquivos que
  estão dentro da pasta de trabalho daquela execução. O que estiver fora deixa de ser lido.
- A leitura recusada aparece na conversa da execução como bloqueada, com o agente, o alvo que
  ele tentou e o motivo, do mesmo jeito que as recusas do agente que escreve já aparecem. A
  pessoa vê o que o agente tentou ler, mesmo que a etapa siga adiante.
- As escolhas que já existem hoje continuam valendo por cima: um nome que parece guardar um
  segredo continua fora de alcance, o conteúdo de um segredo encontrado numa busca continua
  censurado, e uma busca ampla demais continua recusada. Nada disso é relaxado.
- Nada muda para o agente que escreve numa execução: as regras dele são as mesmas de hoje.
- Nada muda para as cerimônias (daily, unblock, retro), que leem a pasta de projetos de
  propósito.

## Regras

1. **Quem é leitor.** Conta como leitor da execução qualquer agente que só lê dentro de uma
   execução: uma etapa de leitura, uma menção numa conversa de execução e uma pergunta da
   cadeia de perguntas. O agente que escreve continua com o comportamento de hoje.
2. **As ferramentas cobertas.** A restrição vale para `Read`, `Grep` e `Glob`. São as mesmas
   três ferramentas que a guarda de leitura já cobre para quem escreve.
3. **A raiz.** A raiz de leitura é a pasta de trabalho da execução. O que estiver dentro dela,
   inclusive a pasta do ciclo, é alcançável; o que estiver fora não é.
4. **O que é recusado.** Fora da raiz, valem exatamente as regras que hoje valem para quem
   escreve: caminho absoluto que sai da raiz, `..` em qualquer posição, `~`, um link simbólico
   que leva para fora, um link que não leva a lugar nenhum, qualquer coisa dentro de `.git`, e
   um arquivo que parece guardar um segredo.
5. **A recusa é dita.** Cada leitura recusada é registrada na conversa da execução (com o
   agente, a ferramenta, o alvo e o motivo) e marcada como bloqueada na atividade ao vivo, pela
   mesma fiação que o agente que escreve já usa.
6. **Não afrouxar o que existe.** O filtro de arquivo de segredo, a censura do resultado de
   busca e a recusa de busca ampla continuam valendo, por cima desta restrição. Esta mudança só
   restringe; não amplia nenhum alcance.
7. **Campo próprio.** A leitura recebe um campo de raiz próprio (por exemplo `readRoot`), e não
   o campo `confine` de quem escreve: `confine` também abre `Edit` e `Write` e o shell, e o
   leitor não ganha nada disso.
8. **As pastas de documentação listadas fora da pasta de trabalho.** A configuração do
   workspace lista pastas de documentação que ficam fora da pasta de trabalho e que hoje são
   entregues ao leitor. Com a restrição, essas pastas passam a ser alcançáveis **somente por
   uma lista explícita e curta, derivada da configuração** — sem `~` e sem `..`, com a mesma
   validação que o sandbox já aplica às pastas extras. Uma pasta de documentação que não entra
   nessa lista deixa de ser alcançável pelo leitor. *(Proposta a confirmar pela pessoa; ver
   "Perguntas em aberto".)*
9. **Alcance das menções e da cadeia de perguntas.** Uma menção ou uma pergunta que anda fora
   da conversa de uma execução (um canal, uma conversa geral) não tem pasta de trabalho para
   servir de raiz. Nesse caso a chamada fica como está hoje, sem a restrição. A menção feita na
   conversa de uma execução usa a pasta de trabalho daquela execução como raiz. O contato de um
   squad chamado por um pedido de outro squad lê o repositório do próprio squad, e não a pasta
   de trabalho da execução que originou o pedido. *(Proposta a confirmar pela pessoa; ver
   "Perguntas em aberto".)*

## Fora do escopo

- As cerimônias (daily, unblock, retro): leem a pasta de projetos de propósito e ficam de fora.
- O agente que escreve: as regras dele não mudam.
- O shell e a sandbox: a sandbox já cobre o `Shell`; esta mudança é sobre as ferramentas de
  leitura, não sobre comandos.
- O motor aberto: a leitura nele já é limitada pelas raízes do contexto. Esta mudança é sobre o
  motor do Claude Agent SDK.
- Os arquivos de segredo e a busca ampla: continuam como estão; nada é afrouxado.
- Telas novas: o comportamento aparece na conversa e na atividade que já existem.
- Largar o SDK ou empacotá-lo: nada disso.

## Critérios de aceite

1. Num agente leitor de uma execução, no motor do Claude Agent SDK, uma leitura de um arquivo
   dentro da pasta de trabalho funciona como hoje (inclusive a pasta do ciclo).
2. Uma leitura de um caminho absoluto que sai da pasta de trabalho é recusada.
3. Uma leitura com `..` é recusada.
4. Uma leitura com `~` é recusada.
5. Uma leitura através de um link simbólico que leva para fora da pasta de trabalho é recusada.
6. Uma leitura de qualquer coisa dentro de `.git` é recusada.
7. Uma leitura de um arquivo que parece guardar um segredo continua sendo recusada.
8. Cada recusa faz aparecer, na conversa da execução, uma linha com o agente, a ferramenta, o
   alvo e o motivo, e a atividade ao vivo mostra a chamada como bloqueada.
9. O filtro de segredo, a censura do resultado de busca e a recusa de busca ampla continuam
   valendo (nada foi afrouxado).
10. Uma menção feita na conversa de uma execução segue as mesmas regras; uma menção fora da
    conversa de uma execução, e um pedido entre squads, continuam como estão hoje.
11. As pastas de documentação listadas fora da pasta de trabalho, quando entram na lista
    explícita, continuam alcançáveis; quando não entram, deixam de ser.

## Verificação

| Critério | Como conferir | Situação |
|---|---|---|
| 1 | Teste automatizado com um agente leitor: leitura dentro da pasta de trabalho (e da pasta do ciclo) permitida. | Não verificado nesta etapa |
| 2 | Teste automatizado com um agente leitor: caminho absoluto fora da pasta de trabalho recusado. | Não verificado nesta etapa |
| 3 | Teste automatizado com um agente leitor: caminho com `..` recusado. | Não verificado nesta etapa |
| 4 | Teste automatizado com um agente leitor: caminho com `~` recusado. | Não verificado nesta etapa |
| 5 | Teste automatizado com um agente leitor: link simbólico que leva para fora recusado. | Não verificado nesta etapa |
| 6 | Teste automatizado com um agente leitor: caminho dentro de `.git` recusado. | Não verificado nesta etapa |
| 7 | Teste automatizado: arquivo de nome de segredo recusado, como já acontece para quem escreve. | Não verificado nesta etapa |
| 8 | Teste automatizado: uma recusa registra a linha na conversa da execução e marca a chamada como bloqueada na atividade. | Não verificado nesta etapa |
| 9 | Teste automatizado: as regras de segredo, de censura de resultado e de busca ampla seguem valendo. | Não verificado nesta etapa |
| 10 | Teste automatizado: menção na conversa de uma execução restrita; menção fora dela e pedido entre squads como hoje. | Não verificado nesta etapa |
| 11 | Teste automatizado: pasta de documentação na lista explícita alcançável; fora dela, recusada. | Não verificado nesta etapa |

Nesta etapa apenas se leu o código e a issue. Nenhuma execução com agente leitor foi rodada,
nenhum modelo foi chamado e nenhuma leitura fora da pasta de trabalho foi observada
acontecendo; os critérios acima foram escritos a partir do que a issue e o código afirmam, e
estão marcados como não verificados.

## Prioridade e marco

**Prioridade proposta:** `priority:high`, como a issue está rotulada, a decidir pela pessoa
entre os níveis configurados.

Motivo: é um bug de confinamento que existe hoje. Um agente que só lê numa execução alcança
arquivos fora da pasta de trabalho, e a mudança não amplia nada — só restringe o que já deveria
estar restrito. Fechar a lacuna é pré-requisito para o guarda-chuva de permissões por agente
prometer o que promete.

**Marco:** não se propõe marco. É uma correção no runtime (motor e runner), sem relação com um
marco de produto; a pessoa decide se quer encaixá-la em algum.

## Perguntas em aberto

Duas escolhas de escopo ficam para a pessoa; a issue levanta a primeira e não a responde, e a
segunda nasce de conversas que não têm pasta de trabalho.

1. **As pastas de documentação listadas fora da pasta de trabalho.** Ficam de fora, ou entram
   numa lista explícita de permitidos? A proposta acima é uma lista explícita, curta e derivada
   da configuração, sem `~` e sem `..`, com a mesma validação que o sandbox já faz das pastas
   extras. A mesma configuração que hoje é entregue ao motor precisa acompanhar essa decisão,
   senão o fechamento deixa o leitor sem acesso a essas pastas.
2. **O alcance das menções e da cadeia de perguntas.** Quando uma menção ou uma pergunta anda
   fora da conversa de uma execução (um canal, uma conversa geral), não há pasta de trabalho
   para servir de raiz; e o contato de um squad chamado por um pedido lê o repositório do
   próprio squad. A proposta acima é: raiz igual à pasta de trabalho quando ela existe, e a
   chamada como está hoje onde não existir.
