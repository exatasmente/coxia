# O número da issue entra no título da pull request e em todo commit de uma execução

## O que mudou

Uma execução que trabalha numa issue agora abre a pull request com o número da issue no título, no formato escolhido em Configurações › Runner. Antes, o título era só o texto que o agente escreveu (ou o título da issue), sem o número; agora ele leva o número por padrão: `Título #123`.

O formato é escolhido num campo novo, *Título da pull request*, ao lado do molde da mensagem de commit. Os dois usam o número da issue e o texto do título (o que o agente escreveu ou, sem ele, o título da issue). O mesmo título aparece na proposta em Ações, na tela da execução e no host de código.

Dois comportamentos novos vêm junto:

- Os dois moldes — o do título e o da mensagem de commit — não podem mais deixar o número de fora. Salvar ou importar um molde sem o número é recusado, dizendo o que falta. Um título que o agente já escreveu com o número não ganha o número duas vezes.
- O commit que resolve um conflito da branch de uma execução passa a levar o número da issue também, seguindo o mesmo molde dos outros commits da execução. Os merges de uma release continuam com as mensagens próprias.

## Como usar

1. Abra Configurações › Runner.
2. No campo *Título da pull request*, defina como o título vai levar o número, usando `{title}` para o texto que o agente escreveu (ou o título da issue) e `{iid}` para o número. O padrão é `{title} #{iid}`.
3. Deixe o molde da mensagem de commit como está, ou ajuste-o; os dois precisam do `{iid}` para serem aceitos.
4. Execute a issue como de costume. A pull request abre com o número no título, e cada commit que a execução faz leva o número na mensagem.

## O que vale saber

- Um espaço de trabalho já existente continua funcionando: um molde de commit guardado sem o número ganha o número anexado ao ser lido, e o campo do título entra com o formato padrão. Nada mais da configuração muda.
- Uma execução que não é de uma issue — uma release ou uma execução de documentação, por exemplo — não fica com um `#` solto: o número e o `#` antes dele saem do título e da mensagem.
- Um título longo escrito pelo agente é limitado, mas o corte nunca corta o número.
- O título de uma pull request que já existe não é renomeado pelo app. Commits que uma pessoa faz à mão na branch da execução não são alterados.
- A mudança foi conferida pelos testes e pela revisão, mas uma execução de verdade abrindo uma pull request num host de código e o comportamento numa tela num navegador pareado seguem **não verificados**; isso é o que o uso real deve confirmar.
