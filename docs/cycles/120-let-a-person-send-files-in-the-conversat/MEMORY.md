# Memória do ciclo

## Decisões

- A issue é um pedido de funcionalidade (`enhancement`); o entendimento e o estado atual do código foram conferidos **apenas por leitura**. Nada foi executado e nenhum comportamento novo foi visto funcionando.
- Squad `experiencia`; prioridade alta mantida; nenhum marco proposto. Portão 1 aprovado (leitura estrita, padrões de limites e teto do telefone).
- O refino deixou `1_SPEC.md` (22 regras, 13 critérios de aceite, fora do escopo). O plano deixou `2_PLAN.md`, que fixa as quatro decisões técnicas pendentes:
  - **Pasta do anexo:** `<dados do espaço de trabalho>/anexos/<conversa>/<id do anexo><extensão de catálogo>`. O nome que a pessoa deu é dado, não caminho; a extensão sai do tipo reconhecido pelo conteúdo. Remover antes de enviar apaga na hora; excluir a mensagem apaga a pasta daquela mensagem (não a da conversa); a varredura de retenção passa a ter o grupo `anexos` e nunca apaga um anexo referenciado por mensagem que existe (registro órfão não falha).
  - **Teto de 15 MB do RPC:** um anexo por chamada (`forum:attachment-put`), mais `forum:attachment-post` (a mensagem) e `forum:attachment-drop` (remover antes de enviar), com idempotência no telefone. O redutor de credenciais roda sobre o nome, nunca sobre os bytes. Um envio que não caiba é recusado com o motivo.
  - **Anexo da resposta da execução:** um só caminho, a mensagem do fórum; a decisão do tipo (`answer` ou `post`) sai do interceptor de `forum:post` e passa para o handler novo, que chama `answerPost` depois de gravar.
  - **Imagem nos dois motores:** motor fechado usa o bloco de imagem no resultado de ferramenta; no motor aberto o resultado de ferramenta continua texto e a imagem vai como pedaço de imagem numa mensagem de usuário logo depois dele, e a transcrição guarda o pedido como ele vai ao provedor (nunca os bytes).
- Peças novas: `src/shared/attachments.ts` e `src/main/attachments.ts` (neutras, sem importar fórum/motor/executor, para não criar ciclo com `agents.ts`), a ferramenta `ConversationAttachment` (`{ ref, offset?, limit? }`), a âncora de conversa na mensagem (a costura que hoje não existe e que faz o "outra conversa não abre" ser testável), os quatro canais novos na mesma lista aberta ao navegador pareado, e um bloco `attachments` na configuração do espaço de trabalho (ligado/desligado, limites, anexos para agentes).
- Leitura estrita mantida: só imagem e texto vão ao modelo; PDF, JSON e CSV ficam mostráveis, baixáveis e fora do modelo, com o motivo dito. O agente nunca recebe um caminho.

## Restrições

- A issue é especificação funcional; o desenho da solução é do plano. O que ela fixa: anexo nos dados do espaço de trabalho por conversa, nunca num repositório nem no worktree; tipo pelo conteúdo; o agente nunca recebe caminho e só alcança os arquivos da conversa em que foi chamado; o que vai ao provedor de modelo sai do computador (aviso único e interruptor por espaço de trabalho).
- Fora do escopo: agentes criarem arquivos por conta própria (issue de evidência) e enviar anexos ao host de código.
- Uma menção responde somente leitura e usa a cópia descartável quando executa comandos (regra já entregue). A ferramenta de anexo entra no conjunto de ferramentas do agente e não muda a política de leitura.
- A ordem de trabalho é de seis commits, cada um verde nos gates do projeto; a tela fica depois do armazenamento e antes do motor aberto.
- Toda string nova passa pelos dois catálogos (`src/main` usa os principais; a tela usa `ui-cycle`, fora do snapshot congelado). O `public-audit` é o gate que mais importa: fixtures neutras, nada de host, pessoa ou número real.

## Tentado e descartado

- Enviar imagem como texto dentro do corpo da mensagem: o redutor de credenciais apagaria o base64 e o resultado de ferramenta do motor aberto já é texto; a imagem precisa de caminho próprio nos dois motores.
- Um caminho de anexo só para a resposta da execução (`runs:answer`): a mensagem do fórum continua sendo o único instrumento.
- A leitura ampla (todo anexo ao modelo): o portão aprovou a estrita.
- Todos os anexos numa chamada RPC só, um canal binário fora do RPC, guardar anexo junto do fórum, aceitar SVG/HTML/vídeo/áudio, e guardar o arquivo também por mensagem: cada um está no registro de decisões do plano, com o motivo.
- Nada foi executado: nenhum gate, teste, build, tela ou modelo real.

## Perguntas abertas

- Nenhuma de quem abriu a issue, e nenhuma do portão: as três perguntas do portão foram aprovadas na leitura estrita e nos padrões da spec.
- Ficam como **não verificadas** (seção 10 do plano): a aceitação de pedaços de imagem pelo provedor compatível no motor aberto; o anexo perto do limite passando pelo corpo de 15 MB do RPC e por um telefone real; o resultado de ferramenta do SDK aceitando imagem no formato que a ferramenta da aplicação devolve; a leitura da imagem pelos dois motores produzindo a resposta do aceite; a retenção e a limpeza de mensagem sem deixar lixo; e os gates com as chaves e fixtures novas.

## Onde o trabalho está

Triagem, refino e plano concluídos: `0_TRIAGE.md`, `1_SPEC.md` e `2_PLAN.md` na pasta do ciclo. A issue segue para a etapa de implementação, que deve seguir a ordem dos seis commits do plano, começando pela peça neutra de anexos. Nada de código foi tocado e nenhum commit foi feito por esta etapa.
- Passagem support → product-owner: Issue 120 está entendida e nada falta de quem a abriu. O refino deve escrever a spec funcional apoiada em `0_TRIAGE.md`: os padrões numéricos de tamanho por arquivo e por mensagem; como o tipo é checado pelo conteúdo; onde o arquivo vive em `workspaces/<id>/` e como ele é apagado (mensagem excluída, anexo removido antes de enviar, retenção); como o anexo entra no prompt da etapa quando a mensagem é a resposta que a execução espera; como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferramenta do motor aberto é texto hoje; e o comportamento do canal novo na política web, … <!-- handoff:7 -->
- Passagem product-owner → pessoa: A spec funcional está em `1_SPEC.md`. O portão 1 decide as perguntas 1 a 3 (leitura estrita ou ampla para o que vai ao modelo, os padrões numéricos dos limites e o teto do telefone) e a prioridade/marco propostos; depois, o plano técnico cobre: onde o anexo fica em `workspaces/<id>/` e como é apagado (remover antes de enviar, excluir a mensagem, retenção); como o teto de corpo de 15 MB do RPC e o redutor de credenciais convivem com um arquivo em base64; a ferramenta de leitura de anexo (nome, parâmetros, limites) e como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferra… <!-- handoff:16 -->
