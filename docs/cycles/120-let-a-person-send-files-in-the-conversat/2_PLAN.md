# Plano: enviar arquivos na conversa e os agentes abrirem o que foi enviado

## 1. O que muda, em uma frase

A mensagem do fórum ganha um campo próprio de anexos, e o aplicativo passa a guardar numa pasta de dados por conversa os arquivos que a pessoa anexa, a mostrá-los como miniatura ou cartão em qualquer conversa, a apagá-los quando a mensagem for apagada, e a entregá-los a um agente chamado por meio do nome do anexo (nunca um caminho no computador), chegando ao modelo como imagem no motor fechado e como parte de imagem no motor aberto; um canal novo do fórum serve os bytes e entra na mesma lista aberta ao navegador pareado.

## 2. As decisões que esta etapa fixa

O portão 1 aprovou a spec, que deixou para o plano quatro pontos técnicos. Ficam decididos aqui.

### 2.1 Onde o anexo mora, e como ele é apagado

- **A pasta.** `join(ATAS, 'anexos')` — isto é, `<dados do espaço de trabalho>/anexos`. O caminho que a issue escreve (`workspaces/<id>/…`) confere: o espaço de trabalho já vive em `DATA_ROOT/workspaces/<id>` (`workspaces-core.ts:52-55`), e `ATAS` é a pasta do espaço de trabalho em uso (`env.ts:15`). Não é preciso pasta nova na raiz dos dados.
- **Um arquivo por conversa.** `anexos/<id da conversa>/<id do anexo><extensão de catálogo>`. O `id do anexo` é curto (16 caracteres de base32) e aleatório; a extensão vem do tipo reconhecido pelo **conteúdo** e não tem relação nenhuma com o nome que a pessoa deu ao arquivo. Guardar por conversa é o que faz o alcance do agente cair de graça: um agente chamado na conversa A recebe, na chamada, só a pasta de A.
- **O nome que a pessoa deu é dado, não caminho.** Ele fica na mensagem e é usado só para mostrar. Um nome com barra, `..`, aspa ou espaço não muda onde o arquivo mora; a mensagem carrega o nome já sem controle, cortado em 200 caracteres, e a extensão de catálogo não sai dele.
- **Remover antes de enviar** apaga o arquivo na hora (o canal `forum:attachment-drop`), então um anexo que a pessoa tirou não fica no disco.
- **Excluir a mensagem** apaga a pasta daquela mensagem (`anexos/<conversa>/<seq>/`), e não a conversa inteira: excluir uma mensagem de uma conversa não pode apagar os anexos das outras.
- **Conversa apagada:** hoje não há como apagar uma conversa pelo aplicativo; fica fora desta entrega, e a varredura de retenção é quem recolhe a pasta órfã.
- **Retenção.** A varredura passa a conhecer o grupo `anexos` (rótulo nos catálogos), com o mesmo critério dos outros dados (idade, data de modificação) e a mesma proteção de referência: **um anexo referenciado por mensagem que existe não é apagado**, e um registro que aponte para um arquivo que já não existe não falha (regra 9 do spec). A referência é lida dos `.jsonl` do fórum.

### 2.2 O arquivo em base64 e o teto de 15 MB do RPC

O teto do corpo de uma chamada do navegador pareado é `MAX_BODY = 15 * 1024 * 1024` (`web.ts:15`), o corpo é JSON e o fio codifica `Uint8Array` em base64 (`wire.ts`). Um arquivo de 5 MB vira ~6,7 MB de base64; mais o JSON e a mensagem, cabe. A decisão é **um anexo por chamada** (`forum:attachment-put`), com a mensagem de sistema que o aplicativo escreve depois (`forum:attachment-post`): duas chamadas pequenas em vez de uma grande, e dois arquivos de 5 MB nunca somam no mesmo corpo.

- Cada uma das três chamadas é declarada em `isQueueable` (`src/shared/outbox.ts`) com chave de idempotência própria, para o reenvio do telefone após uma resposta perdida não gravar duas vezes.
- O médico de erros (o redutor de credenciais) roda sobre o `label` do anexo — o nome que a pessoa vê é curto e o que aparece ali é o nome, não o conteúdo — e **nunca** sobre os bytes: base64 de imagem seria apagado pelo redutor (32 caracteres ou mais em texto de formato misto, `errorlog-core.ts:26`), e os bytes não são texto.
- Recusa com motivo, e não um caminho de envio próprio, para um anexo do telefone que não caiba: a spec presume esse lado e a alternativa está dita na spec. **Não verificado** com um aparelho real.
- O anexo não toca a cota de leitura da pasta do ciclo: ele não é documento da execução (regra 18) e não entra no texto do prompt; o agente o lê pela ferramenta de anexo.

