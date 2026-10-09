# Exame dos saltos registrados nas liberações before the next cut

## O que muda para quem usa

Nada muda no produto ainda. Esta especificação pede um exame: olhar os registros das liberações passadas (as das issues 75, 151 e 115), listar cada passo que ficou marcado como "pulado" (skipped) e escrever por que cada um aconteceu, antes de a próxima liberação ser cortada. O resultado é um registro que a equipe lê na próxima retro de liberação: quantos saltos houve, em que etapas, e se cada um foi decisão da pessoa no momento, repetição de passo por refazer de grupo, ou efeito da mecânica atual do fluxo.

Quem usa o produto hoje não vê diferença de comportamento nesta entrega. A diferença vem depois, se o exame mostrar que uma regra do fluxo (por exemplo, o que refazer de um grupo de passos deixa pendente) gera saltos que ninguém decidiu.

## Regras

1. O exame cobre as três liberações citadas: as das issues 75, 151 e 115, do começo ao fim (done incluído).
2. Cada passo marcado como pulado é listado individualmente, com: a etapa em que ocorreu, quem pulou (a pessoa, ou o sistema no refazer de um grupo), e o motivo registrado (o texto dado na decisão, quando houver).
3. Cada salto recebe uma classificação de tipo: decisão da pessoa em um portão (gate), decisão da pessoa em uma espera (wait), passo pendente deixado por um refazer de grupo, ou outro (com descrição).
4. Todos os saltos de cada liberação entram na lista; não se amostra nem se omite grupo (inclusive os "dezenas" da 75).
5. O resultado é um único registro, por liberação, com a contagem por etapa e os saltos repetidos identificados como padrão (mesma etapa, mesmo tipo, mais de uma vez).
6. Os motivos dados nas decisões são citados como registrados; nada é traduzido ou resumido na lista de saltos individuais.
7. Se algum salto não tiver motivo registrado nem rastro suficiente para classificar, ele fica classificado como "sem rastro", e conta como dado do exame (não é excluído).
8. O exame é leitura: nenhuma regra do fluxo, nenhum texto de interface e nenhum dado é alterado nesta entrega.
9. O registro do exame é entregue antes do corte da próxima liberação (beta), para que os achados informem o corte.

## Fora do escopo

- Mudar o comportamento do fluxo de liberação (portões, esperas, grupos e refazer), mesmo que o exame mostre um padrão ruim: mudanças têm que vir como pedido próprio, depois dos achados.
- Mudar como os saltos são registrados hoje, ou o texto exibido dos saltos.
- Examinar liberações além das três citadas (75, 151 e 115).
- Métricas de tempo de execução, custo ou produtividade; o exame é só sobre os saltos.

## Critérios de aceite

1. Aberto o registro da liberação da issue 75, cada passo mostrado como skipped aparece na lista com etapa, quem pulou e motivo (ou "sem rastro").
2. O mesmo vale para as liberações das issues 151 e 115: zero saltos fora da lista em cada.
3. A soma de saltos listados por liberação bate com a contagem de skipped visível no registro da própria liberação.
4. Cada salto tem exatamente um dos tipos classificados (decisão em portão, decisão em espera, pendente por refazer, outro com descrição, sem rastro).
5. Padrões repetidos (mesma etapa, mesmo tipo, mais de uma ocorrência) estão nomeados no resumo do exame.
6. Consta no registro, para cada salto, de onde veio a informação (o registro da execução, a decisão no fórum do ciclo, ou ambos).
7. O registro do exame contém uma conclusão curta: o que o padrão dos saltos sugere mudar (ou "nada a mudar"), para a próxima retro decidir.
8. O exame está terminado antes de a próxima beta ser cortada.

## Perguntas em aberto (bloqueiam)

Nenhuma que bloquee o começo do exame. Não verificado nesta etapa: se as execuções 75, 151 e 115 têm todos os seus registros (histórico e fórum) preservados o suficiente para listar os motivos; o exame confirma isso nos primeiros passos e, se faltar rastro, a regra 7 se aplica.
