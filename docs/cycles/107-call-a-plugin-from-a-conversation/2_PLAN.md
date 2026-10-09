# Como um plugin é chamado de uma conversa

Plano da mudança descrita na especificação da pasta: a chamada de plugin por uma mensagem da conversa, a resposta voltando ali com as fontes, o mesmo texto virando documento quando a conversa é de uma execução, e o telefone pareado podendo permitir o pedido que essa chamada abrir.

## As decisões e o motivo de cada uma

### 1. O comando é uma barra antes do id do plugin

Uma mensagem é chamada de plugin quando, aparada, começa com `/`, o termo até o primeiro espaço tem a forma do id de um plugin (`^[a-z0-9][a-z0-9._-]{0,63}$`, a mesma forma que a declaração aceita para `id`) e depois do espaço há texto não vazio. O nome lido é o `id` — o formato que a issue exemplifica (`/web-search ...`). `@` continua menção de agente, e a mesma mensagem não é lida das duas maneiras. Sem pergunta depois do nome não há chamada: nada no plugin poderia agir sobre um pedido vazio, e a mensagem fica como texto comum da conversa.

- Motivo: o `id` já é identidade estável e está em todo `plugin.json`; não nasce campo novo na declaração, logo nenhuma migração de configuração e nenhum dos três espelhos (`types.ts`, `defaults.ts`, `schema.ts`).
- Motivo da forma sintática: quem decide se a mensagem é comando precisa ser uma função pura, sem ler a pasta de plugins, para que todos os leitores de mensagem decidam igual.

### 2. Uma mensagem se lê de um jeito só, decidido num lugar só

Função nova `conversationCommand(text)` em `src/shared/plugins/calls.ts` (pura, sem disco nem dependências) devolve `{ command, asked }` ou `null`. Quem lê mensagens passa a usá-la:

- `personPost` e `attachmentPost` (`src/main/forum.ts`): mensagem que é comando grava `mentions: []` e não emite a linha de menção desconhecida. Assim o assinante de menções e `onMessage` do runner, que já olham só `message.mentions`, nem despertam — nenhum deles muda.
- `answerPost` (`src/main/runner/service.ts`): devolve `null` para mensagem que é comando, nunca a consome como resposta da pergunta que uma execução espera.
- O assinante novo (item 5) é o único que age sobre o comando, e só quando a mensagem não carrega menção (um tópico de chamada entre agentes carrega `mentions` e fica de fora) e o autor não é o aplicativo.

Motivo: a regra "uma mensagem é uma coisa ou a outra" fica garantida onde a mensagem é gravada, não em cada leitor lembrando de checar.

### 3. O catálogo fixo ganha o quinto acontecimento

`conversation-called` entra em `PLUGIN_EVENTS` (`src/shared/plugins/events.ts`). A leitura da declaração continua a mesma (`isPluginEvent`), então declaração que nomeie um evento fora do catálogo continua recusada e declaração com o evento novo passa a ser aceita. O rótulo do acontecimento para a linha do documento ganha `main.plugins.event.conversationCalled` (`EVENT_LABEL` em `src/shared/plugins/grants.ts`) e o mapa da tela de plugins ganha `ui.plugins.event.conversationCalled` (`src/renderer/src/screens/PluginsSection.tsx`, chaves nos dois catálogos de `ui-settings`).

- Motivo de não subir a versão de contrato para 2: o acréscimo não remove nem muda nada que uma declaração existente declara; um bump recusaria todos os plugins já escritos sem ganho.
- Motivo de não haver migração: o catálogo é código, não é campo de configuração.

### 4. O que o plugin recebe e onde ele roda

`PluginContext` (`src/main/plugins/module.ts`) ganha `thread?` (a conversa onde a chamada foi feita) e `asked?` (o que foi pedido); `runId?` já existe e passa a ser preenchido quando a conversa é de uma execução. Em `callPlugin` (mesmo arquivo) o alvo passa a ser: `runId` presente → `d.target(runId)` como hoje; só `thread` → `d.chatTarget()`; nenhum dos dois → continua a recusa de "sem execução".