### 2.3 O anexo que responde a pergunta da execução

O caminho de hoje é de mão única: `forum:post` chama o interceptor antes de gravar, e `answerPost` some com o texto e devolve a mensagem de resposta (`forum.ts:64-66`, `service.ts:884-893`). Com o anexo isso muda de forma:

- O instrumento continua sendo a mensagem do fórum, com o texto da pessoa e os anexos nela; nada de um segundo caminho.
- Em vez de o interceptor consumir o post, ele **decide o tipo depois**: quando a mensagem da pessoa é a resposta que a execução espera (a execução está em `question`, não é pergunta de squad, o texto não tem menção), o handler de `forum:attachment-post` grava a mensagem como `kind: 'answer'` já com os anexos (e com `replyTo` preenchido pelo próprio armazenamento, `forum-core.ts:260`) e chama `answerPost`. Quando não é, grava como `kind: 'post'` e a menção segue o caminho de sempre.
- `answerPost` não muda de assinatura: continua recebendo o texto e devolvendo a mensagem; passa a ser chamado de dentro do handler novo, e não do interceptor de `forum:post`.
- A pessoa que só quer conversar e está respondendo à pergunta continua com o texto puro: `forum:post` não muda e a busca da equipe por agente com barra, caminho ou id desconhecido continua a mesma.

### 2.4 Como a imagem chega ao modelo nos dois motores

**Motor aberto (`engine/open`).** O resultado de ferramenta de um modelo só carrega texto hoje (`ChatMessage.content: string | ContentPart[] | null`, `types.ts:12-14`, mas a mensagem de ferramenta é sempre escrita como texto em `loop.ts:391`). A entrega faz **quatro** mudanças pequenas:

1. O resultado de uma ferramenta **também pode carregar a imagem do anexo** na chamada interna (nunca no pedido ao provedor): um `ToolCall` ganha `attachmentText` — o texto do resultado, que segue valendo como conteúdo da mensagem de ferramenta para o provedor —, e a imagem é levada **fora** da mensagem.
2. Depois que a rodada de chamadas roda, o laço (em `loop.ts:429-431`) escreve a mensagem de ferramenta como texto, como hoje, e, logo depois dela, acrescenta uma mensagem de **usuário** com um pedaço de imagem (`{ type: 'image_url' }` com data URL): `{ role: 'user', content: [{ type: 'image_url', ... }, { type: 'text', text: 'Attachment "<nome>", sent by the person in this conversation.' }] }`. O resultado de ferramenta de um modelo continua sendo texto (nada de `content` de ferramenta virar array, que a API desaprova); a imagem chega ao modelo como imagem, junto da rodada, como pede a issue.
3. As transcrições guardam o pedido **como ele vai ao provedor**: a mensagem de ferramenta é gravada com o seu texto e o pedaço de imagem que a acompanha, nunca os bytes. Retomar uma sessão depois é fiel (o `healMessages` só olha `tool_call_id`, `session.ts:57-71`), e a estimativa de janela (`estimateTokens`, `JSON.stringify(...)/4`, `text.ts:29-32`) superestima um pedaço curto — os bytes da imagem não entram nessa conta e a compressão fica mais agressiva, o que é conservador.
4. `ChatMessage.content` já aceita pedaços; nenhuma mudança de tipo é necessária, e o formato do pedido (`ChatRequest.messages`) já os aceita.

**Motor fechado (o SDK).** O resultado de ferramenta do SDK já aceita imagem; o que falta é a ferramenta da aplicação produzi-la. `AgentCall` ganha um campo opcional `attachments?: AttachmentRef[]`, e `agents.ts` registra a ferramenta de anexo quando ele existe (`sdkOptions` e `wantsVcsTool` decidem hoje por `extra.tools.length === 0`, `agents.ts:447-457`; o mesmo vale para o motor aberto por `openEngineFromEnv`, que é o caminho do ramo). Um agente chamado nunca traz `confine` nem `writeRoot` (só `Edit`/`Write`), então a ferramenta entra pelo `extraTools` e pelo `allowedTools`, com o resultado no mesmo formato das outras.

