# Arquivos nas conversas: o que foi construído

## O que a pessoa passa a poder fazer

A caixa de escrita de qualquer conversa do fórum aceita arquivos — um botão, arrastar-e-soltar no computador, colar uma imagem e o seletor de arquivos do sistema. Vários arquivos cabem numa mensagem e cada um aparece antes do envio com o nome e o tamanho, e pode ser tirado dali. O aplicativo recusa, antes de enviar, o que passa dos limites ou não é de um tipo aceito, com o motivo; o tipo é decidido pelo conteúdo do arquivo, nunca pelo nome. Depois de enviada, uma imagem aparece como miniatura e abre em tamanho cheio, e qualquer outro arquivo aparece como um cartão com nome, tipo e tamanho que abre ou é salvo — na janela e no navegador pareado. Um agente chamado naquela conversa fica sabendo quais arquivos a mensagem carrega e os abre, somente leitura; uma imagem chega ao modelo como imagem e um texto como texto.

## O que foi feito, por peça

### O armazenamento e o tipo por conteúdo

`src/shared/attachments.ts` é a peça neutra: os tipos (`image`, `text`, `pdf`, `json`, `csv`), o `AttachmentRef` (`id`, `name`, `kind`, `bytes`), os limites de uma instalação nova (5 MB por imagem, 1 MB por outro arquivo, 10 MB e 10 arquivos por mensagem), o nome da ferramenta e o reconhecedor `detectAttachmentKind`, que olha a assinatura de uma imagem, o `%PDF-`, recusa um ZIP/Office e só então lê o texto (JSON quando começa por `{`/`[` e analisa; CSV quando tem ao menos duas linhas com o mesmo número de campos e uma vírgula; fora disso, texto).

`src/main/attachments.ts` é o registro: a pasta é `ATAS/anexos`, um arquivo por conversa em `anexos/<conversa>/<id><extensão>`. O `id` é curto e aleatório; a extensão sai do tipo que o conteúdo revelou, nunca do nome que a pessoa deu — o nome é dado, mostrado e não vira caminho. Um arquivo acima do limite ou de tipo recusado falha antes de qualquer escrita, então nada fica no disco. `drop` apaga, `get` devolve os bytes, `readForTool` prepara o que a ferramenta lê (imagem, texto cortado com linhas numeradas, ou o motivo de um PDF/JSON/CSV não ir ao modelo) e `holds` diz se um ref de uma mensagem ainda tem o arquivo.

### A mensagem do fórum e os canais novos

`src/shared/forum.ts` ganhou `attachments: AttachmentRef[]` na mensagem e um `anchor` interno. `src/main/forum-core.ts` valida os dois no esquema do `.jsonl`. `src/main/forum.ts` serve quatro canais novos: `forum:attachment-put` (os bytes, base64, um arquivo por chamada), `forum:attachment-post` (a mensagem com os refs), `forum:attachment-drop` (remover antes de enviar) e `forum:attachment-get` (os bytes de um arquivo que a mensagem carrega). O `forum:attachment-get` só responde quando a mensagem existe e a sua âncora é a da conversa pedida — é isso que faz “um agente chamado noutra conversa não abre esses arquivos” ser verdadeiro e testável sem tela.

Os quatro canais entram na mesma lista aberta ao navegador pareado (`src/main/webPolicy.ts`), não são janela-exclusiva nem efeito externo, e as três chamadas de escrita entram na fila do telefone (`src/shared/outbox.ts`) com o `isQueueable` que o teste do outbox já exige que a política permita.

### A limpeza e a retenção

`src/shared/retention.ts` passou a conhecer o grupo `anexos` e `src/main/retention.ts` varre as pastas de conversa: um arquivo que uma mensagem ainda referencia fica (`referencedAttachments`), o resto é escolhido por idade como os outros dados, um registro que aponte para um arquivo já apagado não falha, e a pasta de conversa que ficou vazia é recolhida.

### A tela

`src/renderer/src/screens/cycle/Attachments.tsx` desenha a miniatura de imagem e o cartão, e busca os bytes pelo canal. `Thread.tsx` ganhou no compositor o botão de anexo, o arrastar-e-soltar, o colar de imagem e a lista de preparação (nome, tamanho, remover), o aviso único de que o que um agente lê sai do computador, e passou a mostrar os anexos de toda mensagem (o bloco de documentos de uma execução continua restrito à conversa da execução). `forumApi.ts` chama os canais novos; `ui-cycle.{en,pt-BR}.json` tem as chaves.

### O agente que abre os arquivos

`src/main/attachmentTool.ts` é a ferramenta `ConversationAttachment` nos dois formatos: um `ToolImpl` para o motor aberto e um servidor MCP em processo para o SDK. Ela resolve o ref dentro da conversa em que o agente foi chamado, nunca um caminho; a resposta de texto traz o nome, o tipo e o tamanho. No motor fechado a imagem volta como bloco de imagem; no motor aberto a imagem viaja como pedaço de imagem numa mensagem de usuário logo depois do resultado de ferramenta, que continua texto. `mentionCall` recebe os `attachments` e escreve a seção com id, nome, tipo e tamanho; o executor passa os arquivos da resposta da etapa que carrega arquivos.

### A configuração

`attachments` é um bloco novo do `WorkspaceConfig` (`enabled`, `limits`, `agents`), com padrões numa instalação nova, no JSON Schema, na validação e no `WEB_EDITABLE` (o editor do navegador pareado). A tela Settings › Team e ciclo ganhou a aba Arquivos (`AttachmentsSection.tsx`).

## O que este etapa verificou

Rodado nesta etapa, com o resultado que saiu:

- `npx tsc --noEmit` — limpo.
- `npm run i18n:lint` — limpo (4118 chaves nos dois idiomas).
- `node scripts/theme-audit.mjs` — limpo, sem cor literal nova (as 8 de `api.ts` já existiam).
- `node scripts/public-audit.mjs` — limpo (920 arquivos).
- Testes novos e tocados, todos verdes: `attachments-kind` (13), `attachments-store` (13), `forum-attachments` (7), `attachments-view` (9), `attachments-tool` (7), `engine-open-attachments` (4), `mentions-attachments` (4), `attachments-retention` (5), além de `main-catalogs`/`ui-i18n`/`gitlab-catalogs-unchanged` (34), `forum-policy`, `forum-store`, `web-outbox`, `web-server`, `config-schema`, `config-validate` e `cycle-prompts`.
- A suíte inteira foi rodada; o que falhou foram suítes de ambiente/pré-existentes (conflitos, sandbox-bwrap, release-git/release-script, scripts de release/update) e testes sensíveis a tempo que passam quando rodados isolados — nenhuma falha de anexo.

Não verificado nesta etapa:

- com um aparelho pareado real, o envio de um arquivo perto do limite pelo corpo de 15 MB;
- com um provedor compatível real, a aceitação de um pedaço de imagem no histórico do motor aberto;
- no aplicativo aberto, a miniatura, o cartão, o arrastar-e-soltar e o seletor do telefone funcionando de ponta a ponta;
- a leitura da imagem pelos dois motores produzindo a resposta que o aceite descreve.

## Uma limitação honesta

Quando a mensagem com arquivos é a resposta que uma execução espera, o arquivo não fica preso à mensagem `answer` que o runner grava: o handler devolve a mensagem do runner e não escreve uma segunda (evitei um post duplicado do mesmo texto). Nesse caso, os arquivos enviados ficam na pasta da conversa e a varredura de retenção os recolhe. O caminho comum (mensagem que não responde à execução) carrega os arquivos na própria mensagem.
