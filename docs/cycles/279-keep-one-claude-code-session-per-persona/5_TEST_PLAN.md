# Plano de testes: sessão única por conversa com a persona

Os cenários abaixo derivam dos critérios de aceite. "Executado" quer dizer que um comando rodado nesta etapa mostrou o resultado. Todos os testes usam SDK ou motor falso, com ids de sessão inventados.

## Comandos rodados nesta etapa

- Testes de sessão e regressão (`persona-session-keep`, `persona-session-resume`, `engine-session-gone`, `schedules-fire`, `runner-agent-open`, `persona-stop`, `persona-tools`, `persona-audit`, `persona-door`, `persona-stream-sdk`): 10 arquivos, 157 testes, todos passam (ev-2).
- `tsc --noEmit`, `theme-audit`, `i18n:lint`, `public-audit`: todos passam (ev-3).
- `electron-vite build`: concluído (ev-4).
- A suíte completa não foi repetida nesta etapa. O relato anterior (8911 passam, 4 falhas de navegador por `@playwright/mcp` ausente e 2 por tempo sob carga) é contexto, não evidência desta etapa.

## Cenários

1. **Três mensagens, uma sessão (critério 1).** Enviar três mensagens seguidas na mesma conversa. Esperado: a primeira chamada sem `resume` e as duas seguintes com a sessão da primeira. Também há uma linha de base sem sessões guardada, com três chamadas sem `resume`. Resultado: passa nos testes com motor falso (ev-2). A contagem de sessões em disco real não foi verificada.
2. **Sessão removida (critério 2).** A continuação falha antes de qualquer saída. Esperado: nova tentativa sem sessão, com a conversa inteira, resposta normal, atividade `finished` e nenhum erro na conversa. Vale também para exceção do CLI. Resultado: passa com SDK falso (ev-2). O erro do CLI real não foi verificado.
3. **Provedor trocado (critério 3).** Trocar o provedor e enviar uma mensagem. Esperado: nenhum `resume`, sessão nova. Resultado: passa (ev-2).
4. **Acordar agendado (critério 4).** Esperado: continua a sessão válida; sem sessão válida, abre uma nova sem erro. Resultado: passa em `schedules-fire` (ev-2).
5. **Resposta depois de parada (critério 5).** Esperado: segue as regras 1 e 3. Resultado: passa (ev-2).
6. **Motor open (critério 6).** Esperado: sem `resume` e nada guardado; `runner-agent-open` sem alteração. Resultado: passa (ev-2).
7. **Testes com SDK falso e sem dados de `~/.claude` (critério 7).** Resultado: passa (ev-2). A ausência de dados reais veio de leitura dos ids inventados e do `public-audit` limpo (ev-3).
8. **Ferramentas, porta, parada e auditoria (critério 8).** Resultado: `persona-tools`, `persona-audit`, `persona-door` e `persona-stop` passam sem alteração (ev-2).
9. **Nada repetido depois de saída ou ferramenta.** Esperado: com ferramenta usada, orçamento ou parada, não há segunda tentativa. Resultado: passa (ev-2).
10. **Gates do repositório e build.** Resultado: passam (ev-3, ev-4).

## Não verificado

- Conferência manual com o Claude Code real: três mensagens, contagem de sessões em disco, apagar a sessão e enviar a quarta. Não havia Claude Code logado nem comando permitido para isso.
- O erro real do SDK ou do CLI para uma sessão removida.
- A compactação de sessões longas pelo CLI.
- Respostas simultâneas na mesma conversa (sem trava, sem teste).
- A suíte completa nesta etapa.

## Observações (não bloqueiam)

- Qualquer exceção antes de saída, numa chamada com `resume`, vira nova tentativa; um erro de rede persistente dobra a tentativa.
- A rodada de reparo da QA (`executor.ts`) não leva a sessão anterior; fica como outra issue.

## Resultado dos cenários

- 1. Três mensagens, uma sessão: passou (executado na sandbox) — Com motor falso, a primeira chamada vai sem resume e a segunda e a terceira com a sessão da primeira; a linha de base sem sessões mostra três chamadas sem resume. Sessões em disco real não verificadas.
- 2. Sessão removida abre nova sem erro: passou (executado na sandbox) — Com SDK falso, a falha antes de saída gera uma nova tentativa sem resume, com a conversa inteira; a resposta é normal e a atividade termina finished. Vale para resultado de erro e para exceção.
- 3. Provedor trocado: passou (executado na sandbox) — Provedor diferente do guardado: a chamada não leva resume.
- 4. Acordar agendado: passou (executado na sandbox) — O acordar continua a sessão válida; sem sessão válida, abre uma nova sem erro.
- 5. Resposta depois de parada: passou (executado na sandbox) — A mensagem segurada e solta pela retomada, e a seguinte, seguem a regra de retomada e queda.
- 6. Motor open inalterado: passou (executado na sandbox) — O motor open não recebe resume e nada é guardado; runner-agent-open passa sem alteração.
- 7. Ferramentas, porta, parada e auditoria: passou (executado na sandbox) — persona-tools, persona-audit, persona-door, persona-stop e persona-stream-sdk passam sem alteração.
- 8. Nada repetido depois de ferramenta, orçamento ou parada: passou (executado na sandbox) — Nesses casos não há segunda tentativa.
- 9. Gates do repositório: passou (executado na sandbox) — tsc, theme-audit, i18n:lint e public-audit saem com 0.
- 10. electron-vite build: passou (executado na sandbox) — O build concluiu com saída 0.
- 11. Conferência manual com o Claude Code real: não rodou (lido) — Não havia Claude Code logado nem comando permitido para isso; o erro real do CLI para sessão removida e a contagem em disco ficam sem verificação.