**O nome da ferramenta** é `ConversationAttachment`, declarado em `src/shared/attachments.ts` e usado pelos dois motores. Parâmetros: `{ ref }` (obrigatório, o `id` do anexo como aparece no aviso da mensagem), `{ offset, limit }` (opcionais, só valem para texto, como no `Read`). Ela resolve o anexo no próprio registro (não em caminho nenhum), dentro do escopo da conversa em que o agente foi chamado; um `id` de outra conversa não resolve.

**Imagem no motor aberto é mudança de comportamento desta entrega**, como a spec escreve: hoje o `Read` recusa binário e todo resultado de ferramenta é texto.

### 2.5 Leitura estrita (o que a spec fixou)

Só imagem e texto chegam ao modelo. Um PDF, um JSON ou um CSV fica mostrável e baixável na conversa, e a ferramenta de anexo responde, em vez do conteúdo, que aquele tipo não vai ao modelo — com `Nome, tipo e tamanho` e o motivo, em palavras simples. É o que o portão 1 aprovou (leitura estrita, regra 13 do spec). **Um agente nunca recebe um caminho no computador** (regra 14): o aviso da mensagem dá `id`, nome, tipo e tamanho; a ferramenta resolve o `id` no registro. O teste `test/attachments-tool.test.ts` procura um separador de caminho no que o modelo recebe e falha se achar.

### 2.6 O canal novo e a política web

- Entram na mesma lista aberta ao navegador pareado: `forum:attachment-put`, `forum:attachment-post`, `forum:attachment-drop`, `forum:attachment-get`. Nenhum é janela-exclusiva nem efeito externo; a política é a mesma dos outros `forum:*` (`webPolicy.ts:19-26`), e o comentário ganha a nota do canal de arquivo. O teste de política do fórum passa a citar os quatro (hoje ele fixa exatamente os quatro canais de hoje, `forum-policy.test.ts:6,23-27`).
- **Um canal-âncora de conversa.** A mensagem guarda, além dos anexos, um `anchor` (curto, derivado do id da conversa: o id da execução, o id do canal, o id da conversa geral), e a montagem do pedido de um arquivo exige que a mensagem citada exista e que o seu `anchor` seja o da conversa pedida. É a costura que **hoje não existe** no armazenamento (a mensagem só guarda o id da conversa; `forum-core.ts:234-264`) e a peça que as regras 9, 13 e 18 exigem para poderem ser testadas sem tela. O `anchor` é interno; o nome do arquivo não muda.
- Os bytes são servidos por um caminho próprio do RPC (`forum:attachment-get`, base64 com data URL), **não** pelo `serveStatic`, que é deliberadamente fechado (`resolveStatic`, `web.ts:69-85`): o arquivo é dado de mensagem, e não recurso do aplicativo.

## 3. Um olhar sobre a árvore de módulos

O recurso precisa de uma peça neutra, porque a pasta de anexos, a mensagem e a ferramenta dos dois motores são usados pelo fórum, pelo `agents.ts` e pelo executor, e `agents.ts` não pode importar o fórum:

```
main/attachments.ts        (novo)  o registro: pasta, id, tipo pelo conteúdo, limites, apagar,
                                   ler para a ferramenta, recensear para a retenção, referências
shared/attachments.ts      (novo)  tipo e limites no fio: AttachmentRef, AttachmentKind, DEFAULTS,
                                   o nome da ferramenta, o reconhecedor de tipo por conteúdo
```

- `main/attachments.ts` **não** importa o fórum, o motor nem o executor: recebe um `id` de conversa e devolve/guarda bytes. A resolução da mensagem (o `anchor`) fica em `main/forum.ts`.
- Dependências de `agents.ts` → `attachments.ts` → nada. Nada de ciclo; a retenção importa `attachments.ts` e o executor importa `attachments.ts`, como já importam o armazenamento do fórum.
- O tipo por conteúdo entra em `shared/attachments.ts` (função pura, sem `node:fs`), e a leitura de bytes de amostra em `main/attachments.ts`: é assim que o reconhecedor é testado sem tocar no disco.

## 4. Ordem de trabalho (seis commits)

Cada commit fecha um passo lógico e deixa a árvore verde nos gates da seção 7.

### Commit 1 — `feat: keep a person's attachments in the workspace data`

