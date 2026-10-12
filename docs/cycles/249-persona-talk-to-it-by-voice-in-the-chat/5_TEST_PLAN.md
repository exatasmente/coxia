# Plano de testes: voz no chat da persona e modo de voz

Legenda: **executado** = comando rodado nesta etapa (ev-2); **lido** = só por leitura de documentos; **não verificado** = não exercitado.

## Resultados dos comandos (rodados nesta etapa)
- `npx tsc --noEmit`: exit 0.
- `npx vitest run` nos arquivos de voz, origem, prompt de voz, barge, i18n, ui-i18n e voice-terminology: 18 arquivos, 154 testes passam.
- `node scripts/theme-audit.mjs`: exit 0. `npm run i18n:lint`: exit 0 (6305 chaves nos dois idiomas). `node scripts/public-audit.mjs`: exit 0.
- `npx vitest run` inteiro: 551 arquivos passam; 4 falham (browser-contract, browser-quit, browser-runtime, browser-sites) por falta do pacote local `@playwright/mcp` na worktree; 8955 testes passam, 2 falham (os mesmos do navegador), 15 ignorados. Sem relação com a mudança. (ev-2)
- `electron-vite build`: não rodado.

## Cenários

| # | Critério | O que fazer / esperar | Resultado |
|---|---|---|---|
| 1 | Pedido por voz no chat | Apertar o microfone, falar, soltar: transcrito, executado, respondido em voz. | Não verificado ponta a ponta (sem voz instalada, app não aberto). Lógica de origem 'voice' coberta por `forum-origin` (passa, ev-2). |
| 2 | Barge-in | Falar durante a fala: para e o novo pedido é ouvido. | Máquina de estados coberta por `voice-loop` (passa, ev-2); áudio real não verificado. |
| 3 | Modo de voz: estados, legendas, silenciar, encerrar, atalho | Abrir por botão e Ctrl/Cmd+Shift+M. | Lógica de estados e do atalho cobertas por testes (passam, ev-2); aparência, foco, contraste e colisão do atalho não verificados. |
| 4 | Duas perguntas seguidas, tudo no chat | Sem tocar em nada; trocas no chat ao sair. | `voice-loop` cobre as duas voltas (passa, ev-2); mesmo fio por construção (lido); app não verificado. |
| 5 | Voz antes do fim do texto | Primeira frase falada antes de a resposta terminar. | `voice-turns`, `voice-sentences`, `voice-speech-feed` passam (ev-2); lacunas e tempo reais não verificados. |
| 6 | Sem markdown lido | Resposta de voz curta e sem símbolos. | Prompt de voz nos dois idiomas coberto por `persona-voice-prompt` (passa, ev-2); o modelo real seguir o prompt não verificado. |
| 7 | Ação longa: aviso e resumo | Uma frase de aviso, depois resumo. | Só o texto do prompt é testado; comportamento do modelo não verificado. |
| 8 | Voz desligada/não instalada | Aviso com caminho para as configurações; sem download nem microfone. | `voice-gate` passa (ev-2); tela real não verificada. |
| 9 | "Sim" falado não aprova efeito externo | Confirmação é botão. | Estrutural (lido nos documentos); prompt testado; não exercitado no app. |
| 10 | Celular com e sem https | Mensagem com o motivo sem https. | `voice-mic-support` e `voice-phone` passam (ev-2); aparelho real não verificado. |
| 11 | Celular bloqueado: "pausado" | Toque retoma. | `voice-phone`/`voice-loop` passam (ev-2); aparelho real não verificado. |
| 12 | Latência fim da fala → 1ª palavra | Medir e registrar (meta 3 s, débito não bloqueia). | A conta está coberta por `voice-latency` (passa); **valor real não medido** (sem voz instalada). Registrar como pendência. |
| 13 | Cerimônias iguais | Extração sem mudar comportamento. | `tsc` e a suíte inteira (exceto navegador) passam; telas não abertas. |
| 14 | Textos em en e pt-BR | Chaves nos dois catálogos. | `i18n:lint`, `i18n`, `ui-i18n`, `voice-terminology` passam (ev-2). |

## Conclusão
Nada falhou nos comandos exercitados. Lacuna principal: nenhum cenário com áudio, tela ou aparelho foi executado; precisa de uma rodada manual com voz instalada (latência, barge-in com eco, lacunas entre frases, celular com https, atalho, `electron-vite build`).

Sugestão não bloqueante da revisão ainda aberta: teste do `sayStream` com fala desligada.

## Resultado dos cenários

- Gates: tsc, theme-audit, i18n:lint, public-audit: passou (executado na sandbox) — tsc exit 0; theme-audit exit 0; i18n:lint exit 0 (6305 chaves nos dois idiomas); public-audit exit 0.
- Testes de lógica de voz, origem, prompt e catálogos: passou (executado na sandbox) — 18 arquivos, 154 testes passam (voz, forum-origin, persona-voice-prompt, barge, i18n, ui-i18n, voice-terminology). Cobrem critérios 2, 4, 5, 8, 10, 11, 14 só na lógica.
- Suíte inteira: passou (executado na sandbox) — 8955 testes passam; 2 falham e 4 arquivos de navegador não carregam por falta de @playwright/mcp na worktree (ambiente, sem relação com a mudança).
- Fluxo de voz ponta a ponta no app (critérios 1, 2, 3, 6, 7): não rodou (lido) — App não aberto: sem voz instalada no ambiente; microfone, fala, aparência do modo de voz e o modelo seguir o prompt não verificados.
- Latência fim da fala → primeira palavra (critério 12): não rodou (lido) — Sem voz instalada, o valor real não foi medido; só a conta é testada. Débito não bloqueia pela regra 12.
- Celular real com e sem https (critérios 10, 11): não rodou (lido) — Sem aparelho pareado; só a lógica pura foi testada.
- electron-vite build: não rodou (lido) — Não rodado nesta etapa.
