# Arquivos nas conversas: o que foi construído

## O que a pessoa passa a poder fazer

A caixa de escrita de qualquer conversa do fórum aceita arquivos — um botão, arrastar-e-soltar no computador, colar uma imagem e o seletor de arquivos do sistema. Vários arquivos cabem numa mensagem e cada um aparece antes do envio com o nome e o tamanho, e pode ser tirado dali. O aplicativo recusa, antes de enviar, o que passa dos limites ou não é de um tipo aceito, com o motivo; o tipo é decidido pelo conteúdo do arquivo, nunca pelo nome. Depois de enviada, uma imagem aparece como miniatura e abre em tamanho cheio, e qualquer outro arquivo aparece como um cartão com nome, tipo e tamanho que abre ou é salvo — na janela e no navegador pareado. Um agente chamado naquela conversa fica sabendo quais arquivos a mensagem carrega e os abre, somente leitura; uma imagem chega ao modelo como imagem e um texto como texto.

Uma mensagem também pode ser apagada, e os arquivos que ela carregava vão junto: a mensagem pede confirmação, dizendo quantos arquivos serão apagados do disco, e some da conversa com eles. Quando a mensagem com arquivos é a resposta que uma execução espera, ela agora aparece como uma mensagem normal da conversa, com a miniatura e o cartão, e o agente que continua o trabalho recebe os arquivos.

## O que foi feito, por peça

### O armazenamento e o tipo por conteúdo

`src/shared/attachments.ts` é a peça neutra: os tipos (`image`, `text`, `pdf`, `json`, `csv`), o `AttachmentRef` (`id`, `name`, `kind`, `bytes`), os limites de uma instalação nova (5 MB por imagem, 1 MB por outro arquivo, 10 MB e 10 arquivos por mensagem), o nome da ferramenta e o reconhecedor `detectAttachmentKind`, que olha a assinatura de uma imagem, o `%PDF-`, recusa um ZIP/Office e só então lê o texto (JSON quando começa por `{`/`[` e analisa; CSV quando tem ao menos duas linhas com o mesmo número de campos e uma vírgula; fora disso, texto).

`src/main/attachments.ts` é o registro: a pasta é `ATAS/anexos`, um arquivo por conversa em `anexos/<conversa>/<id><extensão>`. O `id` é curto e aleatório; a extensão sai do tipo que o conteúdo revelou, nunca do nome que a pessoa deu — o nome é dado, mostrado e não vira caminho. Um arquivo acima do limite ou de tipo recusado falha antes de qualquer escrita, então nada fica no disco. `drop` apaga um arquivo, `dropAll` apaga os que uma mensagem nomeia, `dropFile` é a porta por onde a retenção apaga um arquivo pelo nome, `get` devolve os bytes, `readForTool` prepara o que a ferramenta lê (imagem, texto cortado com linhas numeradas, ou o motivo de um PDF/JSON/CSV não ir ao modelo) e `holds` diz se um ref de uma mensagem ainda tem o arquivo.

### A mensagem do fórum e os canais novos

`src/shared/forum.ts` ganhou `attachments: AttachmentRef[]` na mensagem e um `anchor` interno. `src/main/forum-core.ts` valida os dois no esquema do `.jsonl` e tem `remove(thread, seq)`, que grava a remoção como linha própria e devolve a mensagem como ela era, com os arquivos que carregava. `src/main/forum.ts` serve cinco canais: `forum:attachment-put` (os bytes, base64, um arquivo por chamada), `forum:attachment-post` (a mensagem com os refs), `forum:attachment-drop` (remover antes de enviar), `forum:attachment-get` (os bytes de um arquivo que a mensagem carrega) e `forum:attachment-delete` (apagar a mensagem e os arquivos dela). O `forum:attachment-get` e o `forum:attachment-delete` só respondem quando a mensagem existe e a sua âncora é a da conversa pedida — é isso que faz "um agente chamado noutra conversa não abre esses arquivos" ser verdadeiro e testável sem tela.

Os cinco canais entram na mesma lista aberta ao navegador pareado (`src/main/webPolicy.ts`), não são janela-exclusiva nem efeito externo, e as quatro chamadas de escrita entram na fila do telefone (`src/shared/outbox.ts`) com o `isQueueable` que o teste do outbox já exige que a política permita.

### A limpeza: apagar a mensagem e a retenção

Apagar uma mensagem apaga do disco os arquivos que ela carregava, que é o critério de aceite. O canal `forum:attachment-delete` lê os refs da mensagem que o armazenamento devolveu ao remover e entrega-os ao `dropAll` do registro — nunca usa um ref que venha de quem chamou, então um `seq` de outra conversa não nomeia nenhum arquivo aqui. É a pasta da mensagem, e não a da conversa, que é esvaziada: apagar uma mensagem no meio da conversa deixa os arquivos das vizinhas intactos, e um teste novo confere isso. Apagar uma mensagem que já não existe é nada a fazer.

`src/shared/retention.ts` conhece o grupo `anexos` e `src/main/retention.ts` varre as pastas de conversa: um arquivo que uma mensagem viva referencia fica (`referencedAttachments`), o resto é escolhido por idade como os outros dados, um registro que aponte para um arquivo já apagado não falha, e a pasta de conversa que ficou vazia é recolhida.

### A resposta que uma execução espera

