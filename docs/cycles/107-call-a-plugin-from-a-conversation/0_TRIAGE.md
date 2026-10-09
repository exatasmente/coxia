# Triagem da atividade

## Tipo

Pedido de funcionalidade (enhancement), não um defeito e nem uma pergunta, e não duplica nenhuma outra issue. Pede que um plugin possa ser chamado de dentro de uma conversa e que a resposta volte para essa mesma conversa, cercada como material e com as fontes. Hoje um plugin só é acionado pelos quatro momentos do ciclo de uma execução, e uma menção ou uma mensagem nunca chega a um deles.

## Dá para entender como está escrita

Dá para entender como está escrita. Não há defeito a reproduzir: é uma capacidade que não existe, então nada foi executado no aplicativo nesta etapa e nenhum teste foi rodado. O que segue foi conferido por leitura do código desta árvore de trabalho.

- **O catálogo de eventos é fixo e tem quatro entradas** — `stage-entered`, `stage-finished`, `gate-decided`, `run-finished` (`src/shared/plugins/events.ts:5`); uma declaração que nomeie uma fora da lista é recusada (`isPluginEvent`, usado em `src/shared/plugins/declaration.ts:191-194`). A frase da issue sobre "os quatro eventos do ciclo" confere.
- **Só o runner chama plugin.** O único chamado em produção de `firePluginEvent` vem do runner (`src/main/runner/module.ts:283`), e o contexto que a chamada recebe tem issue, título da issue, etapa e execução — não tem conversa (`PluginContext`, `src/main/plugins/module.ts:40-46`). Sem `runId`, a chamada não sai: volta com a recusa de "sem execução" (`module.ts:287-288`). É por isso que uma menção ou uma mensagem nunca alcança um plugin hoje.
- **Menção só nomeia agente.** O texto é lido contra os ids dos agentes da equipe (`parseMentions`, `src/shared/forum.ts:198-207`; chamado em `src/main/forum.ts:48`), o que é gravado na mensagem ainda filtra por formato de id de agente (`src/main/forum-core.ts:333`) e um `@nome` que não é agente vira linha de sistema avisando que é desconhecido (`src/main/forum.ts:49-50`). Um plugin não pode ser nomeado hoje.
- **Nenhuma mensagem é lida como comando que começa com barra.** A busca por texto iniciado por `/` em `src/` devolve só checagens de caminho e o rótulo de um watch ("/postmortem ...", `src/shared/i18n/main.en.json:532` e o par pt-BR); o único "comando" ligado a mensagem é o registro do que um agente rodou (`commandOf`, `src/shared/runCommands.ts:36-48`). Não há sintaxe de barra na conversa para reutilizar nem para confundir.
- **A cerca de material já existe.** A resposta de uma menção entra na conversa entre as marcas `<data>` com o aviso de que é material e não instrução (chave `main.mentions.call.answered`, `src/shared/i18n/main.en.json:1112`), que é o formato que a aceitação pede para a resposta do plugin.
- **A permissão é a que a issue quer manter.** A rede e a escrita de um plugin passam pela porta de Ações (`ask`, `src/main/plugins/module.ts:441`), uma escrita irreversível é anunciada antes de ir (mesmo arquivo), e o telefone pareado só recusa um pedido ou bloqueia uma escrita, nunca permite (`src/main/plugins/module.ts:653` e `:666`). A frase da issue confere.
- **Desligado, recusado ou sem ajuste obrigatório.** `firePluginEvent` só chama o que está ligado, tem declaração aceita, observa o evento e tem entrada (`module.ts:272`); ajuste obrigatório vazio devolve o motivo (`module.ts:290-291`). O que falta, e o que a aceitação pede, é esse motivo chegar à conversa: num evento automático ele é descartado ("a plugin that fails is not the run's to know", `src/main/runner/module.ts:281`), enquanto o caminho de pedido respondido já posta `run.plugin.failed` na conversa (`module.ts:510` e `:534`) — há precedente, mas só no caminho de permissão e só na conversa da execução.
- **O documento vai para a pasta do ciclo.** O texto de um plugin vira documento escrito pela pasta do ciclo da execução (`writePluginDocument`, `src/main/plugins/runtime.ts:105`); o `web-search` declara `WEB_SEARCH.md` e observa `stage-finished` (`plugins/web-search/plugin.json`) — coerente com a decisão em aberto sobre a chamada feita dentro de uma conversa de execução.
- **O telefone pareado** foi lido só nesses dois caminhos de recusa e de bloqueio; o resto do que ele faz com pedidos de plugin não foi verificado nesta etapa.

Não verificado, dito como não feito: nenhum gate, nenhum teste e nenhuma execução do aplicativo; a capacidade pedida não existe para ser vista funcionando. Também não foi percorrido o que a tela de configuração de um plugin mostra à pessoa, além do que o código de leitura devolve.

## O que falta

Nada que só quem abriu possa dizer: a issue já declara o que acontece hoje e o que se espera, e não há defeito a reproduzir.

O que continua em aberto é decisão de desenho, e a própria issue lista:

- Como o plugin é chamado — barra, menção ou as duas — e como isso se distingue de chamar um agente.
- Se, quando a conversa é a de uma execução, a resposta também vai para a pasta do ciclo (no web search, `WEB_SEARCH.md`).
- O que o telefone pareado passa a poder permitir, hoje limitado a recusar um pedido ou bloquear uma escrita.

## Issues relacionadas

- **#84 — plataforma de plugins: pontos de extensão para hooks, eventos e ações.** Define a plataforma e o catálogo fixo de eventos que esta issue quer ampliar. Relacionada, não duplicata.
- **#96 — plugins alcançam serviços externos pelo app, com ajustes e segredos guardados.** É o contrato de permissão (rede, ajustes, escritas em Ações) que esta issue manda preservar. Relacionada, não duplicata.
- **#97 — busca na web para os agentes, como o primeiro plugin.** É o primeiro plugin que usaria a chamada de conversa; já entregue. Relacionada, não duplicata.
- **#53 — chamar um agente com `@` onde quer que se escreva.** A questão "como distinguir de chamar um agente" depende dela, porque é ela que leva `@` para fora da thread de execução. Relacionada, não duplicata.
- **#106 — embutir os plugins do repositório no app como plugins próprios.** Mexe em como o plugin chega ao app, não em quando ele é chamado. Relacionada, não duplicata.

Nenhuma duplicata: as buscas no rastreador por "plugin" (14 issues) e por "conversation" (24 issues) foram lidas nesta etapa e nenhuma outra pede chamar um plugin de uma conversa.

## Prioridade sugerida

`priority:medium`. As peças de que esta issue depende já estão prontas e fechadas (a plataforma, a chamada externa e a busca na web), então é o próximo passo natural, sem rotina parada e sem defeito a corrigir; `priority:high` se justificaria com algo bloqueado agora, que a issue não relata, e `priority:low` deixaria a busca na web utilizável só no fim de uma etapa, que é justamente a limitação apontada. A decisão é do refino do produto.
