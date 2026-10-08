# Memória do ciclo

## Decisões

- Issue 141 classificada como pedido de funcionalidade: a memória das atividades precisa deixar de ser por execução (por run e por worktree) e passar a ser compartilhada, transversal a execuções, persistente entre reinícios e visível a um agente chamado fora daquela execução.
- Squad proposto: plataforma (o núcleo é o runtime do runner: como o estado de uma atividade é guardado, lido e compartilhado). A tela de execução pode ser tocada pela entrega, mas a decisão é do runtime.
- Prioridade sugerida apenas como sugestão: `priority:high`, pela desinformação direta ao usuário. A proposta formal é da etapa de refinamento.
- Não foi feita pergunta a quem abriu: a issue traz problema, regras e critérios de aceite suficientes para seguir.

## Restrições

- Escopo desta atividade não inclui decidir como implementar ou armazenar (fica para o planejamento); aqui só se descreve o comportamento.
- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo; usar placeholders neutros (`example.com`, `group/project`, `#123`).
- Todo texto de interface passa por `t()` nos dois catálogos; nada de cor literal no renderer (tokens de tema).
- Nenhum teste pode tocar modelo, host de código ou rede reais; fakes em `test/helpers/`.
- Código, testes, identificadores e commits em inglês; comentários dizem por quê.

## Tentado e descartado

- Nada implementado nem descartado. A etapa só leu; nenhuma execução foi iniciada e o comportamento não foi exercitado.

## Perguntas abertas

- Nenhuma em aberto nesta etapa. A issue não deixou lacunas que só quem abriu poderia responder.

## Onde o trabalho está

- Triagem concluída (tentativa 1): `0_TRIAGE.md` escrito com tipo, o que dá para entender e onde foi conferido, o que falta, as issues relacionadas (#52, #122, #71, #29) e a sugestão de prioridade e squad.
- Estado do código conferido por leitura: a memória do ciclo existe, mas é um arquivo de nome fixo dentro da pasta do ciclo no worktree da execução, lida e reescrita pelas etapas daquela execução; um agente chamado numa conversa recebe apenas o fio da conversa e os arquivos passados pelo chamador, sem estado compartilhado entre execuções. Não verificado em execução.
- Próxima etapa: especificação do comportamento (o que é compartilhado, quem lê, como é atualizado, onde persiste, como aparece no prompt do agente chamado), com os quatro critérios de aceite como cenários verificáveis.
