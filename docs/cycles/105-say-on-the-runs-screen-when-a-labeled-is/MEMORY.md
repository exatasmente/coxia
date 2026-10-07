# Memória do ciclo

## Decisões

- Triagem concluída na tentativa 3: issue é pedido de funcionalidade claro, com critérios de aceite e origem da divisão citada. Sem pergunta à pessoa que abriu; sem pergunta que pause a etapa. Sem duplicadas além da issue de origem (relacionada).
- Sugestão de prioridade: manter `priority:low` (decisão final fica na etapa de refinamento).
- Squad proposto: plataforma (a mudança vive no runtime do runner: a consulta de issues e o início manual de run), mesmo que o resultado apareça na tela de runs. Decisão final de quem tem autonomia.

## Restrições

- A varredura automática (`scanIssues`) usa `triggered(label)`, que hoje só consulta `listMyIssues` (issues da própria pessoa) e filtra pelo rótulo de gatilho; issues com rótulo e sem assignee nunca entram. A varredura não pode começar a iniciar essas issues sozinha — o aceite pede que nada inicie sozinho a partir da nova lista.
- Aceite: a tela de runs lista issues abertas com o rótulo de gatilho e sem assignee, com um jeito de iniciar run manualmente; nada inicia por si mesmo a partir dessa lista.
- A issue de origem da divisão (texto da issue) passou a cobrir só documentação e a dica do campo de gatilho — escopo desta issue é não sobrepor.
- Regras do projeto: textos de interface via `t()` nos dois catálogos; sem número real de issue em arquivos do repo público (usar `#123` neutro); inglês em código e commits.

## Tentado e descartado

- Nada foi tentado/descartado de implementação (etapa é só leitura). Confirmado por leitura: `triggered()` usa `listMyIssues`; `VcsIssue` traz `assignees`; `listIssues` (escopo `labels`) lista abertas do projeto independente de assignee — a consulta nova pedida é viável.

## Perguntas abertas

- Nenhuma para quem abriu. Decisões de apresentação (posição da lista na tela, texto do controle) são da etapa de refinamento do produto.

## Onde o trabalho está

- Etapa de triagem concluída; falta a conversa/resposta final e o comentário na tracker. Próximas etapas: refinamento do produto (spec e prioridade) e desenvolvimento. Trabalho futuro em `src/main/runner` (fonte de issues/consulta nova e início manual) e `src/renderer/src/screens/cycle/RunsScreen.tsx`.
