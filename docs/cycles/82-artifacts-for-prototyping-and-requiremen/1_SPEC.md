# O fluxo passa a produzir requisitos, protótipo e manual do usuário

## O que se pede

A issue pede três coisas, depois de ajustar o escopo, nas palavras dela:

> The plugin platform (#84) already lets a plugin add document types to a run's cycle folder. What remains: (1) a built-in plugin declares the requirements, prototype and user-manual documents; (2) the cycle's phase and gate read them; (3) the user manual comes out of the flow in a predictable place. High-fidelity prototyping stays out.

O terreno é o dos artefatos do ciclo, nas palavras dela:

> The cycle's artifacts grow to cover a prototyping and requirements-engineering flow, including a user manual. New artifact types are added through the plugin platform, so the set can vary without changing the core.

> Today the artifacts live versioned in `docs/cycles/<n>-<slug>/` (`rules/cycle-artifacts.md`) and the app reads their phase and gate through `specLayout`. The new types have to fit that reading model, or the app will not see the card's phase.

Quem abriu a issue confirmou o que sobra depois da base da plataforma:

> Escopo ajustado: a base (tipos de documento declarados por plugin) saiu com #84. Falta declarar os documentos de requisitos, protótipo e manual num plugin embutido e conferir que a fase e o gate os leem.

O aceite pedido, nas palavras dela:

> - A new artifact type for prototyping or requirements is added without touching the core.
> - The app still reads the phase and the gate of a card whose folder carries the new types.
> - The user manual is produced as an artifact of the flow and stays where the person expects to find it.

O que esta etapa decide é justamente o que a issue deixa para o refino:

> Functional specification only; the artifact layout is for refinement and planning. Depends on the plugin platform item.

E o que ela mesma deixa de fora:

> A high-fidelity prototype plugin itself: that is one plugin built on the platform, not part of this item.

Um dado conferido nesta árvore: o arquivo de regras citado pela issue não existe no repositório; o que descreve os artefatos do ciclo está na documentação do projeto.

## O que muda para quem usa

- A pasta da execução ganha três documentos ao longo do fluxo: o de requisitos quando o refinamento termina, o de protótipo quando o plano termina, e o manual do usuário quando a execução fecha, ao lado da nota de lançamento.
- O cartão passa a contar esses documentos na sua fase: uma pasta que só traz um deles deixa de aparecer sem fase e mostra o ponto do fluxo que aquele documento representa; mais adiantado continua significa fase mais avançada.
- Os portões passam a encontrar os documentos novos na lista de artefatos que abrem: o primeiro encontra o de requisitos, o segundo o de protótipo.
- O manual fica no mesmo lugar de sempre dos documentos do fluxo: a pessoa abre uma pasta só e encontra o trabalho inteiro, do início ao fim, com o manual junto.
- Os três tipos vêm com o aplicativo, num plugin que já vem com ele, ligados por padrão — sem passo extra para existirem. Desligar o plugin na lista de plugins tira os tipos da leitura; religar devolve.
- Nada do que o aplicativo já lê muda: sem os documentos novos, tudo se comporta como hoje, e um tipo novo continua sendo uma declaração de plugin, não uma atualização do aplicativo.

## Regras

1. **Três tipos novos, declarados pelo plugin que vem com o aplicativo.** Requisitos (`REQUIREMENTS.md`), protótipo (`PROTOTYPE.md`) e manual do usuário (`USER_MANUAL.md`), na raiz da pasta do ciclo da execução, ao lado dos documentos que o fluxo já escreve. Um quarto tipo, acrescentado por um plugin da equipe, passa a valer do mesmo jeito: os leitores de documentos não ganham um caso por tipo.
2. **Cada documento entra numa etapa do fluxo e é lido pelo portão que vem depois dele.** Requisitos no refinamento, lido pelo primeiro portão; protótipo no plano, lido pelo segundo portão; manual na etapa que fecha a execução, depois do último portão. O que cada documento contém (formato, seções) é do fluxo e de quem escreve; esta etapa fixa só o nome, o lugar, a etapa e a leitura.
3. **A fase do cartão leva os três em conta.** Cada um representa o ponto do fluxo em que entra, e a fase continua sendo a do documento mais avançado presente na pasta, com os três entrando na sua ordem entre os que já contam. Uma pasta sem nenhum deles mostra o que mostra hoje.
4. **Documento colateral não move a fase.** O que um plugin grava como efeito de uma etapa — o resultado de uma busca, por exemplo — continua fora da conta da fase, como hoje: um cartão não pode parecer mais adiantado porque uma busca rodou. Esses documentos continuam podendo aparecer no portão, como já aparecem.
5. **O manual fica onde os documentos de sempre ficam.** A mesma pasta do ciclo da execução, com os demais documentos do fluxo, versionada como eles: é a pasta que a pessoa já abre para ver o resto do trabalho. Um manual fora dela não satisfaz o pedido.
6. **O plugin vem ligado por padrão.** Num espaço de trabalho novo os três tipos existem sem configuração nenhuma, porque o manual precisa sair do fluxo sozinho. Ligar e desligar segue sendo decisão da pessoa na lista de plugins: desligado, os três tipos deixam de ser lidos pela fase e pelos portões.
7. **O fluxo continua sendo da pessoa.** Quais etapas produzem quais dos três é dado do fluxo: aqui fica fixado o do ciclo de agentes (o que os modelos trazem), e quem usa outro ciclo — ou não quiser um dos documentos — edita o fluxo do espaço de trabalho. Uma execução em andamento continua no fluxo com que começou.
8. **O que já funciona não muda.** Pastas antigas, ciclos sem os documentos novos e espaços de trabalho sem plugin ligado continuam como hoje: sem artefato nenhum, o portão responde o mesmo de sempre.

## Fora do escopo

- **Protótipo em alta fidelidade**, dito pela issue: é um plugin construído sobre a plataforma, não este item. O protótipo de aqui é um documento escrito na pasta do ciclo.
- **Formato e conteúdo dos três documentos** (modelo, seções, tamanho): é de cada fluxo; esta etapa fixa nome, lugar, etapa e leitura.
- **Publicar o manual para fora da execução** (sítio de documentação, entrega de versão): aqui ele é artefato do fluxo, na pasta do ciclo.
- **Acrescentar os três aos demais ciclos** (SDD, scrum...): quem quiser acrescenta no fluxo dele.
- **Novas etapas, novos portões e mudanças nas cerimônias.**
- **O mecanismo de leitura** — como a fase encontra os tipos novos, como cada portão escolhe o seu documento, como os rótulos entram nos dois idiomas: é do plano; esta etapa fixa só o comportamento.

## Aceitação

Cada item é o que uma pessoa faz e o que ela vê.

1. Espaço de trabalho novo com o ciclo de agentes, execução que passa pelo refinamento: o documento de requisitos existe na pasta do ciclo ao lado da spec, e o cartão mostra a fase dos requisitos — não "sem fase".
2. A execução passa pelo plano: o documento de protótipo existe na mesma pasta, e a fase do cartão é a do protótipo, mais avançada que a dos requisitos.
3. A execução chega ao fim: o manual do usuário existe na mesma pasta, ao lado da nota de lançamento — todos os documentos daquele trabalho numa pasta só.
4. Cartão cuja pasta traz só um dos três documentos novos, por exemplo só o manual: a fase mostrada é a do ponto do fluxo daquele documento; sem nenhum dos três, é a mesma de hoje.
5. Com a pasta trazendo os documentos novos, eles aparecem na lista de artefatos da tela do portão: o de requisitos na do primeiro portão, o de protótipo na do segundo. Um cartão cuja pasta traz só o documento de requisitos não deixa o primeiro portão sem artefato — hoje ele falharia com uma pasta só de tipos novos.
6. Pasta que traz só um documento colateral (o resultado de uma busca): a fase é exatamente a de hoje — não muda — e o documento continua aparecendo no portão como aparece hoje.
7. Desligar o plugin dos três tipos na lista de plugins: a fase e os portões deixam de ler os tipos, sem reiniciar o aplicativo; religar devolve tudo.
8. Uma etapa que termina sem devolver um dos documentos que ela produz: o aplicativo pede o documento faltante como pede qualquer outro da etapa, uma vez; persistindo, a etapa falha.
9. Um plugin da equipe declara um quarto tipo de documento: os portões e a fase o leem do mesmo jeito, sem nenhuma mudança no aplicativo.
10. Um espaço de trabalho já existente, com pastas sem os documentos novos, abre e mostra as mesmas fases e os mesmos portões de sempre.

## Verificação desta etapa

Nada foi executado nesta etapa (nenhum teste, nenhum aplicativo): todos os pontos abaixo são leitura do código desta árvore, e os critérios de aceite acima seguem a cargo de quem testa.

| Afirmação | Como foi conferida | Situação |
|---|---|---|
| A fase vem só dos arquivos de fase configurados; sem nenhum, é "sem fase" | Leitura de `src/main/cards.ts:28-40` (`specInfo`) e de `SpecLayout` (`src/shared/config/types.ts:261-279`) | Lido, não executado |
| O portão soma documentos declarados por plugin, sempre como artefato do segundo portão | Leitura de `src/main/gate.ts:110-125` e do registro em `src/main/plugins/module.ts:665` | Lido, não executado |
| O portão escolhe a primeira opção do seu número e a tela lista as opções | Leitura de `src/main/gate.ts:175` e `src/renderer/src/screens/Gate.tsx:196-200` | Lido, não executado |
| O único plugin do repositório declara um documento só; nenhum declara requisitos, protótipo ou manual | Leitura de `plugins/web-search/plugin.json` | Lido, não executado |
| Plugin sem escolha registrada fica desligado por padrão | Leitura de `src/main/plugins/read.ts:111` | Lido, não executado |
| Uma declaração sem script é válida e só oferece documentos | Leitura de `src/shared/plugins/declaration.ts:76` e de `:197-203` | Lido, não executado |
| Etapa sem os seus documentos é avisada uma vez e depois falha; o fluxo confere o que lê contra o que produz | Leitura de `src/shared/runs/flowCheck.ts:97-101` e do texto `prompt.sdd.runner.repair.missingArtifacts` | Lido, não executado |
| O arquivo de regras citado pela issue não existe nesta árvore | Busca por `rules/**`: nenhum arquivo; os artefatos descritos em `docs/cycles.md` | Lido, não executado |
| A issue e as relacionadas não têm marco | Consulta do registro das issues 82, 84 e 97 | Registrado nesta etapa |

## Prioridade e marco

- **Prioridade: `priority:low`**, proposta mantida com o rótulo que a issue já traz. Motivo: é capacidade nova de fluxo, sem defeito e sem bloqueio; se alguém estiver esperando o manual no processo, sobe para `priority:medium`.
- **Marco: nenhum.** O registro desta issue e das relacionadas não traz marco, e nada nesta etapa apoia uma proposta de texto.

## Perguntas em aberto

Nenhuma pergunta pausa esta etapa: os pontos que a triagem deixou para o refino — nome e lugar de cada documento, em qual etapa cada um entra e é lido, onde o manual aparece, o estado inicial do plugin e o que move a fase — estão fixados nas Regras 1 a 6. O que não ficou decidido aqui é o mecanismo que entrega a leitura sem mudar os leitores de hoje, inclusive o default do plugin para espaços de trabalho que já existem: é do plano (Fora do escopo, última linha) e nenhuma parte dele exige decisão da pessoa.
