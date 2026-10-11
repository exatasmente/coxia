# Plano de testes: discussões de uma MR por projeto e número, depois da mesclagem com a release

Resumo: depois de trazer a release para a branch, os gates automáticos foram rodados de novo nesta etapa e passaram. A interface não foi exercitada no app; os cenários de tela ficam como não rodados.

## Gates rodados nesta etapa (saída 0)
- `npx electron-vite build`: concluído; `out/` apagado depois (ev-13)
- `npx tsc --noEmit`, `npm run i18n:lint`, `node scripts/theme-audit.mjs` (ev-14)
- `npx vitest run` nos 7 arquivos tocados (`persona-door-table`, `discussions-by-mr`, `push-targets`, `mentions-open-discussions`, `persona-open-screen`, `chat-model`, `jobs`): 124 passam (ev-15)
- `node scripts/public-audit.mjs`, sem `out/`: 1916 arquivos, nada achado (ev-15)
- O vitest completo não foi rodado nesta etapa; o relato da implementação cita 8711 passando e falha só nos 4 arquivos de navegador (`@playwright/mcp` ausente) e oscilação de `conflict-from-mr`: não verificado aqui.

## Cenários

| # | Critério | Fazer / esperar | Resultado |
|---|---|---|---|
| 1 | Caso da issue | Botão com MR sem card; tocar abre a tela com threads não resolvidos | Só testes (ev-15); tela não rodada |
| 2 | Projeto fora do workspace | Recusa com motivo, pt e en | Só testes (ev-15); tela não rodada |
| 3 | Card do dia inalterado | Abre pela referência da issue | Testes de rota/destino passam (ev-15); tela não rodada |
| 4 | Agente não persona | Botão; nada abre sozinho; linha de sistema ao tocar | Testes de fiação passam (ev-15); tela não rodada |
| 5 | Conversa de execução | Botão aparece no thread de execução | Não rodado na tela |
| 6 | Número inválido | Recusa com motivo, sem dizer que é issue | Teste (ev-15) |
| 7 | Workspace sem projetos | Recusa com instrução | Teste (ev-15) |
| 8 | Leitura restrita | Nenhuma leitura fora da lista | Teste (ev-15) |
| 9 | Rótulo do botão | Nos dois idiomas | Teste do modelo de chat (ev-15), i18n lint (ev-14) |
| 10 | Teto de 4 botões | Inalterado | Não exercitado separadamente |
| 11 | Nada escrito | Sem responder/resolver sem card | Só lido; tela não rodada |
| 12 | Explicação sem card | Funciona | Teste (ev-15) |
| 13 | Sem thread aberto | Mensagem com a MR | Não rodado |
| 14 | Voltar à conversa | Chat, Fórum, execução | Só testes de `buttonScreen`; tela não rodada |
| 15 | Sem tarefa enganosa | Sem job da MR | Teste `jobs` (ev-15); tela não rodada |
| 16 | Build depois da mesclagem | electron-vite build | Passou (ev-13) |
| 17 | Tabela da porta da persona | Os dois canais novos classificados | Teste `persona-door-table` passa (ev-15) |

## Não verificado
- Nenhuma tela foi aberta no app (chat da persona, Fórum, execução), nem a linha de sistema nem o voltar.
- Celular pareado (Q3), escopo de execução (Q5), vitest completo.
- Que o host deixe de acusar conflito depois do push; base do PR (deve ser `release/0.10.0`).
- Observação: cada toque grava uma nova linha de sistema (sugestão da revisão; não bloqueia).

## Resultado dos cenários

- Build depois da mesclagem: passou (executado na sandbox) — electron-vite build terminou com saída 0; out/ apagado depois.
- tsc, i18n lint e theme audit: passou (executado na sandbox) — As três checagens terminaram com saída 0.
- Testes tocados e public-audit: passou (executado na sandbox) — 7 arquivos, 124 testes passam (recusas, destino por par, rótulo, ferramenta, jobs, tabela da porta); public-audit sem out/: 1916 arquivos, nada achado.
- Tela aberta por botão no chat, Fórum e execução; linha no thread e voltar: não rodou (lido) — O app não foi iniciado nesta etapa; só testes automatizados cobrem esses comportamentos. Sem comprovação de tela.
- Vitest completo: não rodou (lido) — Não rodado nesta etapa; o relato do dev cita falhas só em 4 arquivos de navegador e oscilação de conflict-from-mr, não verificado aqui.
