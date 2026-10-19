# Triagem: o agente chamado não recebe a mensagem e a etapa pode travar

## Tipo

Bug (regressão na beta 0.11.0), na área do runtime do runner.

## Dá para entender e reproduzir?

- **Entender: sim.** A issue é clara, traz os passos, o resultado esperado e os critérios de aceitação.
- **Como foi conferido: só lido.** Nada foi executado nem reproduzido nesta etapa. Os testes pedidos na issue não foram escritos nem rodados.
- **Leitura do código (confere com a issue, com números de linha ligeiramente diferentes):**
  - `src/main/runner/conversation.ts:188-190`: a primeira mensagem do chamador só é postada na thread; o prompt do chamado (`turnOf`, `:331`) é montado só com o texto de sistema e os índices de procedimentos/memória, sem a mensagem. Mensagens seguintes chegam porque são o retorno de `AskConversation` (`:294-303`).
  - `:220-243`: depois de um turno que termina sem `AskConversation`, o laço chama outro `turnOf` sem esperar o chamador, até o limite de rodadas.
  - `src/main/runner/executor.ts:1189-1190`: com chamado que escreve (`permission: worktree`), `callAgent` aguarda a conversa inteira. `incoming` (`:1137-1143`) só recebe novas mensagens por `open.say` (`:1122`), que o chamador, preso na primeira chamada, não consegue acionar. Só abort da etapa ou fechamento da inbox encerram (`:1141`).
  - `callStop` (`runs:callStop` em `module.ts:381`) usa `callStops` (`mentions/stop.ts`), registrado por menções e persona (`mentions/answer.ts:280`); conversas do runner não se registram ali (confirmado: nenhum registro em `conversation.ts`/`executor.ts`).
- **Não verificado:** por que o relógio de ociosidade de 10 min não disparou em 70 min (a própria issue diz não ter identificado); se algo bate o relógio durante a espera. Precisa de investigação na etapa de análise.

## O que falta

Nada que só quem abriu possa dizer; sem pergunta ao autor. Ponto em aberto técnico: a causa do relógio de ociosidade não disparar.

## Duplicadas ou relacionadas

Nenhuma identificada. Não foi feita busca no tracker; a lista de memória do espaço de trabalho cita a #280/#282 (outros temas), sem relação aparente. Não verificado.

## Escopo sugerido

Cinco frentes, todas em `src/main/runner`: (1) entregar a primeira mensagem no prompt/sessão do chamado; (2) turno sem `AskConversation` encerra a conversa; (3) impedir a espera circular (chamado que escreve pedindo ao chamador que está bloqueado); (4) limite de tempo sem progresso, com linha de sistema e retorno ao chamador; (5) `callStop` parar conversa do runner. Testes com fakes conforme a seção de aceitação da issue.

## Sugestões

- **Prioridade (sugestão, não definida aqui):** `priority:high`. A etapa fica parada sem erro por mais de uma hora e só se resolve matando o processo à mão; afeta qualquer chamada a um agente que escreve.
- **Squad:** plataforma (runner).