Quando a mensagem com arquivos é a resposta que uma execução espera, os arquivos agora chegam à mensagem `answer` que o runner grava. O caminho é: o interceptor do fórum devolve a mensagem de resposta ao handler; a transição da resposta prende os arquivos à mensagem que ela grava (`Transition.attachments`, por índice da mensagem); o `moveRun` põe esses arquivos na mensagem que escreve no fórum; e o `answerPost` devolve a última mensagem `answer` lida do fórum, já com os refs. Assim a miniatura e o cartão aparecem nesse caminho e a varredura de retenção vê uma mensagem viva nomeando os arquivos.

O mesmo turno guarda os arquivos por execução e etapa até o primeiro turno da etapa que retoma, e passa-os ao `executeStage`: o agente da etapa alcança os arquivos na primeira rodada depois da resposta, em vez de só quando a execução volta a rodar. Essa guarda só vence a lista que veio da mensagem `answer` enquanto o arquivo do fórum não a tem; depois disso a mensagem é a fonte, e nada fica preso entre turnos.

### A tela

`src/renderer/src/screens/cycle/Attachments.tsx` desenha a miniatura de imagem e o cartão, e busca os bytes pelo canal. `Thread.tsx` ganhou no compositor o botão de anexo, o arrastar-e-soltar, o colar de imagem e a lista de preparação (nome, tamanho, remover), o aviso único de que o que um agente lê sai do computador, e passou a mostrar os anexos de toda mensagem (o bloco de documentos de uma execução continua restrito à conversa da execução). Cada mensagem ganhou o botão de apagar, que abre uma confirmação dizendo quantos arquivos vão junto; confirmada a remoção, a conversa é lida de novo do arquivo, e a mensagem apagada e os arquivos dela somem da tela. `forumApi.ts` chama os canais novos e sabe pedir essa releitura; `ui-cycle.{en,pt-BR}.json` tem as chaves.

### O agente que abre os arquivos

`src/main/attachmentTool.ts` é a ferramenta `ConversationAttachment` nos dois formatos: um `ToolImpl` para o motor aberto e um servidor MCP em processo para o SDK. Ela resolve o ref dentro da conversa em que o agente foi chamado, nunca um caminho; a resposta de texto traz o nome, o tipo e o tamanho. No motor fechado a imagem volta como bloco de imagem; no motor aberto a imagem viaja como pedaço de imagem numa mensagem de usuário logo depois do resultado de ferramenta, que continua texto. `mentionCall` recebe os `attachments` e escreve a seção com id, nome, tipo e tamanho; o executor passa os arquivos da resposta da etapa que carrega arquivos.

### A configuração

`attachments` é um bloco novo do `WorkspaceConfig` (`enabled`, `limits`, `agents`), com padrões numa instalação nova, no JSON Schema, na validação e no `WEB_EDITABLE` (o editor do navegador pareado). A tela Settings › Team e ciclo ganhou a aba Arquivos (`AttachmentsSection.tsx`).

## O que esta etapa verificou

Rodado nesta etapa, com o resultado que saiu:

- `npx tsc --noEmit` — limpo.
- `npm run i18n:lint` — limpo (4127 chaves nos dois idiomas, 11 catálogos).
- `node scripts/theme-audit.mjs` — limpo, 55 pares de contraste acima de 4.5:1, sem cor literal nova (as 8 de `api.ts` já existiam).
- Testes novos desta passada, todos verdes: `forum-attachment-delete` (4, a exclusão da mensagem no meio da conversa, os arquivos das vizinhas intactos, o `seq` de outra conversa recusado, um `seq` já apagado sem erro) e `runner-answer-attachments` (3, os refs na mensagem `answer` do runner, os arquivos no primeiro turno da etapa que retoma, e a opção do espaço de trabalho que os tira do agente mas não do que a pessoa vê).
- `test/runner-units.test.ts`, que uma rodada anterior da suíte deixou vermelho numa asserção de `pendingAnswer` (o campo `attachments` novo), foi corrigido e passou a verde.
- Suíte inteira rodada duas vezes: a primeira rodada terminou com 1 falha, a de `runner-units`, já corrigida; a segunda rodada foi interrompida pelo tempo limite do terminal antes de imprimir o resumo. As suítes citadas acima e os caminhos tocados (`forum-policy`, `forum-store`, `forum-view`, `web-outbox`, `attachments-tool`, `attachments-retention`, `mentions-attachments`, `cycle-prompts`, `main-catalogs`, `ui-i18n`, `config-schema`) passaram. Não é possível afirmar que a suíte inteira ficou verde nesta passada.

Não verificado nesta etapa:

- com um aparelho pareado real, o envio de um arquivo perto do limite pelo corpo de 15 MB;
- com um provedor compatível real, a aceitação de um pedaço de imagem no histórico do motor aberto;
- no aplicativo aberto, a miniatura, o cartão, o arrastar-e-soltar, o seletor do telefone e o botão de apagar funcionando de ponta a ponta;
- a leitura da imagem pelos dois motores produzindo a resposta que o aceite descreve.

## Uma limitação honesta

A guarda que leva os arquivos ao primeiro turno da etapa que retoma é por execução e etapa, e vive só neste processo. Os arquivos em si continuam na mensagem `answer` do fórum, que é a fonte que a retenção e a tela usam; se o aplicativo for fechado no instante entre a resposta e o primeiro turno, esse primeiro turno já recebe a etapa com a mensagem carregando os arquivos (o interceptor grava antes de retomar), e a lista do turno é uma cópia da mesma coisa. A guarda é, portanto, redundante depois da primeira vez, e não um segundo caminho de verdade.

Na tela, o botão de apagar aparece em toda mensagem, mas não há neste momento uma verificação exaustiva de onde ele fica quando a mensagem é longa; a tela rodando segue não verificada.
