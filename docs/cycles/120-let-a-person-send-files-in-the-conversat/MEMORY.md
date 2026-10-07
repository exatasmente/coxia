# Memória do ciclo

## Decisões

- Peça neutra `src/shared/attachments.ts` (tipos, limites, `detectAttachmentKind`, `ATTACHMENT_TOOL_DEF`) e `src/main/attachments.ts` (pasta `ATAS/anexos/<conversa>/<id><ext>`, extensão do tipo pelo conteúdo, nunca do nome; um arquivo por chamada).
- A mensagem do fórum carrega `attachments: AttachmentRef[]` e um `anchor` interno (`threadAnchor(thread)`); `forum:attachment-get` e `forum:attachment-delete` só respondem quando a mensagem existe **e** a âncora é a da conversa pedida — é o que faz "outra conversa não abre" ser testável sem tela.
- **Toda mensagem gravada pelo runner leva a âncora**: `moveRun` (`src/main/runs-forum.ts`) põe `threadAnchor(runThreadId(id))` em cada mensagem que escreve, preservando a que a mensagem já traga. Sem isso, a mensagem `answer` ficava `anchor: null` e os dois canais a recusavam (anexos da resposta não abriam nem eram apagados) — era o bloqueante 2 da revisão rodada 2, agora fechado e coberto por `test/runner-answer-attachment-open.test.ts`.
- Cinco canais novos (`forum:attachment-put/post/drop/get/delete`) na mesma lista aberta ao navegador (`webPolicy.ts`); as quatro escritas em `isQueueable` (`outbox.ts`). `forum:attachment-delete` devolve `false` numa conversa que o workspace não conhece, em vez de estourar.
- Exclusão de mensagem: `forum-core.remove(thread, seq)` devolve a mensagem com os refs; o canal lê os refs do que o armazenamento devolveu (nunca de quem chamou) e chama `dropAll`. A tela tem o botão de apagar e uma confirmação que diz quantos arquivos vão junto; confirmada, a conversa é relida do arquivo (`forgetNow`/`forgetThreads` em `forumApi.ts`, com `nonce` no `useThread`).
- Resposta que a execução espera: `Transition.attachments?: Record<number, AttachmentRef[]>` (por índice da mensagem); `answer()` em `transitions.ts` preenche o índice 0; `moveRun` põe os refs e a âncora na mensagem que escreve; `answerPost` devolve a última `answer` lida; `runner/service.ts` guarda os arquivos por execução+etapa (`carriedByStage`) até o primeiro turno e os passa ao `executeStage`, que os prefere à lista de `pendingAnswer` (a mensagem é a fonte depois da primeira vez).
- Retenção: `src/shared/retention.ts` ganhou o grupo `anexos` e `src/main/retention.ts` varre as pastas; `referencedAttachments` lê `"attachments"` direto das linhas do `.jsonl` (não olha a âncora), então protege inclusive os arquivos de uma mensagem `answer`.
- Agente: ferramenta somente leitura `ConversationAttachment` nos dois motores (`src/main/attachmentTool.ts`), com nome/tipo/tamanho vindos dos refs da mensagem e nunca um caminho. Motor aberto: resultado de ferramenta continua texto e a imagem vai como pedaço de imagem numa mensagem de usuário logo depois; motor fechado: bloco de imagem no MCP.
- Configuração: bloco `attachments` (`enabled`, `limits`, `agents`) no tipo, defaults, schema, validação e `WEB_EDITABLE`; aba Arquivos na tela de time e ciclo. Os testes que montam uma config à mão não podem omitir `limits` (exigido por `AttachmentsConfig`).
- Resposta: a atividade deve ter a funcionalidade, pode voltar ela para o DEV <!-- answer:123 -->; Resolve os bloqueios <!-- answer:224 -->

## Restrições

- Leitura estrita mantida: só imagem e texto vão ao modelo; PDF, JSON e CSV ficam mostráveis/baixáveis, com o motivo dito.
- O nome que a pessoa deu é dado, nunca caminho; o agente nunca recebe um caminho.
- Toda string nova passa pelos catálogos (principais para o `src/main`, `ui-*` para a tela); cores só por tokens.
- Nada tocado fora da pasta de trabalho.
- O registro de anexos é por conversa, não por mensagem: o alcance do agente é a conversa inteira (nota aceita, não bloqueio).

## Tentado e descartado

- `removeMessage(thread, seq)` no armazenamento dos anexos (como o plano pedia): descartado em favor do canal `forum:attachment-delete` lendo os refs da mensagem removida do fórum — a mensagem já sabe o que carregava. O armazenamento ganhou só `dropAll`.
- Apagar a pasta da conversa inteira ao excluir uma mensagem: descartado; apaga-se o que a mensagem nomeava, e os arquivos das mensagens vizinhas ficam (um teste confere).
- Esperar o arquivo do fórum ter os refs antes do primeiro turno da etapa: descartado (a leitura pode vir de cache); a guarda em memória por execução+etapa cobre.
- Testar `attachmentDrop` chamado pela tela: o upload só acontece no envio, então remover antes de enviar não deixa nada no disco (mais forte que a regra).
- Enviar a imagem como texto no resultado de ferramenta: perdida pelo redutor e recusada pela API; o pedaço de imagem vai numa mensagem de usuário.
- Teste em dois casos separados para a abertura e a exclusão da mensagem `answer`: descartado porque `ATAS` é fixado no import e a loja de execuções compartilha a pasta; um caso só, que abre e depois apaga, cobre os dois.

## Perguntas abertas

