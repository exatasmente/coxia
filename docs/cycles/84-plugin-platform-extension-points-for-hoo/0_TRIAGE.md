# Plataforma de plugins: pontos de extensão para hooks, eventos e ações

## Tipo

Pedido de funcionalidade (plataforma nova). Não é bug, não é pergunta e não duplica outra issue: pede que tudo o que for novo no Coxia passe a entrar por plugins — hooks, eventos e ações — em vez de código no núcleo, com uma primeira entrega que instale sem tocar no núcleo. A própria issue diz que o contrato de extensão fica para o refino e o plano.

## Dá para entender como está escrita

Dá. É um pedido de capacidade nova, não há defeito a reproduzir, e o que a issue afirma do estado atual foi conferido por leitura nesta árvore de trabalho:

- `grep -i plugin` sob `src/` não devolve nenhum arquivo (a busca mais ampla também não encontra conceito de plugin; só aparece o plugin de build `@vitejs/plugin-react` em `package.json` e na configuração do empacotador, que não tem relação).
- O contrato da configuração (`WorkspaceConfig`, `src/shared/config/types.ts:784-810`) não tem campo de plugin, de extensão nem de ponto de extensão; as chaves do documento são as seções conhecidas (`llm`, `projects`, `vcs`, `docs`, `devCycle`, `agents`, `squads`, `voice`, `claudeSdk`, `externalTools`, `runner`, entre outras).
- As integrações que a issue chama de exemplos são hoje código do núcleo e não um ponto de extensão: o host de código só cresce por dentro do provedor neutro (`VcsProvider`, `src/main/vcs/types.ts:247-305`), com as escritas descritas por `planWrite` e executadas por uma porta única (`src/main/actions.ts`; `VcsCommand` em `src/shared/types.ts:388`, os tipos de ação em `src/shared/types.ts:406`).
- Não há barramento de eventos de plugin: os acontecimentos do app não têm uma lista pública de assinatura; a mais próxima é `AppEvent` (`src/shared/types.ts:444`), que é o canal de interface entre a janela e o navegador, não um ponto de extensão.
- A fronteira de execução que um plugin teria de respeitar já existe e é fechada: a sandbox é montada por etapa a partir de uma política pura de argumentos, sem rede por padrão, sem pasta pessoal e sem ambiente herdado (`src/main/sandbox/policy.ts`; `SandboxService.open`, `src/main/sandbox/index.ts`); o navegador pareado tem listas fixas do que nega e do que trata como efeito externo (`src/main/webPolicy.ts:11,21`).

Ressalvas de leitura, para o refino conferir o resto:

- O `types.ts` citado pela issue é um arquivo de cerca de 800 linhas; foi lido inteiro e a ausência de campo de plugin vale para ele. A busca por `plugin` cobriu `src/` e uma passagem mais ampla pelo repositório; nenhuma delas encontrou um conceito de plugin de aplicação.
- O que a issue chama de "Prototypes, [uma integração nomeada], Jira" não foi encontrado descrito em nenhum documento do repositório: só aparece no próprio texto da issue. Não foi possível confirmar que escopo cada um deles tem hoje.
- O código tem registros fechados (motores em `src/main/engine/registry.ts`, modelos de ciclo em `src/shared/cycles/index.ts`, provedores de código montados em tempo de execução em `src/main/vcs/index.ts`), mas nenhum deles é um ponto genérico para uma unidade de terceiro entrar com manifesto.
- "Artifact type" não corresponde a um conceito nomeado do código. O mais próximo é o conjunto de documentos que uma etapa de trabalho produz na pasta do ciclo e o que os gates leem (`SpecLayout`, `src/shared/config/types.ts:252-270`; `GateFiles`, `:244`), além do catálogo fechado de cerimônias (`CEREMONY_IDS`, `:172`) e dos artefatos de uma execução (`Run.artifacts`, `docs/runner.md`). Nada disso foi alterado nem exercitado nesta etapa.

Verificação: leitura da issue, do código desta árvore de trabalho e de documentos do ciclo. Nada foi executado no aplicativo, nenhum teste nem gate foi rodado, e a plataforma pedida não existe para ser vista funcionando. Isso é leitura, não reprodução.

## O que falta

A resposta da pessoa esclareceu o ponto que decidia o desenho: os plugins são código próprio da equipe, e a plataforma precisa aceitar plugins e vir com um SDK para desenvolvê-los. O plugin como código de terceiro fica fora, por decisão de quem abriu.

O que a issue ainda não fixa e fica para o refino:

- Quais são "os outros itens" que dependem desta plataforma e o que cada um pede hoje, para a plataforma nascer com o alvo certo. A issue só diz que eles existem, e a resposta não os nomeou.
- O que os Prototypes, o [uma integração nomeada] e o Jira fazem hoje e onde vivem; sem isso, o exemplo de primeira entrega ("um artefato novo mais uma integração externa") fica sem referência concreta. Não foram encontrados descritos em nenhum lugar do repositório além da issue.
- O que conta como um tipo de artefato novo para a aceitação que diz que ele deve ser acrescentável sem tocar no núcleo, e o que significa, na prática, "um plugin não alcança outro espaço de trabalho sem permissão explícita".

Nada disso bloqueia a leitura da issue; o contrato de extensão é declaradamente assunto do refino e do plano.

## Issues relacionadas

Nenhuma issue parece duplicar esta. O que foi lido descreve o mesmo terreno, sem pedir a mesma coisa:

- Issue do ciclo de desenvolvimento e do runner: define a execução por issue, com pasta de ciclo e artefatos próprios, e é uma das peças que a plataforma teria de estender.
- Issue do processo de release: define um fluxo por tipo de execução e ações próprias da porta das Ações, ou seja, mais uma extensão que hoje entra como código do núcleo.
- Issue das permissões por agente: fixa a sandbox, a leitura do host e a fronteira de execução que qualquer código de plugin teria de respeitar, com o modelo de ameaças e o que é só promessa.
- Issue das melhorias da retro virarem tarefa (`docs/cycles/16-...`): acrescenta um tipo de trabalho novo ao ciclo, o que é o mesmo problema de "tipo novo sem tocar no núcleo".
- Issue da memória do ciclo (`docs/cycles/52-...`), a das menções em qualquer lugar (`53`), a do orçamento da chave (`58`) e a do lugar que mostra que o agente está trabalhando (`29`): são capacidades que a issue cita como "os outros itens"; nenhuma delas pede uma plataforma de plugins.
- Nada nos documentos do repositório descreve um plano, um protótipo ou uma decisão de arquitetura de plugins; a única menção é o texto desta issue.
