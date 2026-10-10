# O que entrou no código e o que foi conferido

O plano da pasta foi seguido na ordem que ele dá. Abaixo, o que mudou área por área, os testes de cada comportamento e o que esta etapa de fato rodou.

## Como ficou, área por área

1. **O comando e o catálogo.** Função pura nova `conversationCommand` (`src/shared/plugins/calls.ts`): uma mensagem é chamada de plugin quando, aparada, começa com `/`, o nome até o primeiro espaço tem a forma de um id de plugin e depois dele há pergunta não vazia. Ela devolve o id e a pergunta, ou `null` — `/usr/lib ...`, `/Web-Search ...`, `/@agent ...`, `/web-search` sem pergunta e texto comum não são chamada. O catálogo fixo ganhou `conversation-called` (`events.ts`), com o rótulo do documento (`grants.ts`), o rótulo da tela (`PluginsSection.tsx`) e as chaves novas nos quatro catálogos (dois idiomas, `main.*` e `ui-settings.*`). A leitura da declaração não mudou: declaração com o evento novo é aceita, evento fora do catálogo continua recusado. O contrato de declaração continua na versão 1.

2. **Uma mensagem se lê de um jeito só.** Em `personPost` e `attachmentPost` (`src/main/forum.ts`) a mensagem que é comando grava `mentions: []` e não dispara a linha de nome desconhecido. Em `answerPost` (`src/main/runner/service.ts`) ela nunca vira a resposta da pergunta de uma execução. Assim nem o assinante de menções nem o de mensagens do runner despertam com ela.

3. **O alvo e o contexto do plugin.** `PluginTarget` ganhou `documents?: boolean` e `writePluginDocument` não escreve quando ele é `false` (`runtime.ts`). O script de shell recebe `set -- '<evento>' '<pergunta>' '<conversa>'` (`$2` e `$3` vazios nos quatro acontecimentos do ciclo); a entrada de JavaScript monta `asked`, `thread` e `runId` e o arnês os expõe como `ctx.asked`, `ctx.thread`, `ctx.runId` (nulos nos acontecimentos do ciclo). Os tipos do kit (`docs/plugins/kit/coxia-plugin.d.ts`) e o guia (`docs/plugins/README.md`, português e inglês) mostram os cinco acontecimentos, como a conversa chama e o que o contexto traz.

4. **O serviço** (`src/main/plugins/module.ts`). `PluginContext` ganhou `thread` e `asked`; `PluginsDeps` ganhou `say(thread, code, params)` e `chatTarget()` (a cargo do aplicativo: a linha de autoria do aplicativo na conversa e uma pasta vazia própria `<dados do espaço>/sandbox/plugin-call`, com `documents: false`, para a chamada sem execução). `callPlugin` escolhe o alvo (execução → pasta da execução; só conversa → pasta vazia; nenhum dos dois → a recusa de sempre) e passa a pergunta e a conversa ao runtime. `callPluginFromConversation` (novo) resolve o comando pelo id, diz o motivo quando não roda (desligado, recusado, sem o evento novo, sem entrada, ajuste obrigatório vazio) e entrega o resultado na conversa: resposta como material (`main.forum.code.plugin.answered`), espera quando um pedido em Ações abriu (`plugin.waiting`), motivo quando não rodou (`plugin.notCalled`) e "nenhum plugin atende" para comando desconhecido (`plugin.unknownCommand`). O pedido em Ações (`PluginAskUnit` em `src/main/actions.ts`) ganhou `thread` e `asked`, nasce com `holdsRun: false` quando veio de uma conversa e a chave de deduplicação passa a incluir a conversa. `answerPluginAsk` ganha a origem da chamada (`callOrigin()`, `src/main/rpc.ts`) e recusa (`main.web.appOnly`) um pedido dos acontecimentos do ciclo respondido pelo navegador; a entrega do desfecho (`noteDelivery`) vai para a conversa da chamada ou para a execução, e a recusa ou falha depois que a pessoa responde reutiliza `run.plugin.refused.network`, `run.plugin.refused.write` e `run.plugin.failed`.

   Uma leitura do plano virou regra de código: "abriu pedido em Ações no lugar de rodar" é `ok: false` com `refused: null`, então o ramo de rede devolve `refused: null` nesse caso (antes o motivo vinha como frase de espera, que foi substituída pela linha nova `plugin.waiting`; a chave `main.plugins.waiting.network` ficou sem uso no código e continua nos catálogos).

5. **O assinante** (`src/main/plugins/conversation.ts`, novo, registrado em `src/main/modules.ts`): fila por conversa, e só age sobre mensagem `post` com `mentions` vazia e autor diferente do aplicativo (`pluginCallOf`). A resposta do plugin é linha do aplicativo, sem menção, então o assinante nunca acorda com a própria resposta nem forma laço.

6. **O telefone pareado.** `plugins:answer` saiu de `DESKTOP_ONLY` (`src/main/webPolicy.ts`) e virou canal normal; quem separa o que ele pode é o serviço (origem da chamada + `thread`). O cartão de Ações (`PluginActionCard.tsx`) mostra as quatro respostas, chamando `plugins:answer`, só quando o pedido tem `thread`; nos demais continua só "recusar", por `actions:skip`, com o aviso de hoje. Trocar, ligar e revogar continuam do computador.

