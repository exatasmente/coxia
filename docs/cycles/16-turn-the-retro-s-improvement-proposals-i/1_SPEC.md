# Melhorias de processo saem da retro e viram tarefas

## O problema

A retro fecha o período: relata o que andou, o que funcionou e o retrabalho, aponta o que travou e responde às perguntas do time. Hoje ela também levanta propostas de melhoria do processo. Essas propostas nascem junto com o resumo, ficam guardadas só dentro do registro da retro e saem para o time pela área de transferência, à mão.

Elas não são um dos três trabalhos da cerimônia — relatar, dizer o que está travado e reajustar prioridades — e não têm continuação no aplicativo: nenhuma vira trabalho, nada as acompanha até o fim. Quem usa fica com uma lista na tela que não anda sozinha, e o time fica sem o mesmo caminho que o aplicativo já usa para levar um pedido até a entrega.

## O que esta mudança entrega

- A retro deixa de levantar e de guardar propostas de melhoria: a seção sai da tela e do registro.
- Cada melhoria que a retro levantaria passa a ser uma tarefa do fluxo de agentes: uma issue no rastreador com o texto da melhoria e, a partir dela, uma execução com pasta de ciclo, conversa e documentos próprios, que vai até a revisão do código.
- A saída deixa de ser a área de transferência: a proposta de abrir a issue aparece em Ações para a pessoa aceitar, e a escrita no rastreador só acontece com o "sim".

## Regras

1. A retro não pede mais propostas de melhoria ao modelo nem as guarda, e a tela da retro deixa de ter a seção de melhorias propostas. O relato do período, os números, o que funcionou, o retrabalho, o que travou e a conversa continuam iguais.
2. Uma retro já gravada com melhorias continua abrindo; só a seção deixa de existir.
3. Cada melhoria que a retro levanta vira uma proposta de abrir uma issue, em Ações: o título da melhoria como título e o corpo com a dimensão, o problema de hoje, a proposta e a retro de onde veio. A pessoa vê esse texto antes de aceitar.
4. Nada é escrito no rastreador sem o "sim" da pessoa na proposta. Um "não" (ou pular) não cria nada. Num espaço de trabalho de teste a confirmação é recusada.
5. Aceita a proposta, a issue passa a existir no projeto de issues do rastreador e uma execução começa nela, como em qualquer outra tarefa: pasta de ciclo, conversa e documentos próprios, e a entrega segue até a revisão do código. A saída é da tarefa, não da retro.
6. Uma retro que levanta várias melhorias oferece uma proposta por melhoria; cada uma é aceita ou recusada por si.
7. Sem rastreador, sem projeto de issues ou sem escrita de issue, a melhoria fica só na conversa da retro, com o motivo dito, e nada é criado.
8. As outras cerimônias não são tocadas.

## Fora do escopo

- Escolher a prioridade ou o marco da tarefa levantada: isso é do ciclo de agentes, na etapa própria.
- Juntar várias melhorias numa tarefa só, ou transformar a retro inteira numa tarefa.
- Criar a issue sem passar pela pessoa, ou em um espaço de trabalho de teste.
- Mudar o que a retro relata e o que ela considera travado.
- A escolha do repositório e da pasta de trabalho da execução, que já é regra para qualquer tarefa.
- A convenção de levar a melhoria à mão para um registro do time, que deixa de existir com a seção que a oferecia.

## Aceitação

- Uma retro preparada não guarda melhorias e a tela não mostra a seção de melhorias propostas.
- Uma retro que levanta melhorias mostra, para cada uma, uma proposta de abrir a issue em Ações, com o texto da melhoria à vista.
- Aceitar a proposta cria a issue no projeto de issues e inicia uma execução nela; a execução tem pasta de ciclo e conversa próprias e produz os documentos das etapas.
- Recusar (ou pular) a proposta não cria nada e não deixa a melhoria guardada na retro.
- Num espaço de trabalho de teste, a proposta aparece e a confirmação é recusada.
- Sem rastreador, sem projeto de issues ou sem escrita de issue, a melhoria fica só na conversa da retro, com o motivo dito, e nada é criado.
- O restante da retro — relato, números, funcionou, retrabalho, travado e conversa — continua igual.
- Os textos de ouro dos prompts e o lint de traduções passam sem a menção a melhorias no prompt da retro.