- Conversa de execução (`run-<id>` com a execução existente): issue, título, etapa e execução vêm da execução (lida no momento da chamada), o alvo é a pasta da execução — a etapa lê os documentos do ciclo e o texto da resposta também vira documento (`WEB_SEARCH.md` na busca na web).
- Qualquer outra conversa: issue `0` e sem título (o cartão de Ações mostra linha de execução só quando há título, então nada de falso aparece), sem execução, alvo = pasta vazia própria (`chatTarget`, criada uma vez em `<dados do espaço>/sandbox/plugin-call`) com `documents: false` — campo novo e opcional em `PluginTarget` (`src/main/plugins/runtime.ts`) que corta a escrita do documento. Nenhum caminho de escrita novo: em conversa que não é de execução nada é gravado em lugar nenhum.
- Motivo da pasta vazia: fora de uma execução não existe worktree, e a pasta de dados do aplicativo não pode ser entregue a uma sandbox; copiar árvore vazia custa quase nada e o plugin recebe exatamente o que a conversa trouxe.

### 5. A resposta volta por uma linha do aplicativo

Nova dependência injetável `say(thread, code, params)` em `PluginsDeps`, que acrescenta ao fórum uma mensagem `kind: 'system'` de autoria do aplicativo, com código e parâmetros (assim muda de idioma junto com o resto da conversa). Códigos novos: `main.forum.code.plugin.answered` (o texto entre as marcas de material, com o mesmo aviso da resposta de uma menção), `main.forum.code.plugin.waiting`, `main.forum.code.plugin.notCalled` e `main.forum.code.plugin.unknownCommand`; recusa e falha depois que a pessoa responde reutilizam `run.plugin.refused.network`/`run.plugin.refused.write` e `run.plugin.failed`, que já existem. O contrato de resultado que o serviço já usa vira a regra da entrega: `ok: false` com `refused: null` significa que um pedido em Ações foi aberto no lugar da execução (é o que `callPlugin` devolve hoje) → linha de espera.

- Motivo de código e não texto pronto: o texto gravado é a chave e os parâmetros, como todo texto que o aplicativo escreve na conversa.
- Motivo de autoria do aplicativo: a linha nunca re dispara o assinante (ele pula autoria do aplicativo), e é o formato "material, não instrução" que a aceitação pede.

### 6. O pedido em Ações carrega a conversa

`PluginAskUnit` (`src/main/actions.ts`) ganha `thread` e `asked`. Em `ask` (`src/main/plugins/module.ts`): o pedido de chamada de conversa nasce com `holdsRun: false` e `askKey` passa a incluir a conversa — duas conversas esperam com pedidos distintos, e o mesmo pedido repetido na mesma conversa continua sendo um só.

- Motivo de `holdsRun: false`: um pedido aberto por conversa não é um dos quatro momentos do ciclo; a execução não pode parar esperando uma resposta que a pessoa pode dar depois (a conversa recebe a resposta quando o pedido for permitido).
- Motivo da conversa na chave: sem ela, um pedido aberto numa conversa engolia o de outra pela deduplicação.

### 7. Permitir do telefone vale só para a chamada de conversa

- `src/main/webPolicy.ts`: `plugins:answer` sai de `DESKTOP_ONLY` e vira canal normal; comentário atualizado (trocar, ligar e revogar continuam do computador; recusar continua sendo `actions:skip`, já aberto).
- `answerPluginAsk` ganha a origem da chamada (`callOrigin()`, `src/main/rpc.ts`): em chamada de navegador e pedido **sem** `thread` (pedido dos quatro momentos do ciclo) recusa com `main.web.appOnly`. A política é por canal, então quem separa o que o telefone pode é o serviço.
- Cartão de Ações (`src/renderer/src/screens/PluginActionCard.tsx`): em navegador, as respostas uma vez/sessão/sempre aparecem só quando o pedido tem `thread` e chamam `plugins:answer`; nos demais continua só "recusar", por `actions:skip`, com o aviso de hoje.
- Motivo de permitir as quatro respostas (e não só "uma vez"): a pessoa responde a um pedido concreto, e "sempre" grava só a permissão daquele plugin e daquela necessidade, que só o computador retira depois.
- Alternativa descartada: tratar `plugins:answer` como efeito externo (exigir o interruptor do telefone): não corresponde ao decidido ("pode permitir") e enfraqueceria o critério de aceite.

### 8. O contexto que o kit entrega

