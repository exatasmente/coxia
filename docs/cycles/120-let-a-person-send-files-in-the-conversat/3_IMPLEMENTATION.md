# Arquivos nas conversas: o que foi construído

## O que a pessoa passa a poder fazer

A caixa de escrita de qualquer conversa do fórum aceita arquivos — um botão, arrastar-e-soltar no computador, colar uma imagem e o seletor de arquivos do sistema. Vários arquivos cabem numa mensagem e cada um aparece antes do envio com o nome e o tamanho, e pode ser tirado dali. O aplicativo recusa, antes de enviar, o que passa dos limites ou não é de um tipo aceito, com o motivo; o tipo é decidido pelo conteúdo do arquivo, nunca pelo nome. Depois de enviada, uma imagem aparece como miniatura e abre em tamanho cheio, e qualquer outro arquivo aparece como um cartão com nome, tipo e tamanho que abre ou é salvo — na janela e no navegador pareado. Um agente chamado naquela conversa fica sabendo quais arquivos a mensagem carrega e os abre, somente leitura; uma imagem chega ao modelo como imagem e um texto como texto.

Uma mensagem também pode ser apagada, e os arquivos que ela carregava vão junto: a mensagem pede confirmação, dizendo quantos arquivos serão apagados do disco, e some da conversa com eles. Isso vale igual nas duas formas de mensagem de uma conversa de execução: a mensagem que a pessoa escreve à mão e a resposta que a execução registra quando a pessoa responde à pergunta dela. Na resposta, a miniatura e o cartão aparecem, os arquivos abrem e o agente que continua o trabalho os recebe.

## O que foi feito, por peça

### O armazenamento e o tipo por conteúdo

`src/shared/attachments.ts` é a peça neutra: os tipos (`image`, `text`, `pdf`, `json`, `csv`), o `AttachmentRef` (`id`, `name`, `kind`, `bytes`), os limites de uma instalação nova (5 MB por imagem, 1 MB por outro arquivo, 10 MB e 10 arquivos por mensagem), o nome da ferramenta e o reconhecedor `detectAttachmentKind`, que olha a assinatura de uma imagem, o `%PDF-`, recusa um ZIP/Office e só então lê o texto (JSON quando começa por `{`/`[` e analisa; CSV quando tem ao menos duas linhas com o mesmo número de campos e uma vírgula; fora disso, texto).

`src/main/attachments.ts` é o registro: a pasta é `ATAS/anexos`, um arquivo por conversa em `anexos/<conversa>/<id><extensão>`. O `id` é curto e aleatório; a extensão sai do tipo que o conteúdo revelou, nunca do nome que a pessoa deu — o nome é dado, mostrado e não vira caminho. Um arquivo acima do limite ou de tipo recusado falha antes de qualquer escrita, então nada fica no disco. `drop` apaga um arquivo, `dropAll` apaga os que uma mensagem nomeia, `dropFile` é a porta por onde a retenção apaga um arquivo pelo nome, `get` devolve os bytes, `readForTool` prepara o que a ferramenta lê (imagem, texto cortado com linhas numeradas, ou o motivo de um PDF/JSON/CSV não ir ao modelo) e `holds` diz se um ref de uma mensagem ainda tem o arquivo.

### A mensagem do fórum e os canais novos

`src/shared/forum.ts` ganhou `attachments: AttachmentRef[]` na mensagem e um `anchor` interno. `src/main/forum-core.ts` valida os dois no esquema do `.jsonl` e tem `remove(thread, seq)`, que grava a remoção como linha própria e devolve a mensagem como ela era, com os arquivos que carregava. `src/main/forum.ts` serve cinco canais: `forum:attachment-put` (os bytes, base64, um arquivo por chamada), `forum:attachment-post` (a mensagem com os refs), `forum:attachment-drop` (remover antes de enviar), `forum:attachment-get` (os bytes de um arquivo que a mensagem carrega) e `forum:attachment-delete` (apagar a mensagem e os arquivos dela). O `forum:attachment-get` e o `forum:attachment-delete` só respondem quando a mensagem existe e a sua âncora é a da conversa pedida — é isso que faz "um agente chamado noutra conversa não abre esses arquivos" ser verdadeiro e testável sem tela. Os cinco canais entram na mesma lista aberta ao navegador pareado (`src/main/webPolicy.ts`), não são janela-exclusiva nem efeito externo, e as quatro chamadas de escrita entram na fila do telefone (`src/shared/outbox.ts`).

