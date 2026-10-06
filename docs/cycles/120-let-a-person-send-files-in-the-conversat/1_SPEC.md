# Arquivos na conversa, e os agentes abrindo o que foi enviado

## O que se pede

A pessoa escreve num fórum onde hoje só cabe texto. O pedido, nas palavras da issue:

> A person can send files in any conversation of the forum (a run's conversation, a general conversation, a channel, the direct conversation with an agent), from the app and from a paired browser, and the agents that take part in that conversation can open them.
>
> Today a message only points at files of the run's cycle folder (`ArtifactRef`, `src/shared/forum.ts`); a person has no way to attach anything, so a screenshot of a bug, a log or a design reference has to be described in words.

E as três partes, também citadas:

> ### 1. Attaching
>
> - The message box takes files: a button, drag and drop on the computer, paste of an image, the file picker on the phone. Several files per message, each shown before sending with its name and size, and removable.
> - Limits, set in the workspace (with defaults): size per file, size per message, and the kinds accepted (images, text and logs, PDF, JSON/CSV; anything else refused with the reason). The kind is checked by the content, not by the name.
> - A file is kept in the workspace's data, by conversation (`workspaces/<id>/…`), never in a repository and never in the run's worktree. A file the person removes from a message is deleted.

> ### 2. Showing
>
> - An image shows as a thumbnail in the message and opens full size; any other file shows as a chip with name, kind and size, and opens or saves.
> - The paired browser shows and downloads them through the same web policy as the rest of the forum.

> ### 3. The agents read them
>
> - An agent called in that conversation (a mention, the answer to a question, the stage that resumes after the person's message) is told which files the message carries and gets a read-only tool to open them: an image goes to the model as an image (on both engines: the open engine's `Read` refuses binary files today), text as text, capped.
> - An agent never gets a path on the computer; it only reaches the files of the conversation it was called in.
> - What is sent to a model provider leaves the computer: the attach box says so once, and a workspace may turn attachments to agents off.

E o aceite, do mesmo jeito:

> - A person attaches an image and a log to a message in a run's conversation, from the computer and from a paired phone; both are shown and open.
> - A file over the limit, or of a refused kind (checked by content), is refused before sending, with the reason.
> - An agent called with `@` in that message describes what the image shows and quotes the log, on both engines.
> - An agent called in another conversation cannot open those files.
> - Deleting the message deletes its files from disk.

## O que muda para quem usa

Hoje, para mostrar um defeito, um registro de erro ou uma referência de desenho, só resta descrever em palavras: a mensagem carrega apenas os documentos que o aplicativo publicou sozinho e não tem onde pendurar um arquivo da pessoa.

Depois desta mudança, a caixa de escrita de qualquer conversa do fórum aceita arquivos: um botão, arrastar-e-soltar no computador, colar uma imagem da área de transferência e, no telefone pareado, o seletor de arquivos do sistema. Vários arquivos cabem numa mensagem. Antes de enviar, cada um aparece com o nome e o tamanho e pode ser tirado dali. O aplicativo recusa, antes de enviar, o que passa dos limites do espaço de trabalho ou não é de um tipo aceito, e diz o motivo; o tipo é decidido pelo conteúdo do arquivo, não pelo nome dele.

Na conversa, uma imagem aparece como miniatura dentro da mensagem e abre em tamanho cheio; qualquer outro arquivo aparece como um cartão com nome, tipo e tamanho, que abre ou é salvo. O mesmo vale na janela do aplicativo e no navegador pareado, que pode baixar o arquivo.

Os agentes chamados naquela conversa — por `@`, na resposta a uma pergunta ou na etapa que continua depois da mensagem da pessoa — ficam sabendo quais arquivos a mensagem carrega e podem abri-los, somente leitura: uma imagem chega ao modelo como imagem, nos dois motores, e um texto chega como texto, com um teto. Nenhum agente recebe um caminho no computador: ele alcança apenas os arquivos da conversa em que foi chamado. O que sai para um provedor de modelo deixa o computador; a caixa de anexo avisa isso uma vez, e um espaço de trabalho pode desligar anexos para os agentes.

## As regras

1. **Onde se anexa.** A caixa de escrita aceita arquivos em qualquer conversa do fórum: a conversa de uma execução, uma conversa geral, um canal e a conversa direta com um agente. Valem o computador e o navegador pareado.
2. **Como se anexa.** Botão, arrastar-e-soltar no computador, colar de imagem e o seletor de arquivos no telefone. Vários arquivos por mensagem.
3. **Antes de enviar.** Cada arquivo aparece com nome e tamanho e pode ser removido da mensagem. A mensagem só sai quando a pessoa envia.
4. **Tipo pelo conteúdo.** O tipo é decidido pelo conteúdo do arquivo, não pelo nome. Um nome com a extensão trocada não engana a checagem.
5. **Limites com padrão, no espaço de trabalho.** Tamanho por arquivo, tamanho por mensagem e os tipos aceitos são do espaço de trabalho, com padrões que valem numa instalação nova. Os padrões propostos (a confirmar no portão, é decisão de produto, não de desenho): por arquivo, imagens até 5 MB e os demais tipos até 1 MB; por mensagem, 10 MB no total e no máximo 10 arquivos; tipos aceitos: imagens, texto e registro de erro (log), PDF, JSON e CSV.
6. **Recusa antes de enviar, com o motivo.** Um arquivo acima de qualquer limite, ou de um tipo fora da lista, é recusado antes de a mensagem ser enviada, com o motivo em palavras simples; nada dele é guardado. Um arquivo recusado não impede os demais nem o envio da mensagem.
7. **Onde o arquivo mora.** O arquivo fica guardado nos dados do espaço de trabalho, por conversa (`workspaces/<id>/…`). Nunca num repositório, nunca na cópia de trabalho da execução e nunca na pasta do ciclo. O que é guardado é o arquivo; o caminho no computador não vira conteúdo de mensagem.
8. **Remover antes de enviar apaga.** Um arquivo tirado da mensagem antes do envio é apagado dos dados do espaço de trabalho.
9. **Excluir a mensagem apaga os arquivos dela.** Apagar a mensagem apaga do disco os arquivos que ela carregava. Uma limpeza que encontre um arquivo de mensagem que já não existe não falha.
10. **Imagem e demais arquivos na tela.** Uma imagem aparece como miniatura na mensagem e abre em tamanho cheio. Qualquer outro arquivo aparece como um cartão com nome, tipo e tamanho, que abre ou é salvo. O cartão não mostra conteúdo do arquivo nem caminho no computador.
11. **O navegador pareado.** O navegador pareado mostra e baixa os arquivos pelo mesmo caminho do resto do fórum: um canal novo de arquivo entra na mesma lista aberta ao navegador, e continua sem ser uma janela-exclusiva e sem ser um efeito externo.
12. **O agente sabe o que a mensagem carrega.** Um agente chamado naquela conversa é informado dos arquivos que a mensagem carrega (nome, tipo e tamanho, sem caminho no computador) e recebe uma ferramenta somente leitura para abri-los, dentro dos limites do espaço de trabalho.
13. **Imagem chega como imagem, texto como texto.** Nos dois motores, uma imagem chega ao modelo como imagem e um texto chega como texto, cortado no teto. No motor aberto, onde a leitura de arquivo binário é recusada hoje, isso é uma mudança de comportamento desta entrega.
14. **Um agente nunca recebe um caminho.** A ferramenta do agente só alcança os arquivos da conversa em que ele foi chamado. Um agente chamado noutra conversa não abre o arquivo de uma mensagem de outra.
15. **Somente leitura.** A ferramenta não escreve, não apaga e não muda nada; a regra de que um agente chamado responde somente leitura continua valendo igual.
16. **O que sai do computador está dito.** A caixa de anexo avisa uma vez que o que é enviado a um provedor de modelo deixa o computador. O aviso é do espaço de trabalho e aparece no idioma da pessoa.
17. **O espaço de trabalho pode desligar anexos para agentes.** Com essa opção desligada, a pessoa continua anexando e vendo os arquivos na conversa; os agentes não os recebem, e a conversa diz por quê.
18. **Os documentos de uma execução não mudam.** O que o aplicativo já mostra dos documentos da pasta do ciclo continua igual; um anexo da pessoa é coisa à parte, com nome, tipo e tamanho próprios, e não é um documento da execução.
19. **Um anexo que responde a pergunta da execução.** Quando a mensagem é a resposta que a execução espera, os arquivos dela entram junto com a resposta, e uma imagem chega ao modelo como imagem. Não há um segundo caminho de anexo só para esse caso.
20. **Limpeza e retenção.** Uma varredura de retenção pode apagar anexos antigos quando a configuração do espaço de trabalho mandar, com o mesmo critério dos outros dados; o que ainda é referenciado por uma mensagem que existe não é apagado pela varredura.
21. **Nenhum anexo vai ao host de código.** Nada do que a pessoa anexa é publicado no rastreador, nem no comentário da etapa, nem na descrição do pull request.
22. **Idioma e tema.** Todo texto novo que a pessoa lê passa pelos catálogos nos dois idiomas, e a tela usa os tokens do tema, não cores escritas à mão.

## Fora do escopo

- Agentes criarem arquivos por conta própria e os publicarem na conversa: é a issue de evidência, que se apoia nesta e separada dela.
- Enviar anexos ao host de código, ou publicá-los no rastreador de qualquer forma.
- Guardar um arquivo num repositório ou na cópia de trabalho da execução.
- Pré-visualizar conteúdo dentro da conversa além da miniatura da imagem: PDF, JSON, CSV e logs abrem ou são salvos, não são renderizados ali.
- Editar um anexo depois de enviado, ou trocá-lo por outro: para mudar o que foi enviado, envia-se outra mensagem.
- Um anexo valer para toda a execução, fora da mensagem que o carrega.
- Escolher anexos falando, ou ler em voz alta o conteúdo de um arquivo anexado.
- Mais formatos do que os aceitos nesta entrega: acrescentar um tipo é uma mudança futura, com o mesmo cuidado do tipo pelo conteúdo.
- Mover a cota de leitura da pasta do ciclo, ou fazer o anexo dividir esse orçamento: é decisão do plano técnico, e o comportamento aqui não depende dela.

## Critérios de aceite

Cada item é algo que uma pessoa consegue conferir no aplicativo.

1. Numa conversa de execução, com o computador, a pessoa anexa uma imagem e um registro de erro numa mensagem; os dois aparecem antes do envio com nome e tamanho, e a mensagem enviada mostra a miniatura da imagem e o cartão do registro, e os dois abrem.
2. O mesmo, no telefone pareado: a pessoa escolhe os arquivos pelo seletor do sistema, eles aparecem antes do envio e, depois, a miniatura e o cartão aparecem na conversa e o arquivo é baixado.
3. Numa conversa geral, num canal e na conversa direta com um agente, anexar um arquivo funciona igual.
4. Um arquivo acima do limite do espaço de trabalho, ou de um tipo fora da lista, é recusado antes do envio, com o motivo; os outros arquivos da mesma mensagem e a mensagem em si seguem.
5. Um arquivo cujo nome diz um tipo aceito, mas cujo conteúdo é de outro tipo, é tratado pelo conteúdo.
6. Um arquivo tirado da mensagem antes do envio é apagado: ele não está mais nos dados do espaço de trabalho.
7. Apagar a mensagem apaga do disco os arquivos que ela carregava.
8. Um agente chamado com `@` naquela mensagem descreve o que a imagem mostra e cita trechos do registro de erro, nos dois motores.
9. Um agente chamado noutra conversa não consegue abrir os arquivos daquela mensagem.
10. Com o espaço de trabalho configurado para não dar anexos aos agentes, a pessoa continua anexando e vendo os arquivos, e o agente chamado não os recebe, com o motivo dito na conversa.
11. A caixa de anexo avisa uma vez que o que é enviado a um provedor de modelo deixa o computador.
12. Nenhum comando rodado por um agente recebe um caminho no computador do arquivo anexado, e a ferramenta com que ele abre o arquivo é somente leitura.
13. Nada do que a pessoa anexou aparece no rastreador.

## Como foi conferido

Nesta etapa foram lidos a issue, a triagem do ciclo e o código que a issue cita, além dos documentos do projeto. O que foi conferido, por leitura:

- Hoje uma mensagem da pessoa carrega só uma lista de referências a arquivos da pasta do ciclo, e essa lista é montada pelo aplicativo, nunca pela pessoa; a mensagem de uma pessoa aceita somente texto.
- O compositor da conversa é uma caixa de texto, sem botão de anexo, sem arrastar-e-soltar e sem colar de imagem.
- O bloco de arquivos de uma mensagem só é desenhado na conversa de uma execução.
- Os canais do fórum já são abertos à janela e ao navegador pareado, e um teste fixa exatamente os canais de hoje; um canal novo de arquivo não é coberto por esse teste.
- O navegador pareado envia uma chamada do tipo RPC com um teto de corpo de 15 MB, e o valor de um áudio enviado do telefone tem um teto próprio; a ida e a volta de bytes já existem no formato do fio, em base64.
- No motor aberto, a leitura de arquivo recusa binário e o resultado de ferramenta de um modelo é texto hoje; o tipo de imagem existe no fio, mas não é usado em nenhuma parte, e um teste do motor aberto confere as mensagens enviadas ao servidor, o que permite exercitar a mudança sem modelo real.
- O agente chamado por menção nunca recebe um caminho no computador: recebe a conversa e, quando executa comandos, uma cópia descartável.
- O redutor de credenciais apaga de 32 caracteres para cima em texto de formato misto, e o compositor permite 20.000 caracteres por mensagem; uma imagem enviada como texto no corpo da mensagem seria apagada por esse redutor, o que reforça o caminho de imagem próprio.
- Nada foi executado e nenhum comportamento novo foi visto funcionando: o estado atual foi conferido apenas por leitura, e todos os critérios de aceite acima estão **não verificados**.

## Prioridade e marco propostos

- **Prioridade: alta.** O motivo é o da triagem, e ele continua de pé: hoje um defeito, um registro de erro ou uma referência de desenho só podem ser descritos em palavras, e esta entrega é a base da evidência de QA e do trabalho que a issue diz ser a continuação dela. Fica abaixo de uma perda de dado ou de um risco de segurança, e não é um ajuste pequeno ou isolado.
- **Marco: nenhum proposto.** Esta etapa não alcançou a lista de marcos do rastreador; e a mudança atravessa telas, dados e os dois motores, sem relação com uma versão já anunciada. A pessoa decide se quer encaixá-la em algum.

## Perguntas em aberto

1. As referências da issue e do aceite dizem "image" e "text and logs". Vale a leitura restrita (uma imagem nunca vai como texto e um PDF, um JSON e um CSV nunca vão ao modelo) ou vale a leitura ampla (todo anexo a que o agente alcança é entregue ao modelo, e um tipo que ele não aceite é recusado com o motivo)? As regras acima seguem a leitura restrita; mudar isso muda os critérios 8 e 10.
2. Os padrões numéricos da regra 5 são decisão da pessoa: são os propostos que vão valer na instalação nova?
3. O teto de um arquivo enviado do telefone pareado: a mensagem do telefone leva os bytes codificados dentro de uma chamada única, que tem um teto de corpo de 15 MB no aplicativo, e um registro de erro perto do limite mais a codificação pode não caber. Um envio que não caiba é recusado com o motivo, ou a entrega precisa de um caminho próprio para o arquivo do telefone? A primeira opção é a mais simples e é o que a spec presume.
4. Como um anexo divide a cota de leitura da pasta do ciclo quando ele entra no texto de uma etapa, e onde o anexo fica guardado dentro dos dados do espaço de trabalho (a pasta por conversa, o nome do arquivo e o que acontece quando a conversa é removida) são decisões do plano técnico; o comportamento exigido aqui é o das regras 7, 8, 9, 19 e 20.