- `src/shared/attachments.ts` (novo): `AttachmentKind` (`'image' | 'text' | 'pdf' | 'json' | 'csv'`), `AttachmentRef` (`id`, `name`, `kind`, `bytes`), `ATTACHMENT_LIMITS` (por arquivo: imagem 5 MB, outros 1 MB; por mensagem: 10 MB e 10 arquivos; tipos aceitos), `detectAttachmentKind(head: Uint8Array): AttachmentKind | null` (pelo conteúdo: assinatura PNG/JPEG/GIF/WebP; `%PDF-`; conteiner ZIP/Office recusado; JSON/CSV são **texto** e o cartão mostra `JSON`/`CSV` pelo conteúdo — JSON quando o texto lido começa por `{`/`[` e é analisável, CSV quando tem pelo menos duas linhas com o mesmo número de campos e uma vírgula; fora disso, texto), e o teto de corte do texto que vai ao modelo.
- `src/main/attachments.ts` (novo): `attachmentDir(thread)` sobre `ATAS/anexos`, `put(thread, name, bytes)`, `drop(thread, id)`, `get(thread, id)`, `list(thread)`, `attachmentPath(thread, id)` (com a checagem de caminho dentro da pasta, como `checkPath`), `readForTool(thread, id, offset, limit)` e um `sweep`/`refsOf` para a retenção. Um `id` é `randomUUID().replace(/-/g, '').slice(0, 16)`; a extensão de catálogo sai do tipo, nunca do nome.
- Testes: `test/attachments-store.test.ts` e `test/attachments-kind.test.ts` (o tipo pelo conteúdo: um PNG chamado `.txt` é imagem, um texto chamado `.png` é texto, um `.exe`/ZIP é recusado, JSON e CSV pelos dois lados).

Sem tela e sem canal ainda: nada muda para quem usa.

### Commit 2 — `feat: let a person put files in a forum message`

- `src/shared/forum.ts`: `Attachments` na `ForumDraft`, na `ForumMessage` (campo obrigatório `attachments: AttachmentRef[]`), `anchor?: string | null` na mensagem, o esquema de validação do armazenamento, e a decisão de tipo/esquema descritos em 2.3.
- `src/main/attachments.ts`/`src/main/forum-core.ts`: as quatro chamadas dos canais, a montagem do pedido e a âncora da conversa (2.6).
- `src/main/webPolicy.ts` e o comentário; `isQueueable` (`shared/outbox.ts`).
- `src/main/hooks.ts`/`src/main/attachments.ts`: a varredura de retenção e o grupo novo.
- Testes: `test/forum-attachments.test.ts` (as quatro chamadas; a mensagem guarda os anexos; a âncora; a recusa acima do limite e do tipo; o tipo pelo conteúdo no caminho de envio), `test/web-attachments.test.ts` (o caminho de bytes no navegador pareado: teto, forma e o anexo de outra conversa recusado) e os casos de retenção (`test/retention*.test.ts`).

Ainda nada visível na conversa, mas a mensagem já carrega os anexos.

### Commit 3 — `feat: show a message's attachments in the conversation`

- `src/renderer/src/screens/cycle/Attachments.tsx` (novo): a miniatura de imagem (abre em tamanho cheio e baixa) e o cartão (ícone de tipo, nome, tipo e tamanho, abrir/baixar).
- `src/renderer/src/screens/cycle/Thread.tsx`: o compositor ganha botão de anexo, arrastar-e-soltar, colar de imagem e lista de preparação (nome + tamanho + remover), com o mesmo canal na janela e na web; o bloco de anexos deixa de depender de `ctx.runId` (`Thread.tsx:103-111`) e vale em toda mensagem; o aviso de "o que sai para um provedor de modelo deixa o computador" aparece uma vez (regra 16).
- `src/renderer/src/screens/cycle/forumApi.ts`: as chamadas dos canais novos.
- `src/shared/i18n/ui-cycle.{en,pt-BR}.json`: as chaves da tela.
- Testes: as quatro de tela já existentes que citam o compositor (arquivo-fonte) e um novo `test/attachments-view.test.ts` sobre as funções puras de formatação (tamanho, tipo, aviso).

### Commit 4 — `feat: tell a called agent which files the message carries`

