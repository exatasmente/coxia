# Memória do ciclo

## Decisões

- Peça neutra `src/shared/attachments.ts` (tipos, limites, `detectAttachmentKind`, `ATTACHMENT_TOOL_DEF`) e `src/main/attachments.ts` (pasta `ATAS/anexos/<conversa>/<id><ext>`, extensão do tipo pelo conteúdo, nunca do nome; um arquivo por chamada).
- A mensagem do fórum carrega `attachments: AttachmentRef[]` e um `anchor` interno (`threadAnchor(thread)`); `forum:attachment-get` só responde quando a mensagem existe e a âncora é a da conversa pedida — é o que faz "outra conversa não abre" ser testável sem tela.
- Quatro canais novos (`forum:attachment-put/post/drop/get`) na mesma lista aberta ao navegador (`webPolicy.ts`); as três escritas em `isQueueable` (`outbox.ts`).
- Retenção: `src/shared/retention.ts` ganhou o grupo `anexos` e `src/main/retention.ts` varre as pastas (`referencedAttachments` protege o que uma mensagem viva referencia; pasta vazia é recolhida; registro órfão não falha).
- Agente: ferramenta somente leitura `ConversationAttachment` nos dois motores (`src/main/attachmentTool.ts`), com nome/tipo/tamanho vindos dos refs da mensagem e nunca um caminho. Motor aberto: resultado de ferramenta continua texto e a imagem vai como pedaço de imagem numa mensagem de usuário logo depois; motor fechado: bloco de imagem no MCP.
- Configuração: bloco `attachments` (`enabled`, `limits`, `agents`) no tipo, defaults, schema, validação e `WEB_EDITABLE`; aba Arquivos na tela de time e ciclo.
- Resposta: a atividade deve ter a funcionalidade, pode voltar ela para o DEV <!-- answer:123 -->
- Revisão (tl-experiencia): veredito **mudanças pedidas**. A entrega volta ao DEV com um bloqueante (excluir mensagem não apaga os arquivos dela) e duas sugestões (a mensagem `answer` do runner perde os refs; no motor aberto cada imagem vira uma mensagem de usuário própria numa rodada de vários arquivos).

## Restrições

- Leitura estrita mantida: só imagem e texto vão ao modelo; PDF, JSON e CSV ficam mostráveis/baixáveis, com o motivo dito.
- O nome que a pessoa deu é dado, nunca caminho; o agente nunca recebe um caminho.
- Toda string nova passa pelos catálogos (principais para o `src/main`, `ui-*` para a tela); cores só por tokens.
- Nada tocado fora da pasta de trabalho.
- O registro de anexos é por conversa, não por mensagem: o alcance do agente é a conversa inteira (uma nota da revisão, não um bloqueio).

## Tentado e descartado

- Gravar duas vezes quando a mensagem com arquivos responde à execução (o interceptor já grava a mensagem `answer`): descartado por duplicar o texto; o handler devolve a mensagem do runner — é a origem do bloqueio/sugestão 2 da revisão.
- Enviar a imagem como texto no resultado de ferramenta: perdida pelo redutor e recusada pela API; o pedaço de imagem vai numa mensagem de usuário.
- Testar `attachmentDrop` chamado pela tela: o upload só acontece no envio, então remover antes de enviar não deixa nada no disco (mais forte que a regra).
- Excluir mensagem do fórum: não existe caminho nenhum no aplicativo (nem armazenamento, nem canal, nem tela) e o `removeMessage(thread, seq)` do plano não foi implementado; a revisão pede que entre.

## Perguntas abertas

- **Não verificado:** telefone real (arquivo perto do limite pelo corpo de 15 MB); provedor compatível real aceitando pedaço de imagem; tela rodando (miniatura, cartão, arrastar-e-soltar, seletor do telefone, `attachmentDrop` antes do envio); leitura da imagem pelos dois motores produzindo a resposta do aceite.

## Onde o trabalho está

