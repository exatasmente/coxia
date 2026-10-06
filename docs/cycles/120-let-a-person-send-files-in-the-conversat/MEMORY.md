# Memória do ciclo

## Decisões

- A issue 120 é um pedido de funcionalidade (`enhancement`), não um defeito: não há o que reproduzir, e o entendimento foi conferido por leitura do código, sem executar o aplicativo.
- Nada falta que só quem abriu a issue possa dizer; nenhuma pergunta foi publicada na issue.
- Squad proposto: `experiencia`, porque o comportamento começa e termina no que a pessoa vê e toca (compositor, miniatura, chip, download) e as telas e textos vivem em `src/renderer` e `src/shared/i18n`.
- Prioridade sugerida: `priority:high` (deixa de ser preciso descrever em palavras um defeito, um log ou uma referência de desenho). Sugestão, não preenchida.

## Restrições

- A issue é especificação funcional; o desenho da solução é do refino e do plano.
- O que a issue fixa: o anexo é guardado nos dados do espaço de trabalho, por conversa (`workspaces/<id>/…`), nunca em um repositório e nunca no worktree da execução; o tipo é checado pelo conteúdo, não pelo nome; o agente chamado nunca recebe um caminho no computador e só alcança os arquivos da conversa em que foi chamado; o que vai ao provedor de modelo sai do computador (a caixa avisa uma vez e o espaço de trabalho pode desligar anexos para agentes).
- Fora do escopo: agentes criarem arquivos por conta própria (issue de evidência, separada) e enviar anexos ao host de código.
- Uma menção responde somente leitura e usa a cópia descartável quando executa comandos (regra da issue 53, já entregue na 0.6.0).

## Tentado e descartado

- Nada foi descartado nesta etapa: não houve reprodução, execução nem verificação em tela.

## Perguntas abertas

- Nenhuma de quem abriu a issue. As decisões que sobram são do refino e do plano: os padrões numéricos de tamanho por arquivo e por mensagem; como um anexo divide o orçamento de leitura da pasta do ciclo quando entra no texto de uma etapa; como uma imagem chega ao modelo nos dois motores; e se o canal novo de anexo entra na mesma lista aberta ao navegador pareado.

## Onde o trabalho está

Etapa de triagem concluída; `0_TRIAGE.md` escrito na pasta do ciclo. A issue segue para o refino do produto, com a spec funcional. Nada de código foi tocado.
