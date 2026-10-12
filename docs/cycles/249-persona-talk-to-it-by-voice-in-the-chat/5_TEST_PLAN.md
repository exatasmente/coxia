# Plano de testes: falar com a persona por voz

Legenda: **executado** = comando rodado nesta tentativa; **lido** = só por leitura; **não verificado** = não exercitado. Tentativa 3: só a base e o tsc foram repetidos; o resto vem da tentativa anterior (ev-5).

## Comandos rodados nesta tentativa
- `git rev-list --left-right --count HEAD...origin/release/0.11.0`: 12 à frente, 11 atrás. Base ainda não mesclada. (ev-7)
- `npx tsc --noEmit`: exit 0. (ev-7)

## Da tentativa anterior (ev-5, não repetido agora)
- 154 testes de voz, origem, prompt, barge, i18n e ui-i18n passam; theme-audit exit 0; i18n:lint 6305 chaves nos dois idiomas; public-audit limpo.
- Suíte inteira: só falham os 4 arquivos do navegador (falta @playwright/mcp, ambiente).

## Cenários

| # | Critério | Fazer / esperar | Resultado |
|---|---|---|---|
| 1 | Pedido por voz no chat | Falar, soltar: transcrito, executado, respondido em voz | Lógica de origem 'voice' passa (ev-5); ponta a ponta não verificado |
| 2 | Barge-in | Falar durante a fala: para e o novo pedido é ouvido | `voice-loop` passa (ev-5); áudio real não verificado |
| 3 | Modo de voz | Botão e Ctrl/Cmd+Shift+M; estados, legendas, silenciar, encerrar | Testes puros (ev-5); aparência, contraste e colisão do atalho não verificados |
| 4 | Duas perguntas seguidas | Sem toque; trocas no chat ao sair | `voice-loop` passa (ev-5) |
| 5 | Voz antes do fim do texto | 1ª frase falada antes do fim | `voice-turns`, `voice-sentences`, `voice-speech-feed` passam (ev-5); lacunas reais não verificadas |
| 6 | Sem markdown lido | Resposta curta, sem símbolos | Texto do prompt testado (ev-5); modelo real não verificado |
| 7 | Ação longa | Aviso e resumo | Só o prompt; modelo não verificado |
| 8 | Voz desligada/não instalada | Aviso com caminho às configurações | `voice-gate` passa (ev-5); tela não vista |
| 9 | "Sim" falado não aprova efeito externo | Confirmação por botão | Estrutural (lido) |
| 10 | Celular com/sem https | Mensagem com o motivo | testes puros passam (ev-5); aparelho não verificado |
| 11 | Celular bloqueado: "pausado" | Toque retoma | testes puros passam (ev-5); aparelho não verificado |
| 12 | Latência | Medir fim da fala → 1ª palavra (meta 3 s) | Conta testada; valor real não medido |
| 13 | Cerimônias iguais | Extração sem mudar comportamento | tsc passa (ev-7); telas não abertas |
| 14 | Textos en/pt-BR | Chaves nos dois catálogos | i18n:lint e testes passam (ev-5) |
| 15 | Base da release | Sem atraso em relação a origin/release/0.11.0 | Falhou: 11 atrás, conflito só em CHANGELOG.md (manter o arquivo da branch); a mesclagem é feita pela ferramenta de conflito do app (ev-7) |

## Conclusão
O único item que falha é a base (cenário 15), que não pode ser resolvida pelo shell. Depois da mesclagem, repetir tsc e testes de voz. Rodada manual com voz instalada segue pendente.

## Resultado dos cenários

- Base atualizada com a release aberta: falhou (executado na sandbox) — 12 à frente e 11 atrás de origin/release/0.11.0; mesclagem só pela ferramenta de conflito do app (conflito só em CHANGELOG.md).
- Typecheck: passou (executado na sandbox) — npx tsc --noEmit saiu com 0.
- Fluxo de voz no app, latência, celular: não rodou (lido) — Sem voz instalada nem aparelho pareado; app não aberto.