- `src/shared/attachments.ts`: `CONVERSATION_ATTACHMENT_TOOL`.
- `src/main/mentions/call.ts` e o executor: o aviso dos anexos no pedido (`runner.mention.attachment.list`) e a ferramenta de anexo no ramo do agente aberto.
- `src/main/agents.ts`: `AgentCall.attachments` → `extraTools`/`allowedTools`; o mesmo no `EngineRequest`.
- `src/main/runner/prompt.ts`: a seção dos anexos no pedido da etapa, quando a mensagem que a execução espera os carrega (`runner.section.attachments`, com id, nome, tipo e tamanho); o mesmo no `answer` da etapa.
- Testes: `test/attachments-tool.test.ts` (o agente lê a imagem/texto da sua conversa; um anexo de outra conversa não resolve; um PDF não vai ao modelo e a ferramenta do modelo recebe o motivo; **nenhum caminho no texto que o modelo lê**) e `test/mentions-attachments.test.ts` (o aviso e os limites de leitura).

### Commit 5 — `feat: send an image to the model as an image on both engines`

- **`src/main/engine/open`** (o motor aberto): a imagem do anexo na transcrição e no pedido, o caminho de bytes quando a ferramenta é a do anexo (2.4); teste `test/engine-open-attachments.test.ts` no molde do teste que confere as mensagens enviadas ao servidor, com um servidor de mentira.
- **`src/main/agents.ts`** (o motor fechado): o resultado de ferramenta do SDK com o bloco de imagem; teste de política do que a ferramenta devolve.
- `docs/llm-providers.md`: a nota de que a entrada de imagem do motor aberto passa a ser usada (hoje o documento registra que não é, `docs/llm-providers.md:103`).
- Nada de rede: tudo é o servidor de mentira do teste.

### Commit 6 — `feat: put the workspace's attachment switches in reach`

- As três opções do espaço de trabalho (`attachments.enabled`, `attachments.limits`, `attachments.agents`), com padrões numa instalação nova; o editor (janela e navegador pareado, via `config:cycle-save`, `configScope.ts`) e o aviso de que os agentes não recebem os arquivos quando está desligado (regra 17).
- `src/shared/config/*` (tipo, validação, migração) e `src/main/attachments.ts` passam a ler os limites da configuração.
- Teste de migração e do caminho do navegador; `docs/configuration.md` e `CHANGELOG.md` (a nota de lançamento diz o que mudou, sem referência interna).

## 5. Contratos

### 5.1 `src/shared/attachments.ts`

```ts
export type AttachmentKind = 'image' | 'text' | 'pdf' | 'json' | 'csv';
export interface AttachmentRef { id: string; name: string; kind: AttachmentKind; bytes: number }
export const ATTACHMENT_LIMITS = { imageBytes: 5 * 1024 * 1024, otherBytes: 1 * 1024 * 1024, messageBytes: 10 * 1024 * 1024, perMessage: 10 } as const;
export const ATTACHMENT_TOOL = 'ConversationAttachment';
export const TEXT_MODEL_MAX = 100_000;
/** O tipo pelo conteúdo; null: nenhum tipo aceito. */
export function detectAttachmentKind(head: Uint8Array): AttachmentKind | null;
export function kindLabelKey(kind: AttachmentKind): string;
```

`detectAttachmentKind` recebe a cabeça (e, para texto, o texto já lido). JSON/CSV/texto entram por último: o que não for imagem, PDF nem ZIP é candidato a texto, e a diferença entre os três é o conteúdo lido.

### 5.2 `src/main/attachments.ts`

```ts
export function put(thread: string, name: string, bytes: Uint8Array): AttachmentRef;   // respeita os limites
export function drop(thread: string, id: string): void;                               // apaga; id desconhecido: nada
export function get(thread: string, id: string): { ref: AttachmentRef; bytes: Uint8Array } | null;
export function readForTool(thread: string, id: string, offset?: number, limit?: number): { ref: AttachmentRef; text?: string; clipped?: boolean; reason?: string };
export function refsOf(thread: string): Map<string, string>;                          // id → mensagem, para a retenção
export function removeMessage(thread: string, seq: number): void;                     // apaga a pasta da mensagem
```

### 5.3 Os canais (`src/main/forum.ts`)

```ts
ctx.handle('forum:attachment-put', (thread, name, dataBase64) => AttachmentRef);       // bytes pelo fio
ctx.handle('forum:attachment-post', (thread, text, ids, mentions?) => ForumMessage);   // a mensagem; decisão de tipo em 2.3
ctx.handle('forum:attachment-drop', (thread, ids) => void);                            // antes de enviar
ctx.handle('forum:attachment-get', (thread, message, id) => { data: string; ref: AttachmentRef });
```

