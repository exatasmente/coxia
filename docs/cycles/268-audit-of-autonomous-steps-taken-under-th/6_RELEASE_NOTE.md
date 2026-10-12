# O registro agora mostra tudo o que a persona fez sem pedir

## O que mudou

O registro de auditoria passou a contar, para cada passo que a persona dá sem esperar um "sim", o que foi feito, quando, por qual agente e qual política de autonomia estava valendo, com o nível de onde ela veio (hoje, o espaço de trabalho ou um fluxo).

Entram no registro:

- início de etapa do ciclo;
- comando executado no computador;
- portão que seguiu sem aprovação;
- push;
- abertura de pull request;
- escrita no quadro do host de código.

Também passam a aparecer:

- os passos que ficaram retidos esperando um "sim" e foram aprovados ou recusados, com a decisão, a hora e quem decidiu (a pessoa ou a persona);
- cada mudança de política, com o valor anterior, o novo e o nível.

A tela do log mostra os novos tipos de registro, o agente, a política em vigor e uma marca "Alterado depois de escrito" quando uma linha foi mexida depois de gravada.

## Como usar

1. Abra a tela de auditoria como de costume.
2. Cada linha de passo autônomo mostra o agente e a política em vigor (as escolhas ligadas e o nível).
3. Use o filtro "Quem" para separar o que foi da pessoa do que foi da persona.
4. Ao mudar a política de autonomia, uma linha por escolha alterada aparece no registro.

## O que vale saber

- A persona não tem como apagar nem editar o registro: o único acesso que ela tem é de leitura.
- Cada linha é encadeada à anterior. Se alguém editar ou remover uma linha direto no arquivo, o app marca a alteração. Um agente com acesso ao computador como a pessoa ainda consegue mexer no arquivo; nesse caso há detecção, não bloqueio.
- Registros antigos não são reescritos e continuam legíveis, sem política.
- Não há tela nova: os campos novos aparecem na tela de auditoria que já existia.
- Os interruptores de autonomia de agente e de squad ainda não geram registro de mudança de política; isso fica para a política configurável.
- Não foi verificado em um app aberto: a tela do log, o build desta rodada e os testes que usam navegador.
