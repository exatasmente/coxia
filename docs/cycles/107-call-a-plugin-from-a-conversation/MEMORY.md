# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (enhancement); não é bug, pergunta nem duplicada. Entendido por leitura do código — nada foi executado nesta etapa.
- Sem pergunta ao autor: a issue já diz o que acontece hoje e o que se espera, e não há defeito a reproduzir.
- Sem pergunta à pessoa: as três decisões que a própria issue lista são de desenho e ficam para o refino do produto.
- Prioridade sugerida (sugestão, campo não preenchido): priority:medium — plataforma, chamada externa e busca web já entraram; nenhuma rotina está parada.
- Squad proposto: plataforma — o cerne é o catálogo de eventos, a chamada de plugin e o contrato de permissão no processo principal; a tela é a parte menor.

## Restrições

- O catálogo de eventos é fixo e público (`src/shared/plugins/events.ts`): um evento novo muda o kit, que passa a aceitar e a recusar declarações por ele.
- Hoje um plugin só é chamado com `runId`; sem ele a chamada falha com recusa de sem execução (`src/main/plugins/module.ts:287-288`) e o contexto não carrega conversa.
- A permissão não muda: rede e escrita passam pela porta de Ações; o telefone pareado só recusa um pedido ou bloqueia uma escrita, nunca permite.
- A resposta na conversa entra cercada como material (`<data>`), nunca como instrução — mesmo formato da resposta de uma menção (`main.mentions.call.answered`).
- Menção `@` só resolve para agentes da equipe e nenhuma mensagem é lida como comando que começa com barra.
- Motivo de plugin desligado, recusado ou sem ajuste já é calculado, mas num evento automático não chega à conversa (`src/main/runner/module.ts:281`); o caminho de pedido respondido já posta `run.plugin.failed`.

## Tentado e descartado

- Busca no rastreador por "plugin" (14 issues) e por "conversation" (24 issues): lidas as listas, nenhuma pede chamar um plugin de uma conversa — descartada a hipótese de duplicata.
- Nenhum teste, gate ou execução do app; nenhuma tentativa anterior a retomar.
- Guardado o procedimento `p-c32ccc0a` (repositório, revisão 1) com o caminho de uma triagem.

## Perguntas abertas

- Como o plugin é chamado (barra, menção ou as duas) e como se distingue de chamar um agente.
- Se, numa conversa de uma execução, a resposta também vai para a pasta do ciclo (`WEB_SEARCH.md`).
- O que o telefone pareado passa a poder permitir.
Nenhuma pergunta foi feita ainda: autor e pessoa seguem sem pendência.

## Onde o trabalho está

- Entregue: `docs/cycles/[redacted]/0_TRIAGE.md`. A issue e esta memória já estavam na pasta.
- Próxima etapa: refino do produto, para fechar as três decisões acima.
- Âncoras lidas: `src/shared/plugins/{events,declaration}.ts`, `src/main/plugins/module.ts`, `src/main/plugins/runtime.ts`, `src/main/runner/module.ts`, `src/main/forum.ts`, `src/main/forum-core.ts`, `src/shared/forum.ts`, `src/shared/runCommands.ts`, `src/shared/i18n/main.en.json`, `plugins/web-search/plugin.json`, e os ciclos 84, 96, 97, 53, 71.
