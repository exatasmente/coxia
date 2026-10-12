# Plano de testes: falar com a persona por voz

Legenda: **executado** = comando rodado nesta tentativa (ev-5); **lido** = só por leitura; **não verificado** = não exercitado.

## Comandos rodados nesta tentativa
- `git rev-list --left-right --count HEAD...origin/release/0.11.0`: 10 à frente, 11 atrás. A base ainda não foi mesclada.
- `npx tsc --noEmit`: exit 0.
- `npx vitest run` (voz, origem, prompt de voz, barge, i18n, ui-i18n): 154 testes passam.
- `node scripts/theme-audit.mjs`: exit 0. `npm run i18n:lint`: 6305 chaves nos dois idiomas. `node scripts/public-audit.mjs`: limpo, 2004 arquivos. (ev-5)
- Suíte inteira e `electron-vite build`: não rodados nesta tentativa. O app os rodou antes: só os 4 arquivos do navegador falham, por falta de `@playwright/mcp` (ambiente); o build passou na integração.

## Cenários

| # | Critério | Fazer / esperar | Resultado |
|---|---|---|---|
| 1 | Pedido por voz no chat | Microfone, falar, soltar: transcrito, executado, respondido em voz | Lógica de origem 'voice' passa (ev-5); ponta a ponta não verificado (sem voz instalada) |
| 2 | Barge-in | Falar durante a fala: para e o novo pedido é ouvido | `voice-loop` passa (ev-5); áudio real não verificado |
| 3 | Modo de voz | Botão e Ctrl/Cmd+Shift+M; estados, legendas, silenciar, encerrar | Estados e atalho em testes puros (ev-5); aparência, foco, contraste e colisão do atalho não verificados |
| 4 | Duas perguntas seguidas | Sem toque; trocas no chat ao sair | `voice-loop` passa (ev-5); mesmo fio por construção (lido) |
| 5 | Voz antes do fim do texto | 1ª frase falada antes do fim | `voice-turns`, `voice-sentences`, `voice-speech-feed` passam (ev-5); tempo e lacunas reais não verificados |
| 6 | Sem markdown lido | Resposta curta, sem símbolos | Texto do prompt testado nos dois idiomas (ev-5); o modelo real seguir o prompt não verificado |
| 7 | Ação longa | Aviso em uma frase, depois resumo | Só o texto do prompt; modelo não verificado |
| 8 | Voz desligada/não instalada | Aviso com caminho para configurações; sem download nem microfone | `voice-gate` passa (ev-5); tela não vista |
| 9 | "Sim" falado não aprova efeito externo | Confirmação por botão | Estrutural (lido); não exercitado no app |
| 10 | Celular com/sem https | Mensagem com o motivo | `voice-mic-support`, `voice-phone` passam (ev-5); aparelho não verificado |
| 11 | Celular bloqueado: "pausado" | Toque retoma | `voice-phone`/`voice-loop` passam (ev-5); aparelho não verificado |
| 12 | Latência | Medir fim da fala → 1ª palavra (meta 3 s, débito não bloqueia) | Conta testada em `voice-latency`; valor real não medido |
| 13 | Cerimônias iguais | Extração sem mudar comportamento | tsc e testes passam; telas não abertas |
| 14 | Textos en/pt-BR | Chaves nos dois catálogos | `i18n:lint`, i18n, ui-i18n, voice-terminology passam (ev-5) |
| 15 | Base da release | Branch sem atraso em relação a origin/release/0.11.0 | Pendente: 11 atrás; conflito só em CHANGELOG.md (resolução: manter o arquivo da branch), a fazer pela ferramenta de conflito do app |

## Conclusão
Nenhuma falha nos comandos exercitados. Pendências: mesclar a base e repetir tsc e testes de voz depois dela; rodada manual com voz instalada (latência, barge-in com eco, lacunas, celular com https, atalho, aparência do modo de voz). Sugestão aberta da revisão: teste do `sayStream` com fala desligada.

## Resultado dos cenários

- Gates: tsc, theme-audit, i18n:lint, public-audit: passou (executado na sandbox) — tsc exit 0; theme-audit exit 0; i18n:lint 6305 chaves nos dois idiomas; public-audit limpo (2004 arquivos).
- Testes de voz, origem, prompt, i18n (critérios 2, 4, 5, 8, 10, 11, 14 na lógica): passou (executado na sandbox) — 154 testes passam em voz, forum-origin, persona-voice-prompt, barge, i18n e ui-i18n.
- Base atualizada com a release aberta: falhou (executado na sandbox) — Branch 10 à frente e 11 atrás de origin/release/0.11.0; mesclagem pela ferramenta do app ainda pendente (conflito só em CHANGELOG.md).
- Fluxo de voz no app, latência, celular (critérios 1, 3, 6, 7, 9, 12): não rodou (lido) — Sem voz instalada nem aparelho pareado; app não aberto. Não verificado.