Implementação verde nos gates (`tsc`, `i18n:lint`, `theme-audit`, `public-audit`) e nos 62 testes novos e 142 tocados. A revisão pediu mudanças e a próxima etapa de desenvolvimento deve: (1) criar o caminho de exclusão de mensagem que apaga os anexos dela (bloqueante, fecha o critério "deleting the message deletes its files from disk"); (2) levar os refs dos anexos até a mensagem `answer` do runner, para a miniatura/cartão aparecerem e a retenção protegê-los; (3) opcionalmente juntar os pedaços de imagem numa única mensagem de usuário por rodada no motor aberto. Documentos do ciclo: `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md`, `4_REVIEW.md`. Nada de commit foi feito por esta etapa.
- Passagem dev-experiencia → tl-experiencia: Revisão do pull request e verificação de linguagem. O essencial da funcionalidade está implementado e verde nos gates do projeto ou nos testes novos. O que a revisão deve olhar com atenção: (1) a limitação dita em `3_IMPLEMENTATION.md` — quando a mensagem com arquivos responde à pergunta de uma execução, os arquivos não ficam presos à mensagem `answer` que o runner grava; (2) o pedaço de imagem no motor aberto contra um provedor compatível real, hoje só coberto por servidor de mentira; (3) o envio pelo telefone e a tela rodando, ambos não verifi… <!-- handoff:105 -->
- Passagem tl-experiencia → dev-experiencia: A revisão está em `4_REVIEW.md` e pede mudanças. Bloqueante: não há caminho de exclusão de mensagem do fórum, então o critério "deleting the message deletes its files from disk" e as regras 9 e 20 da spec não se cumprem (só a retenção por idade recolhe). Sugestões: prender os refs dos anexos à mensagem `answer` do runner (hoje a miniatura/cartão não aparecem nesse caminho e a retenção não a vê) e juntar os pedaços de imagem numa única mensagem de usuário por rodada no motor aberto. Os gates e 62+142 testes estão verdes; tela, telefone real e provedor real seguem não verificados.
- Passagem support → product-owner: Issue 120 está entendida e nada falta de quem a abriu. O refino deve escrever a spec funcional apoiada em `0_TRIAGE.md`: os padrões numéricos de tamanho por arquivo e por mensagem; como o tipo é checado pelo conteúdo; onde o arquivo vive em `workspaces/<id>/` e como ele é apagado (mensagem excluída, anexo removido antes de enviar, retenção); como o anexo entra no prompt da etapa quando a mensagem é a resposta que a execução espera; como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferramenta do motor aberto é texto hoje; e o comportamento do canal novo na política web, … <!-- handoff:7 -->
- Passagem product-owner → pessoa: A spec funcional está em `1_SPEC.md`. O portão 1 decide as perguntas 1 a 3 (leitura estrita ou ampla para o que vai ao modelo, os padrões numéricos dos limites e o teto do telefone) e a prioridade/marco propostos; depois, o plano técnico cobre: onde o anexo fica em `workspaces/<id>/` e como é apagado (remover antes de enviar, excluir a mensagem, retenção); como o teto de corpo de 15 MB do RPC e o redutor de credenciais convivem com um arquivo em base64; a ferramenta de leitura de anexo (nome, parâmetros, limites) e como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferra… <!-- handoff:16 -->
- Passagem tl-experiencia → pessoa: O plano está em `2_PLAN.md` e cobre as quatro decisões que a spec deixou em aberto: onde o anexo mora (`ATAS/anexos/<conversa>/`, uma pasta por mensagem, apagada ao remover antes de enviar e ao excluir a mensagem, com a varredura de retenção conhecendo o grupo novo e protegendo o que uma mensagem ainda referencia); o teto de 15 MB do RPC (um anexo por chamada, mais a mensagem depois, com o redutor de credenciais nunca sobre os bytes); o anexo da resposta (a mensagem do fórum continua sendo o instrumento, com a decisão do tipo de mensagem passando do interceptor para o handler novo); e a imagem… <!-- handoff:26 -->
