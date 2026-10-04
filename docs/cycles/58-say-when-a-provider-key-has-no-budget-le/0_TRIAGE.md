# Recusa por orçamento da chave é reportada como "terminou com sucesso"

## Tipo

Bug. O rótulo da issue é `bug` e a descrição relata um comportamento observado: uma execução que devia dizer que a chave do provedor ficou sem orçamento é encerrada como falha genérica, sem apontar a causa.

## Dá para entender

Dá para entender como está escrita. A issue nomeia o texto que o servidor devolveu (`API Error: 403 Key limit exceeded (monthly limit)`, com o prefixo "Failed to authenticate" do SDK), o subtipo relatado (`success`, sem saída estruturada) e o ponto do código onde isso vira a mensagem genérica.

A citação de código confere: em `src/main/agents.ts:546`, quando o resultado do SDK não traz saída estruturada, a falha carrega só o subtipo — `agent ended with ${m.subtype}` — e nunca o texto que o provedor devolveu. O texto do assistente chega a ser repassado à atividade da etapa (`src/main/agents.ts:528`), mas não é anexado à falha.

Não houve reprodução: nada foi executado nesta etapa; o que está acima foi conferido por leitura do código e da issue.

## O que falta

Nada que só quem abriu possa dizer. O relato já traz o texto de erro do provedor, o subtipo que o SDK entrega e as respostas HTTP que devem ser reconhecidas como recusa de orçamento (402; 403 com corpo dizendo limite ou crédito; 429 que não passa).

## State of the four requested behaviors

Conferido por leitura; nenhum foi exercitado em execução.

1. **Guardar o erro do provedor no motor Claude SDK.** Ausente. A falha carrega apenas o subtipo; o texto do assistente é usado para a atividade da etapa, não para a mensagem de erro.
2. **Dizer em palavras simples que o orçamento da chave acabou, nomeando o provedor.** Parcial. No motor aberto, 402, `insufficient_quota` e 429 com cota/crédito/saldo no corpo já são classificados como `quota`, com mensagem que diz que a cota ou o saldo do provedor acabou (`src/main/engine/open/errors.ts:95`; catálogo `main.engine.quota` em `src/shared/i18n/main.en.json:445` e `main.pt-BR.json:445`). O caso exato relatado — **403 com corpo de limite ou crédito** — não entra nessa classificação: cai em `forbidden` (`src/main/engine/open/errors.ts:94`). A mensagem de quota diz "o provedor", mas não nomeia qual. No motor Claude SDK não há classificação de recusa de orçamento.
3. **Não gastar tentativas.** Ausente. O cliente do motor aberto só repete erros marcados como retentáveis (429, 5xx e timeouts) e a recusa de cota não é retentável (`src/main/engine/open/errors.ts:95-98`; `src/main/engine/open/client.ts:251,266`). O runner não tem espera por provedor: a falha da etapa vira execução `failed` com nova tentativa manual (`src/main/runner/service.ts:413`; `docs/runner.md:51`), e não há código de `StageError` para orçamento (`src/main/runner/executor.ts:30`). As esperas do runner hoje são por evento do host (pull request mergeado, resposta, rótulo, tempo), não por provedor (`src/main/runner/module.ts:157-159`; `src/shared/runs/transitions.ts:89-93`).
4. **O mesmo no motor aberto.** Parcial: já reconhece 402, `insufficient_quota` e 429 com cota, mas não o 403 com corpo de limite/crédito, não nomeia o provedor e não segura a execução.

Mascaramento: existe um passo de redação de segredos aplicado às entradas do registro de erros (`src/main/errorlog-core.ts:15-24`). Se ele já é aplicado ao texto de erro do motor, isso não foi conferido nesta etapa.

## Issues relacionadas

Nenhuma. Não foram encontradas issues que peçam o mesmo comportamento; o mesmo texto de erro relatado aparece só no registro da própria issue.

## Cobertura de teste hoje

Há um teste de dica de erro que já cobre 401 e 402 como "chave ou saldo" (`test/errorlog.test.ts:150-151`), mas nenhum teste cobre o texto relatado (`403 Key limit exceeded (monthly limit)`) nem a espera por orçamento. A cobertura do cliente do motor aberto para 402/403 não foi lida nesta etapa.

## Squad proposto

`plataforma`. O comportamento pedido vive nos motores de agente, na camada de provedores e no escalonador do runner — as pastas `src/main/engine`, `src/main/runner` e `src/shared/runs`, que são o escopo desse squad. Nenhuma tela nova é necessária para o comportamento descrito.
