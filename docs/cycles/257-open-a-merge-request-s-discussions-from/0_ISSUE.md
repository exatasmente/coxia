# 257 Open a merge request's discussions from a conversation when the MR is not a card of the day

- Endereço: https://github.com/exatasmente/coxia/issues/257
- Estado: open
- Rótulos: enhancement, coxia, priority:low
- Autor: exatasmente

## Descrição

### O que muda para quem usa

Um agente que acompanha uma MR numa conversa do chat pode abrir a tela de discussões dessa MR mesmo quando ela não é um card do dia. Hoje o app recusa: a tela `discussions` exige a referência (`ref`) de um card do dia e resolve a MR a partir de `card.mrPaths` (`src/renderer/src/App.tsx:60`, `App.tsx:196-197`, `src/renderer/src/screens/Discussions.tsx:41-42`), então um número de MR nunca serve de `ref` e a tela cai em `ui.discussions.notFound`. Sem card, não há como ver e seguir as discussões da MR a partir da conversa, mesmo quando o agente já leu os threads por ferramenta.

### Escopo

- A tela de discussões passa a poder ser aberta a partir de uma MR identificada por projeto + `iid`, sem depender de um card do dia carregado.
- A recusa atual passa a dizer o motivo e o que fazer, em vez de só não abrir.
- Leitura continua restrita aos projetos permitidos do workspace (`projectAllowed`, strict), com o mesmo rigor do `VcsRead`.

### Fora de escopo

- Escrever sem proposta: o comportamento de proposta-only da fila de Ações fica como está (`src/main/feedback.ts:446`).
- Não é "o agente não alcança o dado": ler os threads de uma MR pela ferramenta `VcsRead` (op `mr_threads`/`mr_comments`, `src/main/vcs/readTool.ts:83-88`) já funciona hoje. O que falta é a superfície da tela.
- Nenhuma mudança na regra que exige `ref` para os cards do dia.

### Como verificar

1. Numa conversa, pedir as discussões de uma MR que **não** é card do dia: a tela abre com os threads não resolvidos.
2. Pedir as discussões de uma MR de um projeto fora do escopo do workspace: recusa com o motivo.
3. Abrir as discussões de um card do dia como hoje: comportamento inalterado.

_Origem: limitação relatada por um agente em conversa (2026-10-11); prioridade proposta `priority:low`._

## Comentários

(sem comentários)