- `forum:attachment-put` só recebe bytes: nada é gravado sem ser chamada, e uma chamada recusada não deixa rastro. O teto de bytes é conferido **antes** de gravar, com um teto por arquivo mais o teto de mensagem, e o tipo pelo conteúdo.
- `forum:attachment-post` é o único lugar que grava a mensagem com anexos e o único que dispara a resposta da execução (2.3). Ele mantém a mensagem no mesmo formato e com o mesmo limite de texto (`MAX_TEXT`) de `forum:post`.
- `forum:attachment-get` responde `null` quando a mensagem não existe, não tem o anexo ou o `anchor` não é o da conversa pedida.

### 5.4 A ferramenta de anexo

```ts
{ name: 'ConversationAttachment', description: 'Opens one file the person attached to a message of this conversation.',
  parameters: { type: 'object', properties: { ref: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, required: ['ref'] } }
```

- Imagem: o resultado é a imagem (motor fechado: bloco `image`; motor aberto: pedaço de imagem levado no caminho próprio), com o nome e o tamanho como texto.
- Texto: o texto cortado, numerado como o `Read` (para o agente poder citar), com o motivo no fim quando cortado.
- PDF/JSON/CSV: nenhum conteúdo — o motivo de aquele tipo não ir ao modelo, em palavras simples.
- Nunca um caminho; o `ref` é o `id` do anexo que o aviso da mensagem traz.

### 5.5 Chaves de idioma

Nos catálogos principais (`src/shared/i18n/en.json` e `pt-BR.json`), porque o `src/main` as usa:

| Chave | Papel |
|---|---|
| `main.attachment.limit` | Recusa por tamanho, com o limite e o que é |
| `main.attachment.kind` | Recusa por tipo fora da lista, com o tipo que o conteúdo revelou |
| `main.attachment.tooMany` | Recusa por número de arquivos numa mensagem |
| `main.attachment.gone` | O anexo não existe mais (mensagem excluída ou retenção) |
| `main.attachment.notToModel` | Por que aquele tipo não vai ao modelo (leitura estrita) |
| `main.attachment.notice` | O aviso único de que o que vai ao provedor de modelo sai do computador |
| `main.attachment.agentsOff` | Por que os agentes não receberam os arquivos (a opção desligada) |
| `main.attachment.tool.list` | O que o agente recebe na chamada: id, nome, tipo e tamanho |
| `main.attachment.tool.image` / `.text` / `.refused` | O formato do resultado da ferramenta |
| `runner.section.attachments` | A seção do pedido da etapa quando a mensagem que a execução espera carrega arquivos |
| `main.retention.group.anexos` | O rótulo do grupo na varredura de retenção |

No catálogo de tela (`ui-cycle.{en,pt-BR}.json`): botão de anexo, arrastar-e-soltar, o rótulo de preparação, remover, o cartão, "abrir", "baixar", "imagem", o aviso e os cinco motivos de recusa, e os três rótulos das opções do espaço de trabalho. `ui-cycle` não entra no snapshot congelado de catálogos, então não há exceção a registrar.

## 6. Testes

Arquivos novos, no molde de `test/forum-store.test.ts`, `test/attachments-*` com o motor falso de `test/helpers/`:

