# Issues com rótulo e sem ninguém assignado devem aparecer na tela de runs

## Classificação

Pedido de funcionalidade (rótulo `enhancement`). O pedido é completo: descreve o comportamento atual, o desejado e traz critérios de aceite.

## Dá para entender e reproduzir

Sim, dá para entender como está escrito. Não foi reproduzido: nada foi executado nesta etapa, só leitura do código da tela e do runner.

O comportamento descrito confere com o código:

- A varredura que inicia runs sozinha procura issues pelo rótulo de gatilho **entre as issues da própria pessoa** (a consulta `listMyIssues`), filtrando as abertas que carregam o rótulo. Uma issue com o rótulo e sem pessoa assignada nunca entra nessa lista, então fica de fora da varredura — exatamente o que a issue relata.
- O provedor de código expõe uma consulta das issues abertas de um projeto por rótulo (`listIssues` com escopo `labels`), e a resposta traz `assignees`. A nota da issue ("Needs a query of its own: the person's own issues do not include unassigned ones") é tecnicamente correta e a consulta nova é possível.

## O que falta

Nada que quem abriu precise dizer. O pedido e os critérios de aceite bastam para o trabalho. Eventuais escolhas de apresentação (onde a lista entra na tela, o texto do controle de iniciar) são decisão de produto para a etapa de refinamento, não bloqueiam a triagem.

## Duplicadas e relacionadas

- A issue de origem da divisão, citada no texto da issue, da qual esta foi separada: passou a cobrir só a documentação e a dica do campo de gatilho. Não é duplicada; é a origem. Relacionada.
- Nenhuma outra issue duplicada foi encontrada. Só o texto desta issue foi lido; outras issues não foram consultadas.

## Sugestão de prioridade

A prioridade é proposta na etapa de refinamento do produto, não nesta. Como sugestão, manter `priority:low` (o rótulo já carregado pela issue): resolve um buraco de descoberta de trabalho sem pessoa assignada, mas não bloqueia nenhuma capacidade existente.
