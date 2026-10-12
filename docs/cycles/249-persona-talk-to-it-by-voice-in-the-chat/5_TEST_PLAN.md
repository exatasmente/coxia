# Plano de testes: falar com a persona por voz

Legenda: **executado** = comando rodado nesta tentativa; **lido** = só por leitura; **não verificado** = não exercitado.

## Comandos rodados nesta tentativa (4)
- `git rev-list --left-right --count HEAD...origin/release/0.11.0`: 17 à frente, 0 atrás. Base mesclada.
- `npx tsc --noEmit`: saída 0.
- `npx electron-vite build`: saída 0 (ev-10).
- Testes de voz, origem, prompt de voz, barge-in, i18n e ui-i18n: 154 passam. `theme-audit` saída 0. `i18n:lint`: 6301 chaves nos dois idiomas. `public-audit`: limpo, 2013 arquivos (ev-11).
- Suíte inteira não repetida aqui; o relato anterior (ev-9) diz que só os 4 arquivos do navegador falham (falta @playwright/mcp, ambiente) e que modules-registered falhou uma vez e passou sozinho. Não reconferido.

## Cenários

| # | Critério | Fazer / esperar | Resultado |
|---|---|---|---|
| 1 | Pedido por voz no chat | Falar, soltar: transcrito, executado, respondido em voz | Lógica de origem 'voice' passa (ev-11); ponta a ponta não verificado |
| 2 | Barge-in | Falar durante a fala: para e o novo pedido é ouvido | `voice-loop` passa (ev-11); áudio real não verificado |
| 3 | Modo de voz | Botão e Ctrl/Cmd+Shift+M; estados, legendas, silenciar, encerrar | Testes puros (ev-11); aparência, contraste e colisão do atalho não verificados |
| 4 | Duas perguntas seguidas | Sem toque; trocas no chat ao sair | `voice-loop` passa (ev-11) |
| 5 | Voz antes do fim do texto | 1ª frase falada antes do fim | `voice-turns`, `voice-sentences`, `voice-speech-feed` passam (ev-11); lacunas reais não verificadas |
| 6 | Sem markdown lido | Resposta curta, sem símbolos | Texto do prompt testado (ev-11); modelo real não verificado |
| 7 | Ação longa | Aviso e resumo | Só o prompt; modelo não verificado |
| 8 | Voz desligada/não instalada | Aviso com caminho às configurações | `voice-gate` passa (ev-11); tela não vista |
| 9 | "Sim" falado não aprova efeito externo | Confirmação por botão | Estrutural (lido) |
| 10 | Celular com/sem https | Mensagem com o motivo | testes puros passam (ev-11); aparelho não verificado |
| 11 | Celular bloqueado: "pausado" | Toque retoma | testes puros passam (ev-11); aparelho não verificado |
| 12 | Latência | Medir fim da fala → 1ª palavra (meta 3 s) | Conta testada; valor real não medido |
| 13 | Cerimônias iguais | Extração sem mudar comportamento | tsc e build passam (ev-10); telas não abertas |
| 14 | Textos en/pt-BR | Chaves nos dois catálogos | i18n:lint e testes passam (ev-11) |
| 15 | Base da release | Sem atraso em relação a origin/release/0.11.0 | Passou: 0 atrás (executado) |
| 16 | Build | electron-vite build | Passou, saída 0 (ev-10) |

## Conclusão
Nenhum cenário falhou. Pendente: rodada manual com voz instalada (critérios 1, 2, 3, 6, 7, 10, 11), latência real, lacunas entre frases, barge-in com eco, celular real, colisão do atalho, e o modelo seguindo o prompt de voz.

## Resultado dos cenários

- Base atualizada com a release: passou (executado na sandbox) — 0 commits atrás de origin/release/0.11.0, 17 à frente.
- Typecheck: passou (executado na sandbox) — npx tsc --noEmit saiu com 0.
- electron-vite build: passou (executado na sandbox) — Build concluído com saída 0.
- Testes de voz, origem, prompt e i18n: passou (executado na sandbox) — 154 testes passam (lógica pura dos critérios 1, 2, 4, 5, 8, 10, 11, 14).
- theme-audit, i18n:lint, public-audit: passou (executado na sandbox) — theme-audit saída 0; 6301 chaves nos dois idiomas; public-audit limpo.
- Voz de ponta a ponta, latência, celular, modelo: não rodou (lido) — Sem voz instalada nem aparelho pareado; app com voz não aberto; sem comprovação.