1. **`test/attachments-kind.test.ts`** — o tipo pelo conteúdo: PNG/JPEG/GIF/WebP por assinatura; `%PDF-`; um binário qualquer recusado; JSON e CSV pelo texto; um texto que não é JSON nem CSV é texto; um nome com a extensão trocada não engana nos dois sentidos.
2. **`test/attachments-store.test.ts`** — gravar, ler, apagar, o limite por arquivo, o limite por mensagem, o número de arquivos, o `id` de outra conversa que não resolve, a pasta fora da conversa que não é alcançada, e um `id` inexistente que não falha.
3. **`test/forum-attachments.test.ts`** — as quatro chamadas no armazenamento do fórum: a mensagem com anexos, a âncora da conversa, a mensagem de resposta respondendo à pergunta (2.3), e o `forum:attachment-get` recusando o anexo de outra conversa.
4. **`test/web-attachments.test.ts`** — os quatro canais na política (abertos, não janela-exclusiva, não efeito externo), o teto do corpo ao enviar um arquivo grande, o `isQueueable`, e o anexo de outra conversa recusado pelo `anchor`.
5. **`test/attachments-tool.test.ts`** — o agente chamado: ele recebe o aviso dos arquivos (nome, tipo, tamanho) e **nenhum caminho**; a ferramenta lê a imagem/texto da conversa dele; um PDF, um JSON ou um CSV recebem o motivo; um anexo de outra conversa não abre; um anexo da mensagem de outra mensagem da mesma conversa abre (a âncora é da conversa, não da mensagem).
6. **`test/mentions-attachments.test.ts`** — a resposta de uma menção com anexos: a mensagem é a mesma em todos os lugares do fórum; a ferramenta entra no conjunto de ferramentas do agente e nada mais muda na política de leitura (a menção continua somente leitura).
7. **`test/engine-open-attachments.test.ts`** — o motor aberto, com o servidor de mentira: a rodada manda o resultado de ferramenta como **texto** e a imagem como **mensagem de usuário com pedaço de imagem**; a transcrição guarda o formato do pedido (texto e o marcador, nunca os bytes); retomar a sessão e uma segunda rodada continuam válidas.
8. **Edições** — `test/forum-policy.test.ts` (os quatro canais novos), `test/retention*.test.ts` (o grupo novo, a referência que protege e o registro órfão que não falha) e as asserções sobre fonte das telas (compositor, cartão, aviso).

## 7. Gates

Um commit só está pronto com os do `CLAUDE.md` verdes, mais o build do CI:

```
nvm use
npx tsc --noEmit
npx vitest run
node scripts/theme-audit.mjs
npm run i18n:lint
node scripts/public-audit.mjs
electron-vite build
```

Sem regeneração de golden: as chaves novas de catálogo não mexem nas chaves de prompt cobertas pela guarda congelada. `public-audit` é o gate que mais importa: nas fixtures novas, nada de host, pessoa ou número de issue real — `example.com`, `group/project`, `#123` — e nenhum segredo dentro de um anexo de teste (o conteúdo de teste é `hello` e um PNG de um pixel).

## 8. Riscos e como são cobertos

1. **O anexo em base64 no corpo do RPC.** Um arquivo no limite mais o JSON pode passar de 15 MB. Coberto pelo desenho de um anexo por chamada (2.2) e pelo teste que envia um arquivo grande pelo caminho do navegador; um envio que não caiba é recusado com o motivo. **Não verificado** com um telefone real.
2. **A imagem como mensagem de usuário no motor aberto (2.4).** Nem todo provedor compatível aceita pedaços de imagem no histórico, e o documento do projeto registra que a entrada de imagem não é usada hoje. Coberto pelo teste com servidor de mentira (a forma do pedido e a transcrição), e a rodada continua válida porque o resultado de ferramenta não deixa de ser texto. **Não verificado** contra um provedor real.
3. **O redutor de credenciais.** Ele apaga textos de 32 caracteres ou mais em formato misto; nenhum caminho o põe sobre bytes de imagem (2.2), e os nomes de anexo são curtos. Coberto pelo teste de gravação que confere que o que volta é o nome que a pessoa deu.
4. **O Reingresso.** Se o `Talk` passar a carregar anexos, a guarda de catálogos congelados que cobre o snapshot do `main` exige uma exceção com motivo. Coberto por `docs/cycles/REDACT.md` (o registro das exceções) e pela escolha da seção 2.4, que guarda a transcrição como o pedido ao provedor.
5. **A âncora da conversa.** Ela é a peça nova que faz o "outra conversa não abre" ser testável sem tela; se a âncora não for gravada numa mensagem antiga, a leitura devolve `null` em vez de alcance. Coberto pelo caso 3 e pelo teste do caminho de bytes.
6. **A pasta de anexos sem referência.** A varredura de retenção precisa conhecer o grupo novo, senão a pasta cresce para sempre; e o inverso (apagar o que uma mensagem ainda usa) tem de ser proibido. Coberto pelo caso 8.
7. **Limpar a pasta da mensagem ao excluir.** A remoção é da pasta da mensagem, e não da conversa: um erro ali apagaria os anexos das outras mensagens. Coberto por um teste que exclui uma mensagem no meio da conversa e confere que os vizinhos continuam.

## 9. Registro de decisões

