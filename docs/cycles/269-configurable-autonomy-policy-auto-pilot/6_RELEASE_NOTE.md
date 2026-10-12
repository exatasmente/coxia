# Escolha quais passos na tela a persona faz sozinha

## O que mudou

Antes, todo passo irreversível dado pela persona no navegador do app pedia a sua aprovação. Agora você pode definir, para cada tipo de passo, se ele **pede aprovação** ou **roda sem pedir**. Quem não configura nada não vê mudança: o padrão continua pedindo aprovação em tudo.

Os tipos de passo são os que o app já retinha:

1. envio de formulário;
2. controle com nome que indica um ato irreversível;
3. atalho de teclado;
4. diálogo;
5. passo que o app não consegue reconhecer;
6. confirmação pedida pelo próprio agente.

A regra pode ser definida em três níveis: agente, squad e espaço de trabalho. Vale o nível mais específico que tiver uma decisão para aquele tipo: primeiro o agente, depois o squad, depois o espaço de trabalho. Um nível que define só alguns tipos deixa os demais para o nível seguinte.

## Como usar

1. Abra as configurações do agente, do squad ou do espaço de trabalho e procure "Aprovações dos passos na tela".
2. Para cada um dos seis tipos, escolha "Pede aprovação" ou "Roda sem pedir". No agente e no squad também existe "Herdar", que deixa a decisão para o nível seguinte.
3. A grade mostra, para cada tipo, o modo em vigor e de qual nível ele vem (agente, squad, espaço de trabalho ou padrão).
4. Um passo liberado roda sem perguntar e deixa um registro marcado como autônomo, com o nível que o liberou.

## O que vale saber

- **Pagamento, envio a pessoas, senhas e segredos, e dados de cartão sempre pedem aprovação**, em qualquer nível e em qualquer tipo de passo. Se você tentar liberá-los, a liberação é ignorada e um aviso aparece. Se um passo liberado for retido por cair numa dessas categorias, a janela de aprovação explica o motivo. Exemplo: com "nome do controle" liberado, "Salvar rascunho" roda sozinho, mas "Pagar agora" e "Enviar mensagem" continuam perguntando.
- Essas quatro categorias são reconhecidas pelas palavras no nome do controle (em inglês e português) e por campos de senha. A detecção tem limites: um controle com nome genérico que na verdade paga pode não ser reconhecido, o atalho Enter num campo neutro com um botão "Pagar" pode passar se o envio de formulário estiver liberado, e o preenchimento automático de cartão não é lido.
- Uma mudança na regra vale a partir da próxima etapa; a etapa em andamento segue com a regra com que começou. Cada mudança é registrada.
- As instruções dadas ao agente mudam junto com a regra: quando algum tipo é liberado, elas dizem isso. Sem nada liberado, o texto é o mesmo de antes. O recurso de passar a tela para a pessoa não mudou.
- Um navegador pareado não consegue liberar passos, só tornar a regra mais restritiva. Modelos e importações de configuração não trazem liberações.
- Esta mudança não deve ir à produção sem a auditoria dos passos autônomos (#268).

## Ainda não verificado

A grade nas configurações e o aviso na janela de aprovação não foram vistos no app em execução; só passaram em testes automáticos.
