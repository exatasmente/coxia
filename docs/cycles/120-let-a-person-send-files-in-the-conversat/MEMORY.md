# Memória do ciclo

## Decisões

- A issue 120 é um pedido de funcionalidade (`enhancement`), não um defeito: não há o que reproduzir, e o entendimento foi conferido por leitura do código, sem executar o aplicativo.
- Nada falta que só quem abriu a issue possa dizer; nenhuma pergunta foi publicada na issue (a spec traz perguntas para o portão, não para quem abriu).
- Squad proposto: `experiencia` — o comportamento começa e termina no que a pessoa vê e toca (compositor, miniatura, cartão, download) e as telas e textos vivem em `src/renderer` e `src/shared/i18n`.
- Prioridade proposta: `priority:high`, mantida da triagem. Marco: nenhum proposto (a lista de marcos do rastreador não foi alcançada; a mudança atravessa telas, dados e os dois motores).
- A spec funcional está escrita em `1_SPEC.md`, com 22 regras, 13 critérios de aceite e o fora do escopo. Ela fixa, como recomendação do refino: padrões de limites (5 MB por imagem, 1 MB por outro tipo, 10 MB e 10 arquivos por mensagem; tipos: imagens, texto e log, PDF, JSON, CSV), tipo pelo conteúdo, arquivo por conversa nos dados do espaço de trabalho, remoção antes do envio e exclusão da mensagem apagando os arquivos, ferramenta de anexo somente leitura por conversa, imagem chegando ao modelo como imagem nos dois motores, aviso único de que o que vai ao provedor de modelo sai do computador, e um interruptor de anexos para agentes por espaço de trabalho.
- Leitura recomendada e adotada na spec para a parte 3 da issue: só imagem e texto alcançam o modelo (imagem como imagem; texto cortado); PDF, JSON e CSV ficam mostráveis e baixáveis, mas não vão ao modelo. É a pergunta 1 do portão, e a alternativa foi dita.

## Restrições

- A issue é especificação funcional; o desenho da solução é do refino e do plano.
- O que a issue fixa: o anexo é guardado nos dados do espaço de trabalho, por conversa (`workspaces/<id>/…`), nunca em um repositório e nunca no worktree da execução; o tipo é checado pelo conteúdo, não pelo nome; o agente chamado nunca recebe um caminho no computador e só alcança os arquivos da conversa em que foi chamado; o que vai ao provedor de modelo sai do computador (a caixa avisa uma vez e o espaço de trabalho pode desligar anexos para agentes).
- Fora do escopo: agentes criarem arquivos por conta própria (issue de evidência, separada) e enviar anexos ao host de código.
- Uma menção responde somente leitura e usa a cópia descartável quando executa comandos (regra da issue 53, já entregue na 0.6.0).
- A leitura da issue ("image", "text as text") fixou a entrega em imagem + texto; todo anexo é mostrado e baixável ao alcance do navegador pareado, mas só imagem e texto vão ao modelo até a pessoa decidir a pergunta 1.

## Tentado e descartado

- Enviar uma imagem como texto dentro do corpo da mensagem foi descartado: o redutor de credenciais apaga textos de 32 caracteres ou mais em formato misto (a assinatura de um base64), o compositor permite 20.000 caracteres por mensagem, e o resultado de ferramenta do motor aberto já é texto — a imagem precisa de caminho próprio nos dois motores.
- Um segundo caminho de anexo só para a mensagem que responde a pergunta de uma execução foi descartado em favor de um só: o anexo entra pelo mesmo lugar, com a resposta.
- Nada foi executado e nenhum comportamento novo foi visto funcionando: não houve reprodução, execução nem verificação em tela.

## Perguntas abertas

- Nenhuma de quem abriu a issue. As do portão, escritas na spec: (1) leitura estrita (só imagem e texto ao modelo) ou ampla (todo anexo ao alcance do agente vai ao modelo); (2) se os padrões numéricos propostos são os que valem na instalação nova; (3) um envio do telefone que não caiba no teto de corpo da chamada é recusado com o motivo ou precisa de caminho próprio; (4) o resto é do plano técnico (cota da pasta do ciclo, leiaute em `workspaces/<id>/`, retenção).

## Onde o trabalho está

Refino concluído; `0_TRIAGE.md` e `1_SPEC.md` escritos na pasta do ciclo. A issue segue para o portão 1 e, depois, para o plano técnico. Nada de código foi tocado.
- Passagem product-owner → tech-lead: A spec de `1_SPEC.md` é o que o plano precisa cobrir. Pontos que só o plano decide: onde o anexo fica em `workspaces/<id>/` e como é apagado (remover antes de enviar, excluir a mensagem, retenção); como o teto de corpo de 15 MB do RPC e o redutor de credenciais convivem com um arquivo em base64; a ferramenta de leitura de anexo (nome, parâmetros e limites) e como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferramenta do motor aberto é texto hoje; o canal novo do fórum e o teste de política que hoje fixa os canais de `forum:*`; e como o anexo da resposta entra no prompt da etapa.
- Passagem support → product-owner: Issue 120 está entendida e nada falta de quem a abriu. O refino deve escrever a spec funcional apoiada em `0_TRIAGE.md`: os padrões numéricos de tamanho por arquivo e por mensagem; como o tipo é checado pelo conteúdo; onde o arquivo vive em `workspaces/<id>/` e como ele é apagado (mensagem excluída, anexo removido antes de enviar, retenção); como o anexo entra no prompt da etapa quando a mensagem é a resposta que a execução espera; como uma imagem chega ao modelo nos dois motores, dado que o resultado de ferramenta do motor aberto é texto hoje; e o comportamento do canal novo na política web, … <!-- handoff:7 -->