- JavaScript: `runJsPlugin` (`src/main/plugins/runtime.ts`) passa a montar a entrada com `asked`, `thread` e `runId`, e o arnês (`HARNESS_MJS`) os expõe como `ctx.asked`, `ctx.thread`, `ctx.runId` (nulos nos acontecimentos do ciclo). Tipos documentados em `docs/plugins/kit/coxia-plugin.d.ts` (união de `PluginEvent` + três campos de `PluginContext`).
- Shell: o comando montado passa a ser `set -- '<evento>' '<pergunta>' '<conversa>'` — `$2` e `$3`, vazios nos quatro momentos do ciclo. Motivo: a aceitação diz que a pergunta e a conversa entram no contexto do plugin, e o contexto de um plugin de shell é a lista de argumentos.
- `docs/plugins/README.md` (português e inglês): lista de cinco acontecimentos, como a conversa chama e o que o contexto traz; a linha de `$1` da tabela ganha `$2` e `$3`.

### 9. A busca na web é a primeira a usar a chamada

`plugins/web-search/plugin.json` declara também `conversation-called`; `plugins/web-search/index.mjs` ganha um ramo para `ctx.event === 'conversation-called'`: busca `ctx.asked` (uma pergunta por chamada), monta a seção com as fontes sobre o `WEB_SEARCH.md` anterior (lido da pasta do ciclo; `null` quando a conversa não é de execução) e devolve o documento — é o texto que vai para a conversa e, numa conversa de execução, o que é gravado no arquivo, mantendo o histórico. A nota `offers.agents` ganha uma frase dizendo que também se pode escrever `/web-search <pergunta>` na conversa.

Fora do escopo (como na especificação): nenhum plugin novo, nenhum caminho de escrita novo, os quatro acontecimentos do ciclo intactos (`firePluginEvent` não muda) e o controle de repetição em chamadas entre agentes.

## A ordem

1. Catálogo e comando: `src/shared/plugins/events.ts`, `src/shared/plugins/calls.ts` (novo), `src/shared/plugins/index.ts`, `grants.ts` (rótulo), mapa da tela de plugins + chaves `event.conversationCalled` nos catálogos `main.*` e `ui-settings.*`.
2. Leitura única da mensagem: `src/main/forum.ts` (`personPost`, `attachmentPost`), `src/main/runner/service.ts` (`answerPost`).
3. Alvo e contexto: `src/main/plugins/runtime.ts` (`PluginTarget.documents`, argumentos de shell, entrada de JavaScript, `runJsPlugin`/`runPlugin`).
4. Serviço: `src/main/plugins/module.ts` — campos de contexto, `askKey`, `ask`, `callPlugin` (alvo), função nova `callPluginFromConversation`, entrega (`say`/`deliver`), recusa por origem em `answerPluginAsk`, escuta de recusa (`onActionSkipped`) e o pedido em `PluginAskUnit` em `src/main/actions.ts`.
5. Assinante: `src/main/plugins/conversation.ts` (novo, módulo registrado em `src/main/modules.ts`): fila por conversa, leitura do comando, chamada do serviço e entrega; só mensagem `post`, com `mentions` vazia e autoria diferente do aplicativo.
6. Política e tela: `src/main/webPolicy.ts`, `PluginActionCard.tsx` e os comentários de ambos.
7. Plugin, kit e documentação: `plugins/web-search/*`, `docs/plugins/kit/coxia-plugin.d.ts`, `docs/plugins/README.md`.
8. `CHANGELOG.md`, entrada nova em `## [Unreleased]` sob `### Added`, em inglês.

## Um teste por comportamento

