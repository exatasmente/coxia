# Plano de testes: sessões do Claude Code da máquina

## Como foi verificado

- Rodado em tentativa anterior desta etapa: os 7 arquivos de teste do recurso (fontes, permissões, serviço, módulo, visão, migração de configuração, tabela da porta da persona): 191 testes, código 0 (ev-2).
- Rodado em tentativa anterior: `electron-vite build`, código 0 (ev-3).
- Lido: a tela chama `follow(null)` na limpeza do efeito, ao fechar a sessão, trocar de sessão ou sair da tela (ev-4).
- Lido (de novo nesta tentativa): `CONFIG_SCHEMA_VERSION = 35` e `v34ToV35` em STEPS, sem mudança de código desde então (ev-8).
- Não rodado: o Claude Code real e o app aberto; `tsc`, suíte completa e auditorias não foram repetidos aqui.
- Esta tentativa não repetiu os cenários 1 a 14: seguem como já registrados.

## Decisão sobre o esquema

A pessoa respondeu primeiro "280 primeiro", depois "2882 vai primeiro" (lido como #282) e por fim "Espera e ajusta a versão do schema". Leitura adotada: esperar a #282 e ajustar esta branch para o esquema 36. O ajuste ainda não foi feito no código; cabe ao desenvolvimento.

## Cenários

| # | Critério | O que fazer / esperar | Resultado | Comprovação |
|---|---|---|---|---|
| 1 | 1: desligado | Padrão `enabled:false`; todo canal recusa, menos ligar. Ligar faz a entrada de menu aparecer. | Passou nos testes do módulo e da visão (fakes) | ev-2 |
| 2 | 2: listar | Transcrições, em execução e em segundo plano aparecem. | Passou só com fonte falsa; real não verificado | ev-2 |
| 3 | 3: ao vivo | Mensagem nova aparece sem recarregar. | Coberto com fake; real não verificado | ev-2 |
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
| 15 | Esquema | Depois da #282, esta branch usa `CONFIG_SCHEMA_VERSION` 36 e `v35ToV36`. | Pendente: o código ainda está em 35 e `v34ToV35` (lido, ev-8). Os testes de migração, a documentação e o CHANGELOG também precisam do ajuste. | ev-8 |

## Não verificado

- Qualquer comportamento contra o Claude Code real (critérios 2 a 6 e 8).
- Tela num app em execução, sem captura visual.
- O esquema da #282 e da release/0.11.0 (só o lado desta branch foi lido).
- Que "espera e ajusta" significa renumerar para 36 (leitura; a pessoa pode ter outra intenção).
- Lacuna conhecida: sem linha de auditoria quando o envio/início falha após entregar o texto ao SDK, ou quando `interrupt` lança.

## Resultado dos cenários

- Esquema: ajuste para 36 depois da #282: falhou (lido) — Lido de novo: CONFIG_SCHEMA_VERSION continua 35 e só existe v34ToV35. O ajuste pedido (36, v35ToV36) ainda não foi aplicado; precisa do desenvolvimento.
- Critérios 1, 7, 9 a 12 com fakes: passou (lido) — 7 arquivos de teste, 191 testes, código 0, rodados em tentativa anterior; não repetidos nesta.
- Build electron-vite: passou (lido) — Código 0, rodado em tentativa anterior; não repetido.
- Sair da tela para o acompanhamento: passou (lido) — Só lido: a limpeza do efeito chama follow(null).
- Critérios 2 a 6 e 8 contra o Claude Code real: não rodou (lido) — Exige o claude real instalado e logado e o app aberto; sem comprovação além dos fakes.