### A âncora da mensagem que a execução registra

Toda mensagem que o runner grava na conversa de uma execução passa agora pela mesma âncora que o módulo do fórum põe numa mensagem escrita: `moveRun` (`src/main/runs-forum.ts`) calcula `threadAnchor(runThreadId(id))` e põe na mensagem, preservando a âncora que a própria mensagem já traga. Antes desta passada, a mensagem `answer` que o runner escreve ficava com `anchor: null`, e os dois canais de arquivo — que exigem a âncora da conversa — a recusavam: os anexos de uma resposta não abriam (sem miniatura, sem cartão, sem download) e apagá-la não removia os arquivos do disco. Com a âncora, os dois caminhos funcionam.

Quando a mensagem é a resposta que a execução espera, os arquivos chegam à mensagem `answer`: o interceptor do fórum devolve a mensagem de resposta ao handler; a transição `answer()` (`src/shared/runs/transitions.ts`) prende os arquivos à mensagem (`Transition.attachments`, por índice); o `moveRun` põe esses arquivos e a âncora na mensagem que escreve; e o `answerPost` devolve a última mensagem `answer` lida do fórum, já com os refs. O mesmo turno guarda os arquivos por execução e etapa até o primeiro turno da etapa que retoma e os passa ao `executeStage`, que os prefere à lista de `pendingAnswer` enquanto o arquivo do fórum não tem a mensagem; depois disso a mensagem é a fonte.

### A limpeza: apagar a mensagem e a retenção

Apagar uma mensagem apaga do disco os arquivos que ela carregava. O canal `forum:attachment-delete` lê os refs da mensagem que o armazenamento devolveu ao remover e entrega-os ao `dropAll` do registro — nunca usa um ref que venha de quem chamou, então um `seq` de outra conversa não nomeia nenhum arquivo aqui. Uma conversa que este workspace não conhece devolve `false` em vez de estourar. Apagar uma mensagem que já não existe é nada a fazer, e os arquivos das mensagens vizinhas ficam intactos.

`src/shared/retention.ts` conhece o grupo `anexos` e `src/main/retention.ts` varre as pastas de conversa: um arquivo que uma mensagem viva referencia fica (`referencedAttachments`, que lê `"attachments"` direto das linhas do `.jsonl` e por isso protege inclusive os de uma mensagem `answer`), o resto é escolhido por idade como os outros dados, um registro que aponte para um arquivo já apagado não falha, e a pasta de conversa que ficou vazia é recolhida.

### A tela

`src/renderer/src/screens/cycle/Attachments.tsx` desenha a miniatura de imagem e o cartão, e busca os bytes pelo canal. `Thread.tsx` ganhou no compositor o botão de anexo, o arrastar-e-soltar, o colar de imagem e a lista de preparação (nome, tamanho, remover), o aviso único de que o que um agente lê sai do computador, e passou a mostrar os anexos de toda mensagem (o bloco de documentos de uma execução continua restrito à conversa da execução). Cada mensagem ganhou o botão de apagar, que abre uma confirmação dizendo quantos arquivos vão junto; confirmada a remoção, a conversa é lida de novo do arquivo, e a mensagem apagada e os arquivos dela somem da tela. `forumApi.ts` chama os canais novos e sabe pedir essa releitura; `ui-cycle.{en,pt-BR}.json` tem as chaves.

### O agente que abre os arquivos