- Reconhecer o comando e nada mais (forma do nome, sem pergunta, `@`, caminho começado por barra, letra maiúscula) — `test/plugins-core.test.ts`.
- Declaração com o evento novo aceita; evento fora do catálogo continua recusado — `test/plugins-core.test.ts` (o caso que varre o catálogo inteiro já passa a cobrir o novo).
- Mensagem de comando da pessoa não grava menção nem linha de menção desconhecida — `test/forum-store.test.ts`.
- Conversendo com um espaço em pergunta da execução, a mensagem de comando não vira a resposta dela — `test/runner-lifecycle.test.ts`.
- Só responde quem está ligado, não recusado, declara o evento, tem entrada e ajuste preenchido; a conversa recebe o motivo quando não — `test/plugins-service.test.ts` (`say` injetado).
- Comando desconhecido: a conversa diz que nenhum plugin atende aquele comando — `test/plugins-service.test.ts`.
- Resposta entregue na mesma conversa, com o texto entre as marcas e autor do aplicativo — `test/plugins-service.test.ts`.
- Conversa de execução: contexto com issue, etapa e execução, alvo da execução (documento gravado) — `test/plugins-service.test.ts` + `test/plugin-runtime.test.ts` (escrita do documento e recusa com `documents: false`).
- Conversa sem execução: pasta vazia, issue `0`, nada escrito — `test/plugins-service.test.ts`.
- Sem rede: pedido abre com `thread`, `asked` e `holdsRun: false`, a conversa mostra a espera, um pedido por conversa — `test/plugins-service.test.ts`.
- Permitido depois: o texto chega à conversa quando o pedido é respondido — `test/plugins-service.test.ts`.
- Recusado (inclusive do telefone, por `actions:skip`): a conversa diz a recusa e nada roda — `test/plugins-service.test.ts`.
- Espaço de teste: recusa aparece na conversa e nada sai — `test/plugins-service.test.ts` (mesma trava falsa de hoje).
- Escrita segui o contrato (vai, é anunciada com prazo, ou pede) numa chamada de conversa — `test/plugins-service.test.ts` junto com os casos já existentes de `test/plugin-write.test.ts`.
- Navegador só pode permitir pedido de conversa; pedido do ciclo continua do computador — `test/plugins-service.test.ts` (origem da chamada) e `test/plugins-web-policy.test.ts` (canal `plugins:answer` aberto; a travessa de canais precisa de atualização).
- Contexto de JavaScript traz pergunta, conversa e execução — `test/plugin-js-sandbox.test.ts`; argumentos de shell — `test/plugin-runtime.test.ts`.
- Resposta em `/web-search` de conversa busca a pergunta e devolve o documento com as fontes, mantendo o arquivo da execução — `test/web-search-plugin.test.ts`.
- Chaves novas nos dois catálogos — `npm run i18n:lint` (+ `test/ui-i18n.test.ts`).

Gate final da etapa de implementação: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs` (nomes neutros, exemplo em `example.com`).

## Riscos e como se contêm

- **A resposta virar outra chamada (laço).** A entrega é linha de autoria do aplicativo, com `mentions` vazias, e o assinante pula autoria do aplicativo e mensagem com menção. Teste: o assinante ignora as duas.
- **Texto comum que começa por barra virar comando.** Forma estrita até o primeiro espaço (um caminho como `/usr/lib ...` tem barra dentro do termo e não casa); pergunta não vazia; e para nome que nenhum plugin tem a conversa responde com uma linha só, sem mexer no resto. Testes: casos de forma em `test/plugins-core.test.ts`.
- **Um pedido de conversa parar o ciclo da execução.** `holdsRun: false` só para pedido com `thread`; teste do sinalizador em `test/plugins-service.test.ts`.
- **O telefone ampliar permissão além do decidido.** A guarda fica no serviço (origem da chamada + `thread`) e a política abre só o canal; teste nos dois arquivos. Trocar, ligar e revogar continuam do computador.
- **Escrita nova fora da porta única.** Nenhum caminho novo: documento continua saindo pela guarda da pasta do ciclo e só quando a conversa é de execução (sinalizador `documents: false` testado); rede e escrita seguem o pedido em Ações de hoje (cardeiro sem mudanças).
- **Pedidos e falhas em conversa sem execução carregarem issue nenhuma.** Issue `0` sem título, o que o cartão já não exibe; testes do serviço cobrem.
- **Resposta demorada sem sinal na conversa.** A chamada usa a mesma sandbox da etapa com árvore vazia (copia rápida); linha de "está respondendo" fica de fora desta mudança por não estar na especificação — se a conferência mostrar espera cega, entra como ajuste.
- **Tela sem teste de componente.** O repositório não tem teste de componente: o que decide (quem pode permitir) está garantido no serviço e na política; a tela é conferida na etapa de verificação.

## Critérios de aceite que este plano não cobre por teste automatizado

Os dez critérios têm cobertura automatizada nos arquivos acima, menos três pontos que ficam para a etapa de verificação, porque o que os une não é exercitado de ponta a ponta por teste: (2) o documento real gravado pela combinação execução + sandbox + busca na web (o teste cobre o alvo entregue e a escrita do documento isoladamente); (5) a permissão em Ações contra uma instância de busca verdadeira (o teste usa a porta falsa de Ações); e (9)/(10) os botões na tela do telefone pareado, sem teste de componente. Também não existe teste que rode o aplicativo inteiro — a confirmação dos critérios é da etapa de verificação e depende de a capacidade nova já estar implementada.

## Não verificado nesta etapa

Nada foi executado: nenhum comando, nenhum teste, nenhum gate e nenhuma execução do aplicativo. Tudo acima foi decidido por leitura do programa e dos documentos da pasta; a capacidade nova ainda não existe para ser vista funcionando.
