# Issues abertas com o rótulo e sem responsável aparecem na tela de execuções, com um jeito de iniciar à mão

## O que se pede

A pedido está citado nas palavras de quem abriu:

> The runner only starts issues that carry its label and are assigned to the person (the code host is asked for the person's own issues). An issue with the label and no assignee is silently ignored today. The runs screen lists such issues and offers to start one by hand.
>
> The runs screen lists open issues that carry the trigger label and have no assignee, with a way to start a run for one. Nothing starts by itself from that list.
>
> Needs a query of its own: the person's own issues do not include unassigned ones.

O pedido é só o que está acima: hoje uma issue com o rótulo de gatilho e sem ninguém
assumido fica fora da varredura automática e não tem onde aparecer; a tela de execuções
passa a listar essas issues e a oferecer iniciar uma por vez à mão.

## O que muda para quem usa

Hoje a pessoa que carrega o rótulo de gatilho numa issue sem responsável não vê nada:
o app só enxerga, para iniciar sozinho, as issues do rótulo que estão atribuídas à
pessoa, e a issue sem responsável é ignorada em silêncio.

Depois da mudança, a tela de execuções deixa de mostrar só as execuções que existem e
passa a mostrar também as issues abertas, do projeto, que carregam o rótulo de gatilho e
não têm ninguém assumido. Para cada uma delas há um jeito de iniciar a execução à mão,
numa ação única e explícita da pessoa. Nada inicia sozinho a partir dessa lista: entrar
na tela, olhar a lista ou qualquer outra coisa que não seja o gesto de iniciar não cria
execução.

O comportamento atual da varredura automática não muda: uma issue do rótulo e sem
responsável continua sem iniciar sozinha, porque a conquista desta mudança é justamente
dar à pessoa o controle manual onde antes não havia nada.

## Regras

- **A lista mostra só o que foi pedido:** issues abertas do projeto com o rótulo de
  gatilho configurado e sem nenhum responsável. Issue fechada, issue com responsável ou
  issue sem o rótulo não entra na lista.
- **Iniciar é manual e por gesto explícito:** para cada item da lista há um jeito de
  iniciar a execução; a pessoa age, a execução começa. Nada na lista inicia por si
  mesmo, em nenhum momento.
- **A varredura automática fica intacta:** a fonte da varredura (as issues do rótulo
  atribuídas à pessoa) não muda de comportamento e não passa a incluir as sem
  responsável.
- **Apresentação e texto são decisão de produto:** onde a lista entra na tela, como se
  chama, o texto do controle de iniciar e o estado de uma issue que já virou execução
  são escolhas desta especificação, abertas para quem implementa decidir com bom senso
  dentro do mesmo comportamento.

## Critérios de aceite

Cada item é conferível por uma pessoa, sem ler código.

1. Na tela de execuções, uma issue aberta do projeto, com o rótulo de gatilho e sem
   responsável, aparece listada.
2. Para essa issue listada existe um controle para iniciar a execução; ao usá-lo, a
   execução daquela issue começa.
3. Uma issue fechada com o rótulo e sem responsável não aparece na lista.
4. Uma issue aberta com responsável e com o rótulo não aparece nessa parte da tela (ela
   já existe na varredura automática).
5. Não há gesto que não seja o de iniciar que crie execução a partir da lista: abrir a
   tela, navegar, atualizar a lista etc. não inicia nada.
6. A varredura automática se comporta como antes: uma issue com o rótulo e sem
   responsável não inicia sozinha, e as que a varredura já iniciaria continuam
   iniciando.
7. Uma issue da lista que já tem execução não permite iniciar de novo sem que a pessoa
   diga que quer (não duplica execução por acidente), seguindo o mesmo comportamento que
   outras formas de iniciar já têm.

## Fora do escopo

- Mudar a varredura automática para incluir as issues sem responsável: o aceite pede
  explicitamente que nada inicie por si mesmo a partir da lista; a varredura fica como
  está.
- A documentação e a dica do campo do gatilho: ficaram na issue de origem da divisão e
  não entram aqui.
- Dispensar ou tornar opcional a exigência de responsável na varredura: não está pedido
  e não entra.
- Mudar como o provedor de código consulta ou filtra issues: a lista nova usa uma
  consulta própria das issues abertas do projeto por rótulo, que o provedor já expõe;
  não há mudança de provedor.

## Perguntas em aberto

Nenhuma pendência com quem abriu: o pedido é completo e traz os critérios de aceite. A
única decisão em aberto é de apresentação (onde a lista entra, o texto do controle de
iniciar, o estado de uma issue já iniciada), que fica com quem implementa dentro do
comportamento descrito acima.
