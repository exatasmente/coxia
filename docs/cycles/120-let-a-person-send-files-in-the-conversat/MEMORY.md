# Memória do ciclo

## Decisões

- Peça neutra `src/shared/attachments.ts` (tipos, limites, `detectAttachmentKind`, `ATTACHMENT_TOOL_DEF`) e `src/main/attachments.ts` (pasta `ATAS/anexos/<conversa>/<id><ext>`, extensão do tipo pelo conteúdo, nunca do nome; um arquivo por chamada).
- A mensagem do fórum carrega `attachments: AttachmentRef[]` e um `anchor` interno (`threadAnchor(thread)`); `forum:attachment-get` só responde quando a mensagem existe e a âncora é a da conversa pedida — é o que faz "outra conversa não abre" ser testável sem tela.
- Quatro canais novos (`forum:attachment-put/post/drop/get`) na mesma lista aberta ao navegador (`webPolicy.ts`); as três escritas em `isQueueable` (`outbox.ts`), que o teste do outbox já exige serem `allow`.
- Retenção: `src/shared/retention.ts` ganhou o grupo `anexos` e `src/main/retention.ts` varre as pastas (`referencedAttachments` protege o que uma mensagem viva referencia; pasta vazia é recolhida; registro órfão não falha).
- Agente: ferramenta somente leitura `ConversationAttachment` nos dois motores (`src/main/attachmentTool.ts`), com nome/tipo/tamanho vindos dos refs da mensagem e nunca um caminho. Motor aberto: resultado de ferramenta continua texto e a imagem vai como pedaço de imagem numa mensagem de usuário logo depois; motor fechado: bloco de imagem no MCP.
- Configuração: bloco `attachments` (`enabled`, `limits`, `agents`) no tipo, defaults, schema, validação e `WEB_EDITABLE`; aba Arquivos na tela de time e ciclo.

## Restrições

- Leitura estrita mantida: só imagem e texto vão ao modelo; PDF, JSON e CSV ficam mostráveis/baixáveis, com o motivo dito.
- O nome que a pessoa deu é dado, nunca caminho; o agente nunca recebe um caminho.
- Toda string nova passa pelos catálogos (principais para o `src/main`, `ui-*` para a tela); cores só por tokens.
- Nada tocado fora da pasta de trabalho.

## Tentado e descartado

- Gravar duas vezes quando a mensagem com arquivos responde à execução (o interceptor já grava a mensagem `answer`): descartado por duplicar o texto; o handler devolve a mensagem do runner.
- Enviar a imagem como texto no resultado de ferramenta: perdida pelo redutor e recusada pela API; o pedaço de imagem vai numa mensagem de usuário.
- Testar `attachmentDrop` chamado pela tela: o upload só acontece no envio, então remover antes de enviar não deixa nada no disco (mais forte que a regra).

## Perguntas abertas

- Nenhuma de quem abriu a issue.
- **Não verificado:** telefone real (arquivo perto do limite pelo corpo de 15 MB); provedor compatível real aceitando pedaço de imagem; tela rodando (miniatura, cartão, arrastar-e-soltar, seletor do telefone); leitura da imagem pelos dois motores produzindo a resposta do aceite; o anexo da resposta da execução preso à mensagem `answer` do runner.

## Onde o trabalho está

Implementação concluída e verde nos gates (`tsc`, `i18n:lint`, `theme-audit`, `public-audit`) e nos testes novos/tocados. A suíte completa só mostrou falhas de ambiente/pré-existentes e testes sensíveis a tempo. Documentos do ciclo: `0_TRIAGE.md`, `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md`. Nada de commit foi feito por esta etapa.
- Passagem support → product-owner: Issue 120 está entendida e nada falta de quem a abriu. O refino deve escrever a spec funcional apoiada em `0_TRIAGE.md`: os padrões numéricos de tamanho por arquivo e por mensagem; como o tipo é checado pelo conteúdo; onde o arquivo vive em `workspaces/<id>/` e como ele é apagado (mensagem excluída, anexo removido antes de enviar, retenção); como o anexo entra no prompt da etapa quando a mensagem é a resposta que a execução espera; como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferramenta do motor aberto é texto hoje; e o comportamento do canal novo na política web, … <!-- handoff:7 -->
- Passagem product-owner → pessoa: A spec funcional está em `1_SPEC.md`. O portão 1 decide as perguntas 1 a 3 (leitura estrita ou ampla para o que vai ao modelo, os padrões numéricos dos limites e o teto do telefone) e a prioridade/marco propostos; depois, o plano técnico cobre: onde o anexo fica em `workspaces/<id>/` e como é apagado (remover antes de enviar, excluir a mensagem, retenção); como o teto de corpo de 15 MB do RPC e o redutor de credenciais convivem com um arquivo em base64; a ferramenta de leitura de anexo (nome, parâmetros, limites) e como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferra… <!-- handoff:16 -->
- Passagem tl-experiencia → pessoa: O plano está em `2_PLAN.md` e cobre as quatro decisões que a spec deixou em aberto: onde o anexo mora (`ATAS/anexos/<conversa>/`, uma pasta por mensagem, apagada ao remover antes de enviar e ao excluir a mensagem, com a varredura de retenção conhecendo o grupo novo e protegendo o que uma mensagem ainda referencia); o teto de 15 MB do RPC (um anexo por chamada, mais a mensagem depois, com o redutor de credenciais nunca sobre os bytes); o anexo da resposta (a mensagem do fórum continua sendo o instrumento, com a decisão do tipo de mensagem passando do interceptor para o handler novo); e a imagem… <!-- handoff:26 -->
