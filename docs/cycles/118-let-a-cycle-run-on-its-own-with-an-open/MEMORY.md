# Memória do ciclo

## Decisões

- A issue é **pedido de funcionalidade** (`enhancement`); nada a duplica e nada foi perguntado na issue. O refinamento escreveu `1_SPEC.md` (comportamento nas palavras do produto, dez critérios de aceite); o planejamento escreveu `2_PLAN.md` (desenho da solução). Nada foi executado: nenhum teste, nenhum comando, nenhum comportamento novo visto funcionando.
- **Bloco de autonomia, cinco campos desligados**, em dois lugares: `runner.autonomy` (espaço de trabalho) e um mapa `devCycle.autonomy` por fluxo (chave `''` para o principal, o id do squad, `release` para o de release), com `useWorkspace` ligado por padrão. Os quatro de baixo (`hostCommands`, `gates`, `push`, `pullRequest`) só valem com `cycle` ligado.
- **Resolvedor puro novo** `src/shared/config/autonomy.ts`: `autonomyOf(config, flowKey)` devolve os cinco valores efetivos, a origem (`workspace`/`flow`) e o fluxo; `choiceOn` só é `true` com `cycle` ligado. A precedência: fluxo com `useWorkspace` desligado decide; senão o espaço de trabalho.
- **A decisão é lida no início de cada passo**: a etapa guarda `cycleAutonomous || autonomous` na `StageRecord.autonomous` ao ser alcançada (mantém "vale a partir da próxima, nunca a meio"); o gate usa `gateApprove` sozinho com `by: 'app'` e o motivo com a origem; o comando `host` pula `askCommand` e registra a linha da autonomia; o push e o pull request usam o caminho autônomo da porta, auditado. Uma execução de release (`run.subject`) nunca consulta o bloco para push/pull request: `beta`, `stable`, `push-branch`, `push-tag` continuam sempre esperando (recomendação; decisão da pessoa).
- **Migração v13** (`CONFIG_SCHEMA_VERSION` 12 → 13, passo `v12ToV13`): cria `runner.autonomy` desligado e `devCycle.autonomy: {}`; **nunca toca na rede**; idempotente.
- **Rede `open`**: `SANDBOX_NETWORKS` ganha `open`; `bwrapArgs` não põe `--unshare-net` em `open` (os outros unshares ficam); `sandboxEnv` sem variáveis de proxy; o resolvedor real do sistema (o alvo de `/etc/resolv.conf`, que pode ser um link, e o que ele precisar de `/run`) entra montado somente leitura, sem abrir o resto. `probe.ts` continua com `network: 'off'`.
- **Lista de comandos**: módulo puro `groupCommands` e `CommandsSection.tsx` (novos) montam a seção por agente e etapa a partir das mensagens `runner.exec`/`runner.exec.host` da conversa (ao vivo pelo renderer); o fim (`done`/`cancelled`/`failed`) posta **uma** mensagem `runner.commands.list`, num único ponto do `service.ts`. Nunca vai ao host.
- **Navegador pareado só desce**: `runner.autonomy` fora de `WEB_EDITABLE`; o bloco do fluxo editável com uma checagem `raisedAutonomy` (só `false → true` e `useWorkspace true → false` recusados); `runner.sandbox` continua fora, então `open` é impossível pelo celular.
- **Onde a regra de hoje muda**: `docs/runner.md:9`, `:100`, `:120`, `:179` e a seção "Não verificado"; `src/shared/config/types.ts:536-538` (contrato do `autonomous`); `docs/configuration.md:57`, `:205`, `:42`, `:190`, `:118`, `:266` e o histórico (v13); `CHANGELOG.md` em `## [Unreleased]`.

## Restrições

- A migração **nunca eleva**: todo espaço de trabalho existente fica com os cinco campos desligados e a rede como estava. Um espaço de trabalho de teste continua recusando toda escrita externa; a elevação continua só no computador.
- Os três arquivos `types.ts`, `defaults.ts` e `schema.ts` andam juntos (o `config-schema.test.ts` falha se divergirem); toda string nova vai ao catálogo nos dois idiomas (`i18n:lint`); o repositório é público (`public-audit`); nenhum teste alcança modelo, host ou rede de verdade.
- A rede `open` é a rede do computador inteira, sem filtro: é escolha de risco da pessoa e o padrão continua fechado. Onde não há sandbox (macOS, Windows, Linux sem bubblewrap), nada muda.
- A montagem do resolvedor e a porta autônoma do push dependem da máquina e ficam para a implementação confirmar.

## Tentado e descartado

- Guardar o bloco do fluxo dentro das listas `devCycle.stages` / `devCycle.flows[squad]`: descartado, listas não guardam um objeto de bloco; o desenho usa o mapa irmão `devCycle.autonomy`.
- Criar um campo novo no run para a lista de comandos: descartado, a spec diz que ela é feita do que a execução já registra (a conversa e o `SandboxSession.log`).
- Fazer a escolha de push/pull request alcançar uma release: descartado (contradiz D18); fica como decisão da pessoa, com a recomendação de manter a release fora.
- Ligar pelo celular qualquer campo ou a rede `open`: descartado pela spec; o desenho só permite descer.

## Perguntas abertas

- **Da pessoa** (não bloqueiam o plano, que segue a recomendação de cada uma): (1) o push e o pull request de uma execução de release ficam fora das duas escolhas; (2) o que a tela mostra quando um comando `host` roda sem a pergunta (recomendação: uma linha dizendo que rodou neste computador sob a autonomia do ciclo); (3) em que tela fica o bloco do fluxo (recomendação: Time e ciclo); (4) a rede `open` como padrão de instalação nova (recomendação: continuar desligada).
- **Da implementação**: o caminho real do resolvedor de nomes na máquina; a forma exata da porta autônoma do push; se a seção "Comandos" lê só a conversa ou também o log da sessão viva.

## Onde o trabalho está

Planejamento concluído. `2_PLAN.md` escrito na pasta do ciclo com o desenho das quatro frentes, a migração v13, os pontos de código, os textos de documentação que mudam, a política do navegador pareado e os testes de cada critério de aceite. `0_ISSUE.md`, `0_TRIAGE.md`, `1_SPEC.md` e `MEMORY.md` como estavam. Nenhum código foi tocado e nada foi executado. A próxima etapa é a implementação.
- Passagem support → product-owner: A triagem não achou nada faltando que só quem abriu possa dizer, então a etapa seguinte é o refinamento do produto (product-owner), que deve escrever a spec funcional nas palavras do produto e propor prioridade e marco. O que ele precisa decidir, a partir desta triagem e do código: (1) onde fica o bloco de autonomia em cada um dos dois lugares e o que exatamente cada uma das quatro escolhas muda; (2) se o interruptor de push e pull request alcança uma execução de release, porque a decisão D18 do processo de release manda os cortes e os envios (`beta`, `stable`, `push-branch`, `push-tag`) esper… <!-- handoff:6 -->
- Passagem product-owner → pessoa: A especificação funcional está em `1_SPEC.md`. A próxima etapa (planejamento) deve desenhar a solução, partindo do comportamento descrito: (1) onde o bloco de autonomia mora na configuração (o do espaço de trabalho e o de cada fluxo, com o interruptor "Usar a configuração do espaço de trabalho" ligado por padrão), como a decisão é lida no momento de cada etapa/gate/comando/push/pull request e como a execução de release é deixada de fora; (2) o terceiro valor `open` da rede da sandbox: como a montagem compartilha a rede e resolve nomes sem abrir o resto do sistema (a configuração do resolvedor … <!-- handoff:11 -->