1. **A pasta dos anexos é `ATAS/anexos`.** O espaço de trabalho já é `DATA_ROOT/workspaces/<id>` e `ATAS` é a pasta dele; uma pasta nova na raiz dos dados seria uma segunda noção de "espaço de trabalho". Alternativa descartada: guardar junto do fórum (`ATAS/forum/anexos`), o que misturaria dado de conversa com o arquivo de mensagens.
2. **Um anexo por chamada, com a mensagem de sistema depois.** É a forma que mantém o corpo abaixo do teto e deixa o redutor de credenciais longe dos bytes. Alternativa descartada: todos os anexos numa chamada só (dois de 5 MB estouram) e um canal binário fora do RPC (mudaria o formato do fio e a idempotência do telefone).
3. **O anexo da resposta vem pela mesma porta.** O instrumento é a mensagem do fórum; o interceptor não consome mais o post e a decisão de tipo passa para o handler (2.3). Alternativa descartada: um campo de anexo no `runs:answer`, que faria um segundo caminho de anexo.
4. **Só imagem e texto vão ao modelo.** É a leitura estrita aprovada no portão; PDF, JSON e CSV ficam mostráveis, baixáveis e fora do modelo, com o motivo dito. Alternativa descartada: a leitura ampla, que muda os critérios 8 e 10 do spec.
5. **A imagem no motor aberto entra depois da mensagem de ferramenta, como pedaço de imagem.** É o que mantém o resultado de ferramenta sendo texto, que é o contrato de que o resto do laço depende, e o que a API recomenda. Alternativas descartadas: virar o resultado de ferramenta em array (a API desaprova o `content` de ferramenta como array) e passar a imagem como texto dentro do resultado (perde a imagem e ainda seria apagada pelo redutor se fosse base64).
6. **O nome da ferramenta (`ConversationAttachment`) é declarado nos dois motores.** O nome é o do recurso; `Attachment` colidiria com a ideia de documento da execução.
7. **A âncora da conversa fica na mensagem.** É a costura que hoje não existe e que dá substância às regras 9, 13 e 18 sem tela. Alternativa descartada: guardar o arquivo também por mensagem (mais uma pasta e uma limpeza, sem ganho nenhum).
8. **A varredura de retenção conhece os anexos.** É a única limpeza que sobra para uma conversa apagada ou um arquivo sem referência, e ela já tem o critério de referência e o formato de grupo. Alternativa descartada: uma varredura própria só para os anexos.
9. **A largura da fatia aberta ao navegador é a mesma do resto do fórum.** Os quatro canais novos leem e escrevem só os arquivos do espaço de trabalho e nada alcançam no computador. Alternativa descartada: exigir o interruptor de efeitos externos, que é para o que sai da máquina até o host de código, e aqui não é o caso.
10. **A leitura da imagem no motor aberto é uma mudança de comportamento desta entrega**, como a spec registra. O `Read` continua recusando binário; quem lê imagem é a ferramenta de anexo.
11. **Vídeo, áudio, SVG e HTML ficam fora da lista de tipos aceitos.** Um SVG e um HTML são conteúdo ativo e seriam mostráveis dentro da conversa; vídeo e áudio estouram qualquer limite razoável. Alternativa descartada: aceitar tudo que não fosse binário, o que traria de volta a superfície que a lista de tipos existe para fechar.
12. **As três opções do espaço de trabalho ficam num bloco `attachments` da configuração.** É o que a issue pede ("set in the workspace (with defaults)") e o que dá à pessoa o interruptor de anexos para agentes. Alternativa descartada: constantes do código, que impediriam o interruptor.

## 10. O que esta etapa não verificou

Nada foi alterado nem executado nesta etapa: nenhum gate foi rodado, nenhum teste, nenhum build, o aplicativo não foi aberto e nenhum modelo real foi chamado. Tudo acima é leitura de código e de documentos. Em particular, **não verificado**:

- se a forma do pedido com pedaço de imagem no motor aberto é aceita por cada provedor compatível;
- se um anexo perto do limite passa pelo corpo de 15 MB do RPC e pelo envio de um telefone real;
- se o resultado de ferramenta do SDK aceita imagem no formato que a ferramenta da aplicação vai devolver;
- se a leitura da imagem pelos dois motores produz a resposta que a aceitação da issue descreve;
- se um arquivo grande pela retenção e pela limpeza de mensagem não deixa lixo;
- `npm run i18n:lint`, `scripts/theme-audit.mjs` e `scripts/public-audit.mjs` com as chaves e as fixtures novas.
