# Autonomia de uma execução, rede aberta na sandbox e a lista de comandos por agente

## Tipo

Pedido de funcionalidade. O rótulo da issue é `enhancement` e não há defeito relatado: a issue pede comportamento novo em três frentes — um bloco de autonomia por workspace e por fluxo, um terceiro valor (`open`) para a rede da sandbox, e uma lista dos comandos que cada agente rodou. Quem abriu já nomeia o endereço do que existe hoje, escreve as palavras que a tela deve mostrar ("Use the workspace's setting") e lista o aceite item por item.

## Dá para entender como está escrita

Dá. É um pedido de comportamento novo, não há defeito a reproduzir, e o que a issue diz do estado atual confere com o código e com a documentação — tudo por leitura; nada foi executado e nada foi exercitado em tela.

O que a issue diz hoje, conferido:

- A rede da sandbox tem exatamente dois valores, `off` e `registry`, e o tipo é a única lista: `SANDBOX_NETWORKS = ['off', 'registry']` (`src/shared/config/types.ts:687-689`), usado pelo esquema da configuração (`src/shared/config/schema.ts:4`). Não existe `open`.
- A sandbox é criada com a rede desligada de propósito: `bwrapArgs` monta `--unshare-net` na mesma lista fixa de `--unshare-user`, `--unshare-ipc`, `--unshare-pid`, `--unshare-uts` e `--unshare-cgroup-try` (`src/main/sandbox/policy.ts:85-87`), e o comentário acima diz que a rede é desligada por escolha, não por omissão.
- Um comando de um agente com `shell: host` espera a pessoa: `askCommand` chama `askNow` (`src/main/runner/service.ts:295-305`), que guarda a pergunta em `commands` e publica na conversa o texto `runner.command.ask` (`src/main/runner/service.ts:305-325`). Sem quem responda, o comando é recusado — o contrato em `src/main/runner/executor.ts:61-65` diz que sem a pergunta "cada comando é recusado".
- O push e o pull request esperam sempre: cada etapa de trabalho de um fluxo de worktree carrega `pushStage: true` (`src/shared/cycles/templates/agentFlow.ts:129`), e o fim dessa etapa só propõe o push (`proposePush`, `src/main/runner/publish.ts:676-680`); o pull request é uma proposta separada com o seu próprio "sim" (`pullRequest`, `src/main/runner/publish.ts:682-703`). A documentação diz o mesmo em duas frases: "o push e o pull request esperam sempre" (`docs/runner.md:9`) e o parágrafo "Push e pull request esperam sempre", que termina em "Nada disso pula o 'sim', em nenhum caso, nem em workspace de teste" (`docs/runner.md:120`). A regra também está escrita como contrato do campo `autonomous`: "Pushing the branch and opening the pull request wait for the person either way" (`src/shared/config/types.ts:536-538`, repetido em `docs/configuration.md:57` e `:205`).
- Cada comando já vira uma linha da conversa da execução, com quem rodou, o número, onde rodou, o resultado e quanto durou: `report()` publica `runner.exec` ou `runner.exec.host` com `via: 'host' | 'sandbox'` (`src/main/runner/executor.ts:238-247`; textos em `src/shared/i18n/main.en.json:1209-1210`), e o resultado sai de `endedAs`, que distingue recusa, estouro de tempo, "não terminou com código" e o código de saída (`src/main/runner/executor.ts:226`; textos `main.runner.exec.*` em `src/shared/i18n/main.en.json:1201-1208`). O que não existe é a lista por agente e por etapa, viva enquanto a execução anda: as mensagens ficam soltas na conversa.
- Um workspace de teste recusa toda escrita externa em um ponto único: `door.refusal()` lê `externalRefusal`, que vem de `externalWriteRefusal` sobre o registro de workspaces (`src/main/runner/door.ts:18`, `src/main/workspace.ts:8-21`), e quem confirma uma proposta passa por `assertExternalWrite` antes de qualquer coisa (`approveAction`, `src/main/actions.ts:481-482`). É onde o aceite "um workspace de teste recusa o push e o pull request mesmo com as duas escolhas ligadas" já se apoia.
- Só o computador eleva o que pode custar: `config:save` é do desktop e o `config:cycle-save` do navegador pareado aceita uma lista fechada de caminhos (`WEB_EDITABLE`, `src/main/configScope.ts:12-26`), nenhum deles de `runner.sandbox`, e a política do navegador marca como "efeito externo" permissões pontuais (`EXTERNAL_EFFECT`, `src/main/webPolicy.ts:21`). A lista do que o navegador pode salvar já tem os campos que esta issue quer acrescentar em outro lugar: `devCycle.stages`, `.flows`, `.comments` e `runner.{enabled,...}` estão em `WEB_EDITABLE`, então o desenho de "desligar pelo celular, ligar só no computador" tem onde morar.
- O esquema da configuração está em **v12** (`CONFIG_SCHEMA_VERSION = 12`, `src/shared/config/types.ts:5`), com um passo por versão em `src/shared/config/migrations.ts`. O aceite "a migração deixa todo workspace existente com tudo desligado e a rede como estava" é um passo novo a partir daí.
- O prompt da etapa só conhece dois valores de rede para a sandbox: `sandbox?: { network: 'off' | 'registry'; ... }` (`src/main/runner/prompt.ts:40`), e o mesmo tipo aparece no caminho de uma menção (`src/main/mentions/call.ts:30`). O aceite "o texto da etapa diz ao agente que ele tem a rede" pede mexer nos dois.

Ressalvas do que a issue afirma e não foi possível conferir por leitura:

