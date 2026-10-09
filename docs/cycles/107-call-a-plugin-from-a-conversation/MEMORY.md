# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (enhancement); não é bug, pergunta nem duplicada. Entendido por leitura do código — nada foi executado no produto em nenhuma tentativa desta etapa.
- Sem pergunta ao autor: a issue já diz o que acontece hoje e o que se espera, e não há defeito a reproduzir.
- Três decisões de desenho, uma por rodada, todas respondidas pela pessoa e incorporadas à 1_SPEC.md:
  - Chamada de plugin: `/${comando}` é comando de plugin, `@` continua sendo agente; a mesma mensagem não é lida das duas maneiras.
  - Conversa de execução: a resposta do plugin também vira documento na pasta do ciclo (na busca na web, `WEB_SEARCH.md`).
  - Telefone pareado: além de recusar o pedido ou bloquear a escrita, passa a poder permitir o pedido que a chamada de conversa abrir (resposta: "pode permitir").
- Controle de repetição em chamadas entre agentes: issue separada, fora desta mudança.
- Prioridade proposta (campo do rastreador não alterado): priority:medium — plataforma, chamada externa e busca web já entraram; nenhuma rotina está parada.
- Squad proposto: plataforma — o cerne é o catálogo de eventos, a chamada de plugin e o contrato de permissão no processo principal; a tela é a parte menor.
- Resposta: Com /${comando} é comando e @ é agente, uma melhoria, um agente pode chamar outro agente durante a sua rodada e esperar a resposta dele para continuar algo como o sendMessage marcando o agente em questão e se for necessário esperar a resposta o agente que chamou aguarda até o outro responder para continuar, esse ciclo pode ir se expandindo, um agente chamado pode chamar outro e assim em diante até a resposta ser finalizada, deve ter um controle para evitar loops infinitos, conversas demoradas não significam loop, mas assuntos repetitivos, agente fazerem ações que outros já firerazm durante o c… <!-- answer:27 -->
- Resposta: issue separada <!-- answer:35 -->
- Resposta: sim <!-- answer:43 -->
- Resposta: pode permitir <!-- answer:50 -->

## Restrições

- O catálogo de eventos é fixo e público (`src/shared/plugins/events.ts`): um evento novo muda o kit, que passa a aceitar e a recusar declarações por ele.
- Hoje a chamada de plugin exige `runId` (`src/main/plugins/module.ts:287-288`) e o contexto não carrega conversa; o único chamador em produção é o runner (`src/main/runner/module.ts:283`).
- Permissão: rede e escrita passam pela porta de Ações (`ask`, `module.ts:441`); `plugins:answer` é só do computador e `actions:skip` (recusar pedido ou bloquear escrita) cabe também ao telefone (`src/main/webPolicy.ts` e comentários em `module.ts:653`, `:666`) — a decisão da pessoa abre o permitir à chamada de conversa.
- A resposta na conversa entra cercada como material (`<data>`), mesmo formato da resposta de uma menção (`main.mentions.call.answered`).
- Menção `@` só resolve para agentes da equipe e nenhuma mensagem é lida hoje como comando que começa com barra.
- Motivo de plugin desligado, recusado ou sem ajuste já é calculado, mas no caminho automático não chega à conversa (`src/main/runner/module.ts:281`); o caminho de pedido respondido posta `run.plugin.failed` (`module.ts:510`, `:534`).
- Pasta de teste não libera requisição nem escrita; escrita irreversível é anunciada antes de sair (`module.ts:459-467`, `arm`).

## Tentado e descartado

- Buscas no rastreador por "plugin" (14 issues) e por "conversation" (24 issues): nenhuma duplicata — descartada a hipótese.
- Nenhum teste, gate ou execução do produto; nenhuma tentativa anterior a retomar. Escrita dos documentos por leitura de código e dos documentos da etapa.
- Procedimento `p-c32ccc0a` (revisão 1) guardado na triagem.

## Perguntas abertas

- Nenhuma. As três decisões que a issue deixava em aberto foram respondidas e estão incorporadas à 1_SPEC.md; não há pergunta pendente para o autor nem para a pessoa.

## Onde o trabalho está

- Entregues: `0_TRIAGE.md` (tentativa anterior) e `1_SPEC.md` reescrita nesta tentativa com as três decisões fechadas.
- Próxima etapa: levar a especificação fechada para a etapa seguinte do ciclo; nenhum critério de aceite foi executado porque a capacidade nova ainda não existe.
- Âncoras lidas nesta tentativa: `1_SPEC.md`, `src/main/plugins/module.ts` (`ask`, `answerPluginAsk`, `carryOut`, `arm`, `onActionSkipped`, timer de escrita), `src/main/webPolicy.ts` (`DESKTOP_ONLY`, `EXTERNAL_EFFECT`). Anteriores: `src/shared/plugins/{events,declaration}.ts`, `src/main/runner/module.ts`, `src/main/forum.ts`, `src/main/forum-core.ts`, `src/shared/forum.ts`, `src/shared/runCommands.ts`, `src/shared/i18n/main.en.json`, `plugins/web-search/plugin.json`, e os ciclos 84, 96, 97, 53, 71.
- Passagem support → product-owner: Levar a triagem ao refino do produto: fechar as três decisões de desenho que a issue deixa em aberto (como o plugin é chamado e como isso se distingue de chamar um agente; se a resposta de uma conversa de execução também vai para a pasta do ciclo; o que o telefone pareado pode permitir) e então escrever a especificação. <!-- handoff:14 -->