7. **A busca na web.** `plugin.json` declara também `conversation-called`; `index.mjs` ganhou o ramo que busca `ctx.asked` (uma pergunta por chamada) e devolve o documento montado sobre o `WEB_SEARCH.md` anterior (lido da pasta do ciclo; `null` sem execução) — é o texto que vai para a conversa e, numa conversa de execução, o que é gravado no arquivo, mantendo o histórico. A nota `offers.agents` ganhou a frase do `/web-search <pergunta>`, e o README do plugin também.

## Os testes, um por comportamento

| Comportamento | Arquivo | Estado |
|---|---|---|
| Reconhecer o comando e nada mais (nome, sem pergunta, `@`, caminho, maiúscula) | `test/plugins-core.test.ts` | verde |
| A mensagem que é comando: só post sem menção, de autor que não é o aplicativo | `test/plugins-core.test.ts` | verde |
| Declaração com o evento nova aceita; evento fora do catálogo recusado | `test/plugins-core.test.ts` | verde |
| Mensagem de comando não grava menção nem linha de nome desconhecido | `test/forum-store.test.ts` | verde |
| A mensagem de comando não responde a pergunta de uma execução | `test/runner-lifecycle.test.ts` | verde |
| Só responde quem está ligado, não recusado, declara o evento e tem ajuste; a conversa recebe o motivo | `test/plugins-service.test.ts` | verde |
| Comando desconhecido responde com uma linha só | `test/plugins-service.test.ts` | verde |
| Resposta na mesma conversa, entre as marcas de material e de autoria do aplicativo | `test/plugins-service.test.ts` (a linha é lida do fórum de um espaço de teste) | verde |
| Conversa de execução: contexto com a execução e alvo da execução | `test/plugins-service.test.ts` | verde |
| Conversa sem execução: pasta vazia, issue 0, nada escrito | `test/plugins-service.test.ts` + `test/plugin-runtime.test.ts` | verde |
| Sem rede: pedido com `thread`, `asked` e `holdsRun: false`, um por conversa, espera na conversa | `test/plugins-service.test.ts` | verde |
| Permitido depois: a resposta chega à conversa | `test/plugins-service.test.ts` | verde |
| Recusado (do computador e do telefone): a conversa diz a recusa e nada roda | `test/plugins-service.test.ts` | verde |
| Espaço de teste: nada é pedido e a conversa mostra a recusa | `test/plugins-service.test.ts` | verde |
| Escrita segue o contrato, com o pedido carregando a chamada | `test/plugins-service.test.ts` (+ `test/plugin-write.test.ts`, já existente) | verde |
| Navegador só permite pedido de conversa; o do ciclo continua do computador | `test/plugins-service.test.ts`, `test/plugins-web-policy.test.ts`, `test/web-server.test.ts` | verde |
| Contexto de JavaScript e argumentos de shell | `test/plugin-js-sandbox.test.ts`, `test/plugin-runtime.test.ts` | verde |
| `/web-search` de conversa busca a pergunta e devolve o documento com as fontes | `test/web-search-plugin.test.ts` | verde |
| Chaves novas nos dois catálogos | `npm run i18n:lint` (+ `test/ui-i18n.test.ts`) | verde |

## O que esta etapa verificou (com o comando)

- `npx tsc --noEmit` — limpo, sem saída.
- `npx vitest run` (suíte inteira: 415 arquivos, 6944 casos) — 6923 verdes, 15 pulados, 6 vermelhos, **todos fora desta mudança**: quatro arquivos do navegador do aplicativo (`@playwright/mcp` não está em `node_modules` deste computador e o navegador não sobe) e quatro casos de resolução de conflito que passam quando o arquivo roda sozinho (22 de 22) e falham sob a suíte cheia com "um passo já está em andamento" — instabilidade de corrida, sem relação com o que mudou. Os arquivos tocados por esta mudança estão verdes nas duas passagens.
- `node scripts/theme-audit.mjs` — saída 0 (55 pares de cor ok; 14 cores literais de arquivos anteriores, sem tela nova nesta mudança).
- `npm run i18n:lint` — 5491 chaves em ambos os idiomas (12 catálogos), 0 achados.
- `node scripts/public-audit.mjs` — 1604 arquivos, nada de empresa ou pessoa; saída 0.

## O que não foi verificado

- **Nenhum critério de aceite foi executado no aplicativo**: nada desta etapa abriu o produto. Os dez critérios são da etapa de verificação.
- Os três pontos que o plano já deixou para a verificação continuam de fora dos testes: o documento real gravado pela combinação execução + sandbox + busca na web; a permissão em Ações contra uma instância de busca verdadeira; e os botões na tela do telefone pareado (o repositório não tem teste de componente — quem decide está garantido no serviço e na política).
- O caminho em que uma recusa chega pelo "pular" da lista de Ações não tem teste próprio: ele usa a mesma função de entrega que a recusa pelo cartão, que está testada.
- Os quatro arquivos vermelhos do navegador do aplicativo não foram analisados além do motivo da falha (dependência ausente neste computador).

## Um achado fora da mudança

Na conversa direta de um agente, a mensagem da pessoa chama o dono da conversa sem `@` (a regra de hoje), então ali um `/<comando>` tanto chama o plugin quanto o agente dono; nas outras conversas a mesma mensagem é uma coisa só. O plano mandou não mexer nesse caminho, então ficou como está; se for para "uma mensagem é uma coisa ou a outra" valer também ali, é decisão nova e assunto de outra questão.
