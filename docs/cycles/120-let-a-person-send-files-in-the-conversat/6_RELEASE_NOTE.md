# A caixa de mensagem aceita arquivos, e os agentes abrem o que foi enviado

## O que mudou

A caixa de escrita de qualquer conversa — a de uma execução, uma conversa geral, um canal ou a conversa direta com um agente — agora aceita arquivos. Antes, para mostrar um defeito, um registro de erro ou uma referência de desenho, só restava descrever em palavras; agora dá para enviar o arquivo junto da mensagem.

Um arquivo pode entrar por um botão, por arrastar-e-soltar no computador, colando uma imagem ou pelo seletor de arquivos do telefone. Vários arquivos cabem numa mensagem e cada um aparece antes de enviar com o nome e o tamanho, e pode ser tirado dali. O tipo é decidido pelo conteúdo do arquivo, nunca pelo nome que ele tem.

Na conversa, uma imagem aparece como miniatura e abre em tamanho cheio; qualquer outro arquivo aparece como um cartão com nome, tipo e tamanho, que abre ou é salvo — na janela e no navegador pareado.

Um agente chamado naquela conversa fica sabendo quais arquivos a mensagem carrega e consegue abri-los, somente leitura: uma imagem chega ao modelo como imagem e um texto como texto. O agente nunca recebe o caminho do arquivo no computador e só alcança os arquivos da conversa em que foi chamado.

Uma mensagem também pode ser apagada, e os arquivos que ela carregava vão junto: a remoção pede confirmação, avisando quantos arquivos serão apagados, e a mensagem some da conversa com eles.

## Como usar

1. Abra qualquer conversa, escreva a mensagem e anexe os arquivos pelo botão, por arrastar-e-soltar, colando uma imagem ou, no telefone, pelo seletor do sistema.
2. Antes de enviar, confira os arquivos na lista de preparação (nome e tamanho) e remova o que não for, se precisar.
3. Envie a mensagem. Na conversa, a imagem aparece como miniatura e abre em tamanho cheio; os demais arquivos aparecem como cartão e podem ser abertos ou salvos.
4. Para chamar um agente com os arquivos, use `@` na mensagem, responda à pergunta de uma execução ou deixe a etapa continuar depois da sua mensagem — o agente recebe os arquivos e os abre, somente leitura.
5. Para apagar uma mensagem e os arquivos dela, use o botão de apagar da mensagem e confirme.

## O que vale saber

- Os limites e os tipos aceitos são do espaço de trabalho, com padrões numa instalação nova: imagem até 5 MB, os demais tipos até 1 MB, até 10 MB e 10 arquivos por mensagem. Um arquivo acima do limite, de um tipo não aceito ou de tipo desconhecido é recusado antes do envio, com o motivo; os outros arquivos da mesma mensagem e a própria mensagem seguem.
- Os tipos aceitos são imagem, texto e registro de erro, PDF, JSON e CSV. O tipo é decidido pelo conteúdo, então um nome com a extensão trocada não engana a checagem.
- Uma imagem e um texto chegam ao modelo quando um agente os abre; um PDF, um JSON ou um CSV ficam guardados na conversa, podendo ser abertos e salvos, mas não vão ao modelo, e a ferramenta do agente diz o motivo.
- O que um agente lê aqui é enviado ao provedor de modelo: sai deste computador. A caixa de anexo avisa isso uma vez, e um espaço de trabalho pode desligar o envio de arquivos aos agentes — a pessoa continua anexando e vendo, e o agente chamado não os recebe.
- Um arquivo tirado da mensagem antes de enviar é apagado, e apagar a mensagem apaga os arquivos dela do disco.
- Os arquivos ficam guardados nos dados do espaço de trabalho, por conversa, nunca num repositório nem na cópia de trabalho da execução, e nada do que é anexado vai ao host de código.
- Foi conferido por comando nesta entrega: um arquivo acima do limite recusado com o motivo e sem nada guardado; o tipo pelo conteúdo com bytes reais; apagar a mensagem removendo do disco os arquivos dela; a mensagem de resposta de uma execução servindo e apagando os próprios arquivos; a ferramenta do agente lendo imagem e texto sem caminho e recusando um arquivo de outra conversa; e a imagem no motor aberto chegando como pedaço de imagem, contra um servidor de teste e sem rede.
- Não verificado: com um telefone real pareado, o envio de um arquivo perto do limite e a leitura da imagem pelo modelo de ponta a ponta; com um provedor de modelo real, a aceitação da imagem no motor aberto; e a tela rodando de ponta a ponta (a miniatura, o cartão, o arrastar-e-soltar, o seletor do telefone e o botão de apagar com a confirmação).
