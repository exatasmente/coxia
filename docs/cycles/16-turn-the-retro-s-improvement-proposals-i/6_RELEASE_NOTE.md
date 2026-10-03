# As propostas de melhoria da retro viram tarefas do fluxo de agentes

## O que mudou

A retro não guarda mais propostas de melhoria. A seção de melhorias propostas saiu da tela da retro: no lugar dela, as melhorias que a conversa da retro levanta aparecem como propostas em Ações, uma por melhoria, na ordem em que vieram. Aceitar uma proposta passa a ser o caminho para levar a ideia adiante.

Ao aceitar, três coisas acontecem de uma vez: a issue é criada no rastreador com o título da melhoria e, no corpo, a dimensão, o problema de hoje, o que ela seria e de onde veio; a criação fica registrada; e uma tarefa começa nessa issue, com a pasta do ciclo, a conversa e os documentos próprios, seguindo até a revisão do código. A saída deixa de ser copiar o texto à mão.

## Como usar

1. Abra a retro e faça a pergunta que costuma levantar melhorias, como sempre.
2. Se a retro levantar melhorias, cada uma vira uma proposta em Ações. O cartão mostra o texto da melhoria à vista: dá para ler e decidir antes de responder. Nada é escrito no rastreador nesse momento.
3. Aceite a proposta para criar a issue e começar a tarefa. Cada melhoria é aceita ou recusada por si; uma retro com várias melhorias oferece várias propostas.
4. Recusar ou pular não cria nada. A execução passa a ser acompanhada pelo fluxo de tarefas, não pela retro.

## O que vale saber

- Nada é escrito no rastreador sem o seu "sim". Num espaço de trabalho marcado como de teste, a confirmação é recusada e nada sai da máquina.
- Sem rastreador, sem projeto de issues ou sem permissão de escrita de issue, a melhoria fica só na conversa da retro, com o motivo dito, e nada é criado.
- Uma retro já gravada por uma versão anterior, com melhorias guardadas, continua abrindo normalmente; só a seção de melhorias deixa de existir.
- As demais cerimônias não mudam. O restante da retro — o relato do período, os números, o que funcionou, o retrabalho, o que travou e a conversa — continua igual.
- Duas melhorias cujos títulos coincidem depois de normalizados e cortados nos primeiros caracteres geram duas propostas, cada uma com a sua fala na conversa.
- A checagem de tipos, os testes, a auditoria de tema, o lint de traduções, a auditoria pública e o build passaram. Os testes usam um modelo e um rastreador falsos: não foi observado se o modelo real preenche as melhorias sem que o prompt as peça, se o cartão renderiza como descrito nem se a tarefa começa de fato depois da issue existir num rastreador real. Isso segue **não verificado** e é o que a beta deve mostrar.