- A observação entre parênteses de que "a configuração do resolvedor do sistema costuma ser um link fora de `/etc`" é verdadeira em muitas máquinas, mas não foi verificada aqui. Ela aponta uma dificuldade real: a sandbox monta `/usr` e `/etc` somente leitura e "nada mais do sistema" (`docs/runner.md:101`), e resolver nomes costuma passar por `/etc/resolv.conf` (um link) ou por `/run/systemd/resolve` — e `/run` não existe lá dentro.
- "Hoje uma execução para para a pessoa em vários lugares mesmo com todo agente autônomo" foi conferido só nas três portas que a issue nomeia (a pergunta do comando `host`, os gates e o push com o pull request). Não foi conferido que os gates param a execução — a leitura de `docs/cycles.md` mostra que uma etapa `gate` espera uma decisão da pessoa, mas isso não foi exercitado.
- Nada do comportamento novo foi visto funcionando: não há bloco de autonomia, nem rede `open`, nem lista de comandos.

## O que falta

Nada que só quem abriu possa dizer. A issue traz o comportamento esperado item por item, o aceite, o que fica de fora (a pergunta que chega à pessoa, o pedido de um plugin, um provedor sem orçamento e as etapas de espera continuam esperando; e nada de ajuste por execução no momento de iniciar) e a nota de que a solução fica para o refinamento e o planejamento.

## Issues relacionadas

Nenhuma parece duplicar esta. As que falam do mesmo território:

- **Permissões dos agentes e a sandbox** (`docs/cycles/30-agent-permissions/feat/1_SPEC.md`): fixa o que cada agente pode ler e rodar, o contrato do `shell` (`none | allowlist | sandbox | host`) e o modelo de ameaças da sandbox. Esta issue mexe em duas coisas dessa fronteira: acrescenta um valor à rede da sandbox e cria um caminho para o comando `host` rodar sem a pergunta. Relacionada, não duplicata.
- **A memória do ciclo** (`docs/cycles/52-keep-a-cycle-memory-the-agents-of-a-long`): define o arquivo que toda etapa lê e a etapa que conclui reescreve. O terceiro item desta issue (a lista de comandos) é outro registro do que a execução fez, e o fim da execução teria de postá-lo na conversa; o desenho do registro tem de conviver com este. Relacionada, não duplicata.
- **O runner e a pasta do ciclo** (`docs/cycles/9-the-development-cycle-has-no-runner`): criou a pasta do ciclo, os documentos das etapas e o texto que cada etapa recebe — a estrutura onde o bloco de autonomia do fluxo e a mensagem final da lista teriam de caber. Relacionada, não duplicata.
- **O processo de release** (`docs/cycles/27-release-process/feat/1_SPEC.md`): decide que os cortes e os envios de uma release **sempre** esperam o "sim" da pessoa (`beta`, `stable`, `push-branch`, `push-tag`, a decisão D18), mesmo com o agente autônomo, porque eles rodam o script do repositório como a pessoa e sem sandbox (`docs/runner.md:163`). Esta issue muda a regra do push e do pull request de uma execução de **issue**; se o mesmo interruptor alcançar uma release, ele contradiz D18 sem decidir o que fazer com a fronteira de confiança descrita em `docs/runner.md:165`. Relacionada, e é o conflito que o refinamento precisa resolver.
- **As cerimônias de voz** (`docs/cycles/16-turn-the-retro-s-improvement-proposals-i`): não tem relação com este pedido.

## Onde a regra de hoje vai mudar

A nota da issue pede que a especificação diga onde a regra "o push e o pull request sempre esperam a pessoa" muda. Achados por leitura, sem alterar nada:

- `docs/runner.md:9` (a frase que resume o runner), `docs/runner.md:120` (o parágrafo "Push e pull request esperam sempre") e `docs/runner.md:179` (a linha de `runs:start` entre as chamadas do navegador, que repete que o push e o pull request sempre esperam um "sim").
- `src/shared/config/types.ts:536-538`, no contrato do campo `autonomous`, e a mesma frase em `docs/configuration.md:57` e `docs/configuration.md:205`.
- O contrato do `shell: host` em `docs/runner.md:100`, onde cada comando "espera você permitir antes de começar", e o do `host` pelo celular ("permitir um comando pelo celular exige a mesma chave dos efeitos externos"), que o novo interruptor tem de respeitar em vez de contornar.
- A seção "Não verificado" de `docs/runner.md` (a partir de `:209`), onde a sandbox é descrita como exercitada "sem rede e sem registro de verdade": a rede `open` nasce como um comportamento não exercitado e deve ser dita assim.
- `docs/configuration.md:46` e `:194` (o histórico do esquema, onde um passo v13 entra) e a lista `WEB_EDITABLE` de `src/main/configScope.ts:12-26`, se algum campo novo puder ser mexido de um navegador pareado — o que a issue recusa para ligar.
- `CHANGELOG.md`, em `## [Unreleased]`, quando o trabalho chegar ao fim.

## Sugestão de prioridade

`priority:medium`, como sugestão e não como decisão. É um pedido de funcionalidade grande — três frentes independentes (autonomia em dois lugares, rede da sandbox, lista de comandos), um passo de migração de configuração, telas novas e a mudança de uma regra de segurança do runner — e não conserta nada quebrado; nenhuma entrega dele é urgente por si. A frente da rede, isolada, é a mais barata e é a que destrava testes que hoje não rodam na sandbox (`docs/runner.md:209`), então quem for fatiar o trabalho tem aí um primeiro corte natural. A prioridade de verdade e o marco são da etapa de refinamento do produto.

## Como foi conferido

Leitura da issue, do código citado por ela e da documentação do runner, da configuração, dos ciclos e das permissões dos agentes. Nada foi executado e nenhum comportamento foi exercitado no aplicativo; tudo o que está acima como estado atual é o que o código e os documentos dizem, não o que se viu funcionando, e está marcado assim onde importa.