- **Não verificado:** telefone real (arquivo perto do limite pelo corpo de 15 MB); provedor compatível real aceitando pedaço de imagem; tela rodando (miniatura, cartão, arrastar-e-soltar, seletor do telefone, o botão de apagar e a confirmação); leitura da imagem pelos dois motores produzindo a resposta do aceite.
- A sugestão do motor aberto de juntar os pedaços de imagem numa única mensagem de usuário por rodada segue **não feita**; continua sugestão, não bloqueio.

## Onde o trabalho está

Revisão rodada 2 pediu mudanças com dois bloqueantes, ambos fechados nesta passada:

1. `npx tsc --noEmit` vermelho pelo teste `runner-answer-attachments` sem `limits` — corrigido (usa os limites da própria config), typecheck limpo.
2. Mensagem `answer` sem âncora — corrigido em `moveRun`; teste novo `runner-answer-attachment-open` confirma que os bytes são servidos e que a exclusão apaga os arquivos.

Gates nesta passada, todos verdes: `tsc` (código 0), `i18n:lint` (4127 chaves), `theme-audit` (55 pares), `public-audit` (927 arquivos), `electron-vite build`, e a suíte inteira (233 arquivos, 3734 testes — duas de três execuções saíram inteiras; numa delas `runner-flow.test.ts` estourou o limite de 5 s por teste sob 233 processos, sem nenhum teste reprovado, e passa sozinho). `forum-attachment-delete` (4) e `runner-answer-attachments` (3) verdes. Documentos do ciclo: `0_TRIAGE.md`..`4_REVIEW.md`. Nada de commit foi feito por esta etapa.
- Passagem support → product-owner: Issue 120 está entendida e nada falta de quem a abriu. O refino deve escrever a spec funcional apoiada em `0_TRIAGE.md`: os padrões numéricos de tamanho por arquivo e por mensagem; como o tipo é checado pelo conteúdo; onde o arquivo vive em `workspaces/<id>/` e como ele é apagado (mensagem excluída, anexo removido antes de enviar, retenção); como o anexo entra no prompt da etapa quando a mensagem é a resposta que a execução espera; como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferramenta do motor aberto é texto hoje; e o comportamento do canal novo na política web, … <!-- handoff:7 -->
- Passagem product-owner → pessoa: A spec funcional está em `1_SPEC.md`. O portão 1 decide as perguntas 1 a 3 (leitura estrita ou ampla para o que vai ao modelo, os padrões numéricos dos limites e o teto do telefone) e a prioridade/marco propostos; depois, o plano técnico cobre: onde o anexo fica em `workspaces/<id>/` e como é apagado (remover antes de enviar, excluir a mensagem, retenção); como o teto de corpo de 15 MB do RPC e o redutor de credenciais convivem com um arquivo em base64; a ferramenta de leitura de anexo (nome, parâmetros, limites) e como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferra… <!-- handoff:16 -->
- Passagem tl-experiencia → pessoa: O plano está em `2_PLAN.md` e cobre as quatro decisões que a spec deixou em aberto: onde o anexo mora (`ATAS/anexos/<conversa>/`, uma pasta por mensagem, apagada ao remover antes de enviar e ao excluir a mensagem, com a varredura de retenção conhecendo o grupo novo e protegendo o que uma mensagem ainda referencia); o teto de 15 MB do RPC (um anexo por chamada, mais a mensagem depois, com o redutor de credenciais nunca sobre os bytes); o anexo da resposta (a mensagem do fórum continua sendo o instrumento, com a decisão do tipo de mensagem passando do interceptor para o handler novo); e a imagem… <!-- handoff:26 -->
- Passagem dev-experiencia → tl-experiencia: Revisão do pull request e verificação de linguagem. O essencial da funcionalidade está implementado e verde nos gates do projeto (typecheck, i18n:lint, theme-audit, public-audit) e nos testes novos. O que a revisão deve olhar com atenção: (1) a limitação dita em `3_IMPLEMENTATION.md` — quando a mensagem com arquivos responde à pergunta de uma execução, os arquivos não ficam presos à mensagem `answer` que o runner grava; (2) o pedaço de imagem no motor aberto contra um provedor compatível real, hoje só coberto por servidor de mentira; (3) o envio pelo telefone e a tela rodando, ambos não verifi… <!-- handoff:105 -->
- Passagem tl-experiencia → dev-experiencia: A revisão confere os portões do projeto (typecheck, i18n:lint, theme-audit, public-audit) e os 62 testes novos mais 142 tocados, todos verdes, e confirma por leitura que a leitura estrita, o tipo pelo conteúdo e a regra de "nenhum caminho ao modelo" estão corretos e bem cobertos. O veredito é **mudanças pedidas**: decidido que a entrega deve trazer a funcionalidade, ela volta ao desenvolvimento com um bloqueante — não existe nenhum caminho no aplicativo que exclua uma mensagem do fórum, então "deleting the message deletes its files from disk" e as regras 9 e 20 da spec não se cumprem (só a var… <!-- handoff:126 -->
- Passagem dev-experiencia → tl-experiencia: A revisão deve olhar com atenção o caminho novo de exclusão (`forum:attachment-delete` → `remove` do armazenamento do fórum → `dropAll` no registro de anexos), a releitura da conversa depois de apagar (`forgetThreads`/`forgetNow` em `forumApi.ts` e o `nonce` de `useThread`) e a guarda `carriedByStage` de `runner/service.ts` que leva os arquivos ao primeiro turno da etapa que retoma, além de `Transition.attachments` em `types.ts`/`transitions.ts`/`runs-forum.ts` e `attachmentsFor` em `executor.ts`. Dois pontos que ficaram abertos: (1) a sugestão do motor aberto de juntar os pedaços de imagem nu… <!-- handoff:175 -->
- Passagem pessoa → dev-experiencia: Resolve os bloqueios <!-- handoff:225 -->
