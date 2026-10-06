# Memória do ciclo

## Decisões

- Os plugins são código próprio da equipe (não código de terceiro); a plataforma precisa primeiro aceitar plugins e trazer um SDK para desenvolvê-los. Resposta da pessoa: "os plugins devem ser codigo proprio que vamos construir mas primeiro precisa que o sistema aceite plugins e tenha sdk para o desenvolvimento deles" <!-- answer:8 -->
- Tipo da issue: pedido de funcionalidade (plataforma nova). Não é bug, não é pergunta e não há duplicata.
- O contrato de extensão (hooks, eventos e ações) fica declaradamente para o refino e o plano, não para a triagem.
- Refino: a spec funcional está em `docs/cycles/[redacted]/1_SPEC.md`. Ela entrega três partes juntas — aceitar plugins, um kit de desenvolvimento no repositório e uma primeira entrega que prova as três pontas —, com as regras de declaração, fronteira, permissão, escrita externa pela porta única e rede só pela permissão listada. O contrato de extensão em si (mecanismo, formato da declaração, onde o script roda) fica para o plano.
- Primeira entrega decidida pela pessoa: "vamos construir um pugin para os agentes conseguirem fazer busca na WEB" <!-- answer:21 -->. A spec traduz isso em três pontas: um acontecimento que o app já publica, um tipo de documento novo com o resultado da busca e a fonte de onde veio, e uma escrita externa que espera o "sim".
- Escrita externa da primeira entrega: a pessoa aceitou a recomendação ("siga com a recomendação" <!-- answer:25 -->). Fica num destino neutro que o próprio plugin declara; o serviço de verdade é assunto do plugin de busca construído depois, em outra issue.
- A Pergunta 1 do refino anterior foi resolvida por essa resposta; a spec passou a fixar o destino neutro (Regra 7, primeira entrega, fora do escopo, aceitação 7).

## Restrições

- A plataforma é nova: não existe conceito de plugin sob `src/`, nenhum campo no `WorkspaceConfig` (`src/shared/config/types.ts:784-810`) e nenhum barramento de eventos de plugin (`AppEvent`, `src/shared/types.ts:444`, é canal de interface, não ponto de extensão).
- A fronteira de execução já existe e é fechada e é a que qualquer plugin teria de respeitar: sandbox por etapa com política pura de argumentos, sem rede por padrão e sem pasta pessoal (`src/main/sandbox/policy.ts`, `index.ts`); navegador pareado com listas fixas (`src/main/webPolicy.ts:11,21`). A rede de um sandbox só sai por lista (`SANDBOX_NETWORKS`/`RunnerSandbox`, `src/shared/config/types.ts:687-715`; proxy de registro em `src/main/sandbox/proxy.ts:6-9`) — a Regra 14 da spec prende o plugin de busca a isso.
- As integrações exemplificadas hoje entram como código do núcleo: o host de código só cresce por dentro do provedor neutro (`VcsProvider`, `src/main/vcs/types.ts:247-305`), com escritas descritas por `planWrite` e executadas por uma porta única (`src/main/actions.ts`; `VcsCommand` em `src/shared/types.ts:388`, ações em `:406`).
- Registros existentes são fechados (motores em `src/main/engine/registry.ts`; modelos de ciclo em `src/shared/cycles/index.ts`; provedores de código em `src/main/vcs/index.ts`); nenhum é um ponto genérico com manifesto para uma unidade nova entrar.
- A aceitação da issue prende o desenho: instalar sem tocar no núcleo, não alcançar segredo nem dado de outro espaço de trabalho sem permissão explícita, e um tipo de documento novo acrescentável sem tocar no núcleo (o caso de teste da plataforma).
- Já existe uma leitura de web para os agentes de sistema (`WebFetch`, `WebSearch` em `src/main/agents.ts:406-407`), mas ela é ferramenta do agente, não um ponto de extensão: a primeira entrega é o plugin da equipe, não essa ferramenta.
- O repositório é público: nada de nome de terceiro, host real, pessoa, número de issue real ou segredo na spec, no kit, nos exemplos ou nos testes.

## Tentado e descartado

- Nada tentado em código. A verificação foi só leitura (issue, respostas da pessoa, código desta árvore de trabalho, artefatos de ciclos anteriores); nenhum teste, gate ou execução do app.
- Descartado fixar na spec um escopo mínimo com nome de terceiro: as integrações nomeadas na issue não aparecem descritas em nenhum documento do repositório além dela, e a resposta da pessoa não as definiu. Vale igual depois das respostas novas: a primeira entrega tem nome concreto ("busca na WEB para os agentes") e a escrita externa fica num destino neutro, sem serviço nomeado.

## Perguntas abertas

- Quais são "os outros itens" que dependem desta plataforma e o que cada um pede hoje: a issue só diz que existem, as respostas não os nomearam e nada no repositório os define. Sem eles, o contrato nasce mínimo.
- O que este espaço de trabalho considera "permissão explícita" de um plugin ("does not reach secrets or another workspace's data without an explicit permission"): recomendação de partir fechado e tratar toda ampliação como permissão que só o computador concede.

## Onde o trabalho está

- Triagem e refino concluídos em `docs/cycles/[redacted]/`. Próxima etapa: plano técnico, que fixa o contrato de extensão e o mecanismo sem reabrir o que a spec decidiu.
- Passagem do refino ao plano: a spec fixa o comportamento (Regras 1 a 14), o kit e a prova da primeira entrega (o plugin de busca na web, com a escrita externa num destino neutro); o plano decide onde a declaração vive, como é lida e validada, como o catálogo de acontecimentos é publicado, como o tipo de documento novo entra no `SpecLayout`/`GateFiles` sem tocar no núcleo, e como o script roda dentro da fronteira que já existe (sandbox sem rede por padrão e porta única de efeito externo). As perguntas abertas acima são da pessoa, não do plano.
- Passagem support → product-owner: Ler a issue 84 com a resposta da pessoa já registrada e escrever a spec funcional e o plano técnico. Pontos que o refino precisa fechar, sem reabrir o que a resposta já decidiu: (a) os plugins são código próprio da equipe e a plataforma precisa aceitar plugins e vir com um SDK — o desenho da fronteira não é mais sobre código de terceiro; (b) os "outros itens" dependentes não foram nomeados e continuam sem definição no repositório; (c) Prototypes, Clockify e Jira não têm escopo descrito em lugar nenhum além do texto da issue, então o exemplo de primeira entrega precisa de uma referência concreta ou de uma escolha de escopo; (d) o que conta como tipo de artefato novo e o que significa "um plugin não alcança outro espaço de trabalho sem permissão explícita"; (e) o contrato de extensão (hooks, eventos, ações) e onde ele se apoia nos registros fechados que já existem (motores, modelos de ciclo, provedores de código) e na porta única de efeito externo. <!-- handoff:10 -->