`src/main/attachmentTool.ts` é a ferramenta `ConversationAttachment` nos dois formatos: um `ToolImpl` para o motor aberto e um servidor MCP em processo para o SDK. Ela resolve o ref dentro da conversa em que o agente foi chamado, nunca um caminho; a resposta de texto traz o nome, o tipo e o tamanho. No motor fechado a imagem volta como bloco de imagem; no motor aberto a imagem viaja como pedaço de imagem numa mensagem de usuário logo depois do resultado de ferramenta, que continua texto. `mentionCall` recebe os `attachments` e escreve a seção com id, nome, tipo e tamanho; o executor passa os arquivos da resposta da etapa que carrega arquivos.

### A configuração

`attachments` é um bloco novo do `WorkspaceConfig` (`enabled`, `limits`, `agents`), com padrões numa instalação nova, no JSON Schema, na validação e no `WEB_EDITABLE` (o editor do navegador pareado). A tela Settings › Team e ciclo ganhou a aba Arquivos (`AttachmentsSection.tsx`).

## O que esta etapa verificou

Rodado nesta etapa, com o resultado que saiu:

- `npx tsc --noEmit` — limpo, código de saída 0.
- `npm run i18n:lint` — limpo (4127 chaves nos dois idiomas, 11 catálogos).
- `node scripts/theme-audit.mjs` — limpo, 55 pares de contraste acima de 4.5:1, sem cor literal nova (as 8 de `api.ts` já existiam).
- `node scripts/public-audit.mjs` — limpo, 927 arquivos.
- `npx electron-vite build` — construído, código de saída 0.
- `npx vitest run` — a suíte inteira: 233 arquivos, 3734 testes. Duas das três execuções desta passada saíram inteiras verdes; numa delas um arquivo (`test/runner-flow.test.ts`) estourou o limite de 5 s por teste sob a carga de 233 processos e o arquivo saiu marcado como falho sem nenhum teste reprovado (os 3734 testes passaram nas três execuções). Rodado sozinho, `runner-flow.test.ts` passa (17 testes). É o mesmo estouro de tempo sob carga paralela que a passada anterior viu em 16 arquivos.
- Teste novo `test/runner-answer-attachment-open.test.ts` (1): grava uma resposta como o runner a grava e confirma que os bytes dos dois arquivos são servidos pela mensagem `answer` e que apagar essa mensagem remove os dois arquivos do disco. É o caminho que a revisão apontou como bloqueante, agora coberto.
- `test/runner-answer-attachments.test.ts` (3): os refs na mensagem `answer` do runner, os arquivos no primeiro turno da etapa que retoma, e a opção do espaço de trabalho que os tira do agente mas não do que a pessoa vê; a configuração montada à mão deixou de omitir `limits`.

Não verificado nesta etapa:

- com um aparelho pareado real, o envio de um arquivo perto do limite pelo corpo de 15 MB;
- com um provedor compatível real, a aceitação de um pedaço de imagem no histórico do motor aberto;
- no aplicativo aberto, a miniatura, o cartão, o arrastar-e-soltar, o seletor do telefone e o botão de apagar funcionando de ponta a ponta;
- a leitura da imagem pelos dois motores produzindo a resposta que o aceite descreve.

## Uma limitação honesta

A guarda que leva os arquivos ao primeiro turno da etapa que retoma é por execução e etapa, e vive só neste processo. Os arquivos em si continuam na mensagem `answer` do fórum, que é a fonte que a retenção e a tela usam; se o aplicativo for fechado no instante entre a resposta e o primeiro turno, esse primeiro turno já recebe a etapa com a mensagem carregando os arquivos, e a lista do turno é uma cópia da mesma coisa. A guarda é, portanto, redundante depois da primeira vez, e não um segundo caminho de verdade.

Na tela, o botão de apagar aparece em toda mensagem, mas não há neste momento uma verificação exaustiva de onde ele fica quando a mensagem é longa; a tela rodando segue não verificada.
