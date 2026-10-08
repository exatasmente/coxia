# Memória do ciclo

## Decisões

- Issue 141 classificada como pedido de funcionalidade: a memória das atividades deixa de ser por execução e passa a ser compartilhada, transversal a execuções, persistente entre reinícios e visível a um agente chamado fora daquela execução.
- Squad: plataforma (o núcleo é o runtime do runner: como o estado de uma atividade é guardado, lido e compartilhado).
- O comportamento especificado (1_SPEC.md, palavras do produto): uma frente por atividade (referência, título, etapa atual, agente que a trabalha e último que mexeu, decisões, perguntas abertas, onde parou com o último recado, instante da última atualização); atualizada pelo app ao longo do ciclo (início, entrada e saída de etapa, resposta da pessoa, recado, pergunta, cancelamento, fim); qualquer agente lê, nenhum agente escreve; miniaturas por agente ("onde fulano parou"); fora do worktree e fora da pasta do ciclo; cruza reinícios; visível e corrigível pela pessoa sem chamada de modelo.
- Consulta: o agente tira da pergunta o que ela nomeia (referência/título de atividade, nome de agente, ou nada) e recebe a frente inteira; sem nada nomeado, recebe as atividades em andamento em poucas linhas, com aviso de que pode abrir uma delas. A memória entra como material (`<data>`), nunca como instrução.
- Não verificado em execução (só leitura): que a resposta de hoje diga "não há trabalho" e que uma atividade sobreviva ao reinício. O relato da issue é a evidência disso.

## Restrições

- Escopo desta atividade não inclui decidir como implementar ou armazenar (fica para o planejamento); aqui só o comportamento.
- Memória, formato e armazenamento da memória da execução (MEMORY.md na pasta do ciclo) não mudam nesta entrega; a memória compartilhada é um segundo registro, por atividade, fora do worktree.
- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo; usar placeholders neutros (`example.com`, `group/project`, `#123`).
- Todo texto de interface passa por `t()` nos dois catálogos; nada de cor literal no renderer (tokens de tema).
- Nenhum teste pode tocar modelo, host de código ou rede reais; fakes em `test/helpers/`.
- Código, testes, identificadores e commits em inglês; comentários dizem por quê.
- Emenda antes de partir para o backlog: a 1_SPEC.md não abre com as palavras da issue na primeira seção, e a emenda "## O que se pede Comece citando as palavras da própria issue" chegou depois de a spec estar pronta. Vale para as próximas etapas a mesma regra do comentário na tracker.

## Tentado e descartado

- Falar "todo mundo sempre" contra texto curto (descartado decidir isso agora): o teto de contexto/memória para anexar todo o estado de todas as atividades em todas as mensagens é um número que o plano precisa demonstrar; a spec deixa os números de quantas frentes cabem e como o corte funciona para o plano (regras exigem, sem teto definido, só que o corte não pode cortar a frente da atividade em questão nem a atualização corrente).
- Nada implementado nem descartado em código. Esta etapa só leu; nenhuma execução foi iniciada e o comportamento não foi exercitado.

## Perguntas abertas

- Escopo da primeira entrega: tudo de uma vez (frentes por atividade, miniaturas por agente, consulta numa tela) ou primeiro as frentes e a consulta, deixando miniaturas e conversas de fora de uma execução para depois. Recomendação da spec: tudo de uma vez.
- Crescimento sem fim: a memória não pode ser apagada para caber, mas nada diz o que ela faz com centenas de atividades ao longo de meses (resumir as encerradas e antigas, guardar só as abertas, ou deixar crescer).
- Onde a pessoa edita o que é compartilhado: na tela da execução, como a memória de hoje, ou como operação de manutenção em Configurações.
- Nota de lançamento: se a mudança é visível para quem usa, o lançamento diz o que mudou; confirmar antes de publicar.

## Onde o trabalho está

- Triagem concluída (tentativa 1): `0_TRIAGE.md` escrito com tipo, o que dá para entender e onde foi conferido, o que falta, as issues relacionadas (#52, #122, #71, #29) e a sugestão de prioridade e squad.
- Refinamento concluído (tentativa 1): `1_SPEC.md` escrito com o que muda para quem usa, 15 regras numeradas, fora do escopo, 5 critérios de aceite verificáveis por uma pessoa, 4 perguntas em aberto e a seção de como foi conferido — tudo por leitura, nada executado.
- Estado do código conferido por leitura: a memória do ciclo é um arquivo de nome fixo na pasta do ciclo, no worktree da execução, lida e reescrita pelas etapas daquela execução; um agente chamado numa conversa recebe só o fio da conversa e os arquivos que o chamador passa (os documentos da pasta do ciclo apenas quando o lugar é a conversa daquela execução), sem estado compartilhado entre execuções. O estado por execução (etapa, estado, histórico, perguntas, recados por etapa) existe e é a matéria-prima da memória compartilhada. Não verificado em execução.
- Próxima etapa: plano técnico (2_PLAN.md) — onde a memória mora, como nasce e é mantida, quando é atualizada, como entra no texto de um agente chamado em qualquer lugar, como fica visível sem chamada de modelo e como a pessoa corrige; responder às quatro perguntas em aberto. Prioridade proposta nesta etapa: `priority:high`; marco: próximo ciclo normal.
- Passagem support → product-owner: Escrever a especificação do comportamento: qual estado é compartilhado entre atividades, quem o lê e quando, como ele é atualizado ao longo de uma execução, onde ele persiste entre reinícios, e como isso aparece no prompt de um agente chamado fora de uma etapa. Cobrir os quatro critérios de aceite da issue como cenários verificáveis, incluindo o caso do agente de QA que respondeu não haver teste em andamento. Não decidir armazenamento nem formato agora além do que o comportamento exige. <!-- handoff:8 -->
