# Plano de testes: discussões de uma MR por projeto e número

Resumo: os gates automáticos passaram nesta etapa. A interface não foi exercitada no app; os cenários de tela ficam como não rodados.

## Gates rodados (saída 0)
- `npx tsc --noEmit` (ev-7)
- `npx vitest run` nos 6 arquivos tocados: 102 passam (ev-10)
- `npm run i18n:lint` (5927 chaves nos dois idiomas), `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs` (ev-8)
- `npx electron-vite build` (ev-9)
- O vitest completo não foi rodado nesta etapa; o relato da implementação cita falha só nos 4 arquivos de navegador (`@playwright/mcp` ausente) e oscilação de `conflict-resolve`: não verificado aqui.

## Cenários

| # | Critério | Fazer / esperar | Resultado |
|---|---|---|---|
| 1 | Caso da issue | Botão com MR sem card; tocar abre a tela com threads não resolvidos | Só testes (ev-10); tela não rodada |
| 2 | Projeto fora do workspace | Recusa com motivo, pt e en | Só testes (ev-10); tela não rodada |
| 3 | Card do dia inalterado | Abre pela referência da issue | Não rodado na tela; testes de rota/destino passam (ev-10) |
| 4 | Agente não persona | Botão; nada abre sozinho; linha de sistema ao tocar | Teste de fiação e de `discussionsOpened` passam (ev-10); tela não rodada |
| 5 | Conversa de execução | Botão aparece no thread de execução | Não rodado na tela |
| 6 | Número inválido | Recusa com motivo, sem dizer que é issue | Teste (ev-10) |
| 7 | Workspace sem projetos | Recusa com instrução | Teste (ev-10) |
| 8 | Leitura restrita | Nenhuma leitura fora da lista | Teste (ev-10) |
| 9 | Rótulo do botão | Nos dois idiomas | Teste do modelo de chat (ev-10), i18n lint (ev-8) |
| 10 | Teto de 4 botões | Inalterado | Não exercitado separadamente |
| 11 | Nada escrito | Sem responder/resolver sem card | Só lido/testado; tela não rodada |
| 12 | Explicação sem card | Funciona | Teste (ev-10) |
| 13 | Sem thread aberto | Mensagem com a MR | Não rodado |
| 14 | Voltar à conversa | Chat, Fórum, execução | Só testes de `buttonScreen`; tela não rodada |
| 15 | Sem tarefa enganosa | Sem job da MR | Teste `jobs` (ev-10); tela não rodada |
| 16 | Build | electron-vite build | Passou (ev-9) |

## Não verificado
- Nenhuma tela foi aberta no app (chat da persona, Fórum, execução), nem o desenho da linha de sistema nem o voltar.
- Celular pareado (Q3), escopo de execução (Q5), vitest completo.
- Observação: cada toque grava uma nova linha de sistema (sugestão da revisão; não bloqueia).

## Resultado dos cenários

- Type check: passou (executado na sandbox) — tsc --noEmit terminou com saída 0.
- Testes dos 6 arquivos tocados: passou (executado na sandbox) — 102 testes passam: recusas, destino por par, rótulo, fiação da ferramenta, linha de sistema, jobs.
- i18n, theme e public audit: passou (executado na sandbox) — 5927 chaves nos dois idiomas; theme e public audit com saída 0.
- electron-vite build: passou (executado na sandbox) — Build concluído, saída 0.
- Tela aberta por botão no chat, Fórum e execução; linha no thread e voltar: não rodou (lido) — O app não foi iniciado nesta etapa; só testes automatizados cobrem esses comportamentos. Sem comprovação de tela.
