# Um login numa tela virtual

Um agente precisa alcançar uma página atrás de um login. Ele não deve ver a senha, e a pessoa não
deve precisar digitá-la num chat.

**A tela.** O agente trabalha numa tela virtual que o aplicativo abre para ele — 1280×800, na
máquina, nunca a tela da própria pessoa — e conduz nela o navegador do aplicativo. A pessoa pode
assistir a essa tela pelo cartão da execução, e o aplicativo a grava enquanto houver uma janela
desenhada nela.

**O pedido.** Quando o agente chega ao login, ele chama a ferramenta de entrega com uma frase sobre
o que precisa. Ele não pode pedir uma senha na conversa nem aceitar uma no texto de uma ferramenta.
Um cartão aparece onde o agente trabalha, e o celular é avisado de que o agente espera **no
computador**.

**A entrega.** A pessoa assume a tela depois de um aviso que diz que o intervalo é gravado. O
controle fica ligado sem chave, e o que ela digita vira eventos no teclado da tela virtual: o
navegador do agente vê o campo preenchido, e a senha da pessoa não passa pelo modelo, pela conversa,
pela auditoria nem pelo registro de passos. Nenhum quadro da tela vai a um leitor pareado enquanto a
pessoa a tem.

**A devolução.** A pessoa devolve a tela, e daí em diante o que ela digitou aparece como `[secret]`
em toda leitura do navegador do aplicativo e na saída dos comandos do agente. O limite é dito com
todas as letras: a máscara dura o que durar a etapa ou a resposta que tomou o intervalo, então um
valor que ainda esteja na página depois pode ser lido pela próxima — envie o formulário ou limpe o
campo antes de devolver a tela.

Tudo isso, inclusive o que o aplicativo não consegue prometer, está em
[O runner](/reference/runner.pt-br#a-tela-virtual-de-qualquer-agente-177).

<!-- site:image-placeholder -->
> **Captura (pendente).** O aviso antes de a pessoa assumir uma tela que um agente entregou. Sai do
> aplicativo, de um espaço de trabalho semeado com dados fictícios, refeita a cada versão.
