# Plano de testes: sessões do Claude Code da máquina

## Como foi verificado

- Rodado nesta etapa: os 7 arquivos de teste do recurso (fontes, permissões, serviço, módulo, visão, migração de configuração, tabela da porta da persona): 191 testes, código 0 (ev-2).
- Rodado nesta etapa: `electron-vite build`, código 0 (ev-3).
- Lido: a tela chama `follow(null)` na limpeza do efeito, ao fechar a sessão, trocar de sessão ou sair da tela (ev-4).
- Não rodado: o Claude Code real e o app aberto; `tsc`, suíte completa e auditorias não foram repetidos aqui (resultados vêm da implementação, não verificados nesta etapa).

## Cenários

| # | Critério | O que fazer / esperar | Resultado | Comprovação |
|---|---|---|---|---|
| 1 | 1: desligado | Padrão `enabled:false`; todo canal recusa, menos ligar. Ligar faz a entrada de menu aparecer. | Passou nos testes do módulo e da visão (fakes) | ev-2 |
| 2 | 2: listar | Transcrições, em execução e em segundo plano aparecem. | Passou só com fonte falsa; real não verificado | ev-2 |
| 3 | 3: ao vivo | Mensagem nova aparece sem recarregar. | Acompanhamento coberto por teste com fake; real não verificado | ev-2 |
| 4 | 4: enviar | Resposta corre ao vivo. | Coberto com fake; real não verificado | ev-2 |
| 5 | 5: cópia | Sessão presa por outro processo usa bifurcação e a tela indica. | Coberto com fake; real não verificado | ev-2 |
| 6 | 6: permissão | Pendente; negar segue sem a ferramenta; permitir roda. | Coberto com fake; real não verificado | ev-2 |
| 7 | 7: persona e agentes | Resposta recusada fora da janela; canais em EXCLUDED. | Passou | ev-2 |
| 8 | 8: parar/encerrar | Parar interrompe; encerrar só do que o app iniciou. | Coberto com fake; real não verificado | ev-2 |
| 9 | 9: auditoria | Uma linha por mensagem, permissão, parada e início, sem o texto. | Passou | ev-2 |
| 10 | 10: celular | Todo canal recusa, inclusive um inventado; eventos só pela janela. | Passou | ev-2 |
| 11 | 11: test:true | Enviar e iniciar recusados antes do SDK. | Passou | ev-2 |
| 12 | 12: segredo | Segredo em transcrição sai oculto. | Passou | ev-2 |
| 13 | Sair da tela | Fechar a sessão para o acompanhamento. | Só lido no código | ev-4 |
| 14 | Build | electron-vite build. | Passou | ev-3 |

## Não verificado

- Qualquer comportamento contra o Claude Code real (critérios 2 a 6 e 8).
- Tela num app em execução, sem captura visual.
- Lacuna conhecida: sem linha de auditoria quando o envio/início falha após entregar o texto ao SDK, ou quando `interrupt` lança.

## Resultado dos cenários

- Testes do recurso (critérios 1, 7, 9 a 12 com fakes): passou (executado na sandbox) — 7 arquivos, 191 testes passaram, código 0.
- Build electron-vite: passou (executado na sandbox) — Build terminou com código 0.
- Sair da tela encerra o acompanhamento: passou (lido) — Só lido: a limpeza do efeito chama follow(null).
- Critérios 2 a 6 e 8 contra o Claude Code real: não rodou (lido) — Sem comprovação: exigiria o claude real instalado e logado e a tela do app aberta; só há cobertura com fakes (ev-2).
