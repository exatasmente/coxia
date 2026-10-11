# As discussões de uma MR abrem a partir da conversa, mesmo quando ela não é um card do dia

## O que mudou

Antes, só dava para ver as discussões de uma merge request (MR) se ela fosse um card do dia. Para qualquer outra MR, o app mostrava "Atividade não encontrada".

Agora, numa conversa, a persona ou outro agente pode oferecer um botão que cita a MR (projeto e número, como `grupo/repositório!número`). Ao tocar nele, a tela de discussões abre com os threads ainda não resolvidos daquela MR, sem precisar de card. A conversa ganha uma linha dizendo qual MR foi aberta, e o voltar leva de volta à mesma conversa. O botão aparece no chat da persona, no Fórum e nas conversas de execução.

## Como usar

1. Numa conversa, peça as discussões de uma MR, com projeto e número.
2. Toque no botão que aparece sob a resposta.
3. Leia os threads, peça a explicação de um deles se quiser e use o voltar para retornar à conversa.

## O que vale saber

- Nada abre sozinho: a tela só abre quando a pessoa toca no botão.
- Só projetos permitidos no espaço de trabalho são lidos. Para uma MR de fora, ou um número que não é MR, nada abre e o aviso explica o motivo, em português e em inglês. Se o espaço de trabalho não nomeia nenhum projeto, o aviso orienta a nomeá-lo nas configurações.
- Numa MR que não é card do dia, a tela só mostra e explica os threads. Responder e marcar como resolvida continuam exigindo o card, e nada é escrito no host.
- A explicação de um thread sem card funciona, mas sem a linha de contexto do card.
- Os cards do dia abrem as discussões como antes.
- Cada toque no mesmo botão registra uma nova linha na conversa.
- Numa conversa de execução, o escopo da execução ainda não estreita a lista de projetos: vale a lista do espaço de trabalho.

## O que ainda não foi conferido

Os testes automáticos e as checagens do projeto passaram, mas a tela não foi aberta no app (chat, Fórum, execução, linha na conversa e voltar). O celular pareado também não foi testado.
