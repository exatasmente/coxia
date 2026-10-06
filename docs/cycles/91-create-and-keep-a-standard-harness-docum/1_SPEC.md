# A documentação padrão do projeto, que os agentes do app leem, criada e mantida por eles

## O que se pede

Nas palavras da issue:

> **One standard layout for the documentation the agents of the app read, kept in the repository.** A folder of its own (the name is for refinement), versioned with the code and reviewed like it: what the project is and how it is built, the rules of each domain (each with the evidence it rests on, `file:line`, the tests that guard it, and the commit it was checked against), the procedures an agent follows (skills), and notes per role of the team. A workspace with several repositories gets one per repository.

> **An agent drafts it and the person approves.** From the code and the documentation that already exists, an agent proposes the layout filled in, as a change that goes through the usual path (a branch, a pull request, the person's yes). After a run, the agent that knows what changed proposes the updates the documentation needs, and a rule whose evidence moved is marked as not checked until someone checks it again.

> **Claude Code's documentation stays Claude Code's, and can be imported.** The agents of the app read only the standard layout; `.claude/` and `CLAUDE.md` remain for Claude Code. The app offers to import from them what is a fact about the project (architecture, domain rules, commands) and leaves out what is a rule of a session or of another harness (who pushes, subagent roles, merge procedures), saying what it left out and why.

> **The agents get what fits them.** Each agent reads the project overview and the rules and procedures that concern its stage and the paths it touches, within a budget, rather than every file of every folder.

> **Settings show where the documentation comes from.** Settings › Documentation shows the layout found in each repository, what is stale, and offers to create it when there is none.

## O caso que motivou

Na conversa de uma execução, a pessoa perguntou ao agente desenvolvedor onde estava o pull request. O agente tinha recebido, como documentação, as anotações do Claude Code do espaço de trabalho — entre elas regras que dizem "push, pull request e merge só da sessão principal; um subagente nunca faz push" —, leu-as com comandos e respondeu que abrir o pull request não era trabalho dele e que "nada foi executado", embora tivesse acabado de rodar quatro comandos. Aquelas linhas descrevem as sessões do Claude Code de uma pessoa; no app, quem propõe o push e o pull request é o runner, e a pessoa decide em Ações.

O único caminho que a pessoa teve foi desligar `docs.autoDetect` e esvaziar as listas, o que tirou junto as regras de domínio que o desenvolvedor e o revisor poderiam usar. Uma coisa certa saiu junto com a errada, porque a mesma pasta serve a dois sistemas com regras diferentes.

## Onde as coisas estão hoje

| O quê | Como é hoje | Onde |
|---|---|---|
| Configuração da documentação | `docs` do espaço de trabalho: `autoDetect` (padrão ligado), `claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`, `mcpConfigFiles`, `specsDir`. É do espaço de trabalho inteiro: não há documentação por repositório | `src/shared/config/types.ts:157-169`, padrões em `src/shared/config/defaults.ts:51` |
| O que `autoDetect` acrescenta | `~/.claude/{skills,agents,CLAUDE.md}` da pessoa e, por raiz de projeto e por repositório, `CLAUDE.md`, `.claude/{skills,agents,rules,knowledge-base}` e `.mcp.json` | `resolveDocs`, `src/main/config-resolve.ts:203-238` |
| Onde a pessoa edita isso | Não há seção de documentação em Configurações. `docs` só se edita no passo do assistente inicial (`src/renderer/src/wizard/steps/DocsStep.tsx`), que se reabre por "Abrir o assistente". Um navegador pareado não pode mudar `docs` | `src/main/webPolicy.ts:53` (os canais do assistente e da configuração são negados) |
| Motor do Claude Agent SDK | A chamada de agente não define `settingSources`; pelo padrão do SDK, o próprio Claude Code carrega o `CLAUDE.md` e o `.claude/` da pasta de trabalho e o `~/.claude` da pessoa (conforme a documentação de tipos do SDK; **ainda não confirmado numa execução real**). As pastas de `docs` só passam a ser legíveis (`additionalDirectories`); não entram como contexto | `src/main/agents.ts:414` (o único `settingSources` do código é o do assistente inicial, vazio, em `src/main/wizard.ts:173`) |
| Motor aberto | O `CLAUDE.md` entra inteiro no texto de sistema (teto de 60.000 caracteres), as skills por nome e descrição, os documentos como um índice de nomes (120 arquivos) que o agente lê com `Read`. Com todas as listas vazias, cai para ler `.claude/*` e `CLAUDE.md` subindo a árvore e a pasta pessoal | `src/main/engine/open/context.ts:65`, `:168`; `src/main/engine/open/bridge.ts:49-58` |
| Filtro por agente | A documentação só é filtrada pelos booleanos do papel do modelo (`agents.roles[papel].docs`); nunca por etapa, por caminho ou por agente do time. No caminho do SDK o app não tem orçamento próprio | `src/main/agents.ts` e `config-resolve.ts` |
| De onde parte uma execução | Só de uma issue; a exceção é a execução de release, com assunto e fluxo próprios | `src/shared/cycles/templates/releaseFlow.ts` |
| Como termina uma execução | Escreve no próprio worktree e termina num push e num pull request, cada um esperando o "sim" da pessoa em Ações; o corpo do pull request termina com "Closes #<n>" | `docs/runner.md`, `src/main/runner/publish.ts:655` |
| Se um documento ainda é verdade | Nada grava o commit ou a data contra a qual um documento foi conferido, e nada compara um `arquivo:linha` citado com o que mudou | — |
| Texto que sai para o host | Comentários, revisões e a descrição do pull request são verificados e credenciais são mascaradas; o conteúdo de arquivo versionado não é verificado antes do push | — |

## O que muda para quem usa

Esta seção descreve a entrega inteira. Os pontos marcados **PROPOSTA** são decisões que a pessoa confirma ou muda no gate 1 (ver "Decisões para o gate 1"); o resto já foi decidido pelo mantenedor.

- **Cada repositório passa a ter a sua documentação padrão**, versionada com o código e revisada por pull request: o que o projeto é e como é construído e testado, as regras de cada domínio (com a evidência e os testes que as guardam), os procedimentos que um agente segue e as notas por papel do time. **PROPOSTA (P1)**: ela mora numa pasta `.coxia/` na raiz do repositório, com `README.md` (a visão geral que todo agente lê), `rules/<domínio>.md`, `skills/<nome>.md` e `roles/<papel>.md`; cada arquivo traz um cabeçalho curto com o commit e a data contra os quais foi conferido, os caminhos em que está a evidência e, se quiser, as etapas ou os papéis a que se destina. A pasta é achada por convenção, em cada repositório do espaço de trabalho; não há lista nova para configurar.
- **Os agentes do app leem só essa documentação.** Nada do Claude Code — `CLAUDE.md`, `.claude/`, o `~/.claude` da pessoa — chega ao agente de uma execução, de uma menção ou de uma conversa. **PROPOSTA (P2)**: no motor do SDK, o app deixa de permitir que o Claude Code carregue por conta própria o `CLAUDE.md` e o `.claude/`; no motor aberto, a leitura de volta para `.claude` some; e `autoDetect` deixa de acrescentar `.claude/`. As listas de `docs` continuam existindo como fontes extras que a pessoa acrescenta de propósito.
- **O Claude Code continua com a documentação dele**, que o app não toca. O app oferece **importar** dela o que é fato do projeto (arquitetura, regras de domínio, comandos) e **deixa de fora** o que é regra de uma sessão ou de outro sistema (quem faz push, papéis de subagente, procedimentos de merge), dizendo o que deixou de fora e por quê.
- **Criar a documentação** (**PROPOSTA (P3)**): em Configurações › Documentação, o botão **Criar a documentação** inicia, para um repositório, uma execução própria — sem issue, como a execução de release — com um fluxo curto: o rascunho (um agente que só escreve dentro de `.coxia/`), o gate da pessoa sobre o rascunho, e o push e o pull request, cada um esperando o "sim" em Ações como sempre. O rascunho parte do código e da documentação que já existe, importa do Claude Code o que é fato do projeto e lista, na descrição do pull request, o que deixou de fora e por quê.
- **Mantê-la verdadeira** (**PROPOSTA (P4)**): numa execução comum, a etapa que muda código recebe a lista das regras de `.coxia/` que cobrem os caminhos que ela tocou e as atualiza no mesmo ramo — a mudança de documentação segue no mesmo pull request —, e a etapa de revisão aponta a regra deixada para trás. À parte disso, o app marca como **não conferida** uma regra cujos caminhos de evidência mudaram desde o commit do cabeçalho, mostra isso em Configurações e a entrega assim marcada aos agentes que a leem.
- **Cada agente recebe o que lhe cabe** (**PROPOSTA (P5)**): a visão geral sempre; as regras e skills cujo cabeçalho nomeia a etapa ou o papel dele, ou cuja evidência está nos caminhos que o trabalho toca; dentro de um orçamento por chamada. Uma regra não conferida chega com essa marca.
- **Configurações › Documentação** (**PROPOSTA (P6)**, nova, só no desktop): por repositório, se `.coxia/` existe, quantas regras, skills e papéis tem, quais estão não conferidas, o botão para criar (ou atualizar) e as fontes extras que o assistente inicial edita hoje.
- **Repositório público** (**PROPOSTA (P7)**): antes de o push de uma mudança de documentação ser proposto, os arquivos de `.coxia/` passam pela mesma verificação de um comentário (credenciais mascaradas, caminhos locais reescritos) e o app diz o que mudou. A revisão da pessoa no pull request continua sendo o gate.
- **Um espaço de trabalho que já existe continua funcionando.** Um repositório que ainda não tem `.coxia/` é dito assim em Configurações, com a oferta do rascunho; até lá, o agente trabalha pelo código e pelas fontes extras que a pessoa listou.

## Regras

### Decididas pelo mantenedor

1. **A documentação padrão mora no repositório de cada projeto**, versionada e revisada por pull request; uma por repositório. Um espaço de trabalho com vários repositórios tem uma para cada. Não há cópia nos dados do espaço de trabalho.
2. **Um agente rascunha, a pessoa aprova.** O rascunho nasce do código e da documentação que já existe, e chega pelo caminho de sempre: ramo, pull request e o "sim" da pessoa em Ações. Depois de criada, a documentação é mantida por agentes, com a pessoa aprovando cada mudança. Nenhum agente grava documentação na branch principal nem faz push por conta própria.
3. **O Claude Code é dono do `.claude/` e do `CLAUDE.md`.** Os agentes do app leem só o layout padrão. O app não escreve nada em `.claude/` nem em `CLAUDE.md`; só os lê, para a importação.
4. **A importação separa fato de projeto de regra de sessão.** Entra o que descreve o projeto (arquitetura, regras de domínio, comandos de construir e testar). Fica de fora o que descreve como uma sessão de outro sistema trabalha (quem faz push, papéis de subagente, procedimentos de merge, identidade de commit de uma ferramenta). O que ficou de fora é listado, com o motivo de cada item, na descrição do pull request, para a pessoa poder discordar.
5. **Entra na versão 0.7.0**, a que está aberta.

### Que dependem do gate (propostas)

6. **O layout (P1).** `.coxia/` na raiz de cada repositório. `README.md`: o que o projeto é, como é construído e testado. `rules/<domínio>.md`: a regra, o porquê, a evidência (`arquivo:linha`) e os testes que a guardam. `skills/<nome>.md`: o procedimento que um agente segue. `roles/<papel>.md`: notas por papel do time (desenvolvedor, revisor, QA, produto…). Todo arquivo tem um cabeçalho curto com: o commit e a data contra os quais foi conferido, os caminhos em que está a evidência e, opcionalmente, as etapas e os papéis a que se destina. O nome da pasta é decisão do gate.
7. **O que os agentes leem (P2).** A `.coxia/` do repositório em que trabalham, e nada do Claude Code. Isso vale nos dois motores. As listas de `docs` ficam como fontes extras de propósito; `autoDetect` deixa de acrescentar `.claude/` (e o `~/.claude` da pessoa).
8. **A criação (P3).** Uma execução de documentação por repositório, sem issue, com fluxo próprio e curto: rascunho (o agente só escreve dentro de `.coxia/`), gate da pessoa sobre o rascunho, push e pull request com o "sim" de sempre. Como o pull request não fecha issue nenhuma, a descrição não leva "Closes #<n>".
9. **A manutenção (P4).** Na execução comum, a etapa que muda código atualiza as regras que cobrem os caminhos que tocou, no mesmo ramo; a revisão aponta a regra deixada para trás. À parte, uma regra cujos caminhos de evidência mudaram desde o commit do cabeçalho passa a **não conferida**; ela volta a conferida quando uma mudança aprovada atualiza o cabeçalho.
10. **O que cada agente recebe (P5).** Visão geral sempre; regras e skills pela etapa, pelo papel ou pelos caminhos tocados; um orçamento fixo de caracteres por chamada na primeira versão (o número fica para o plano e aparece em Configurações); uma regra não conferida chega com essa marca e sem que o agente a trate como verdade firme.
11. **A tela (P6).** Configurações › Documentação, só no desktop: um navegador pareado não a abre nem muda nada nela, como acontece com `docs` hoje.
12. **O repositório público (P7).** O conteúdo de `.coxia/` passa pela verificação de texto que já vale para o que sai para o host, antes do push ser proposto; o que mudou é dito à pessoa.

### Que valem em qualquer caso

13. **A escrita continua passando por uma porta só.** O push e o pull request da documentação esperam o "sim" da pessoa em Ações, como os de qualquer execução; num espaço de trabalho de teste a escrita externa é recusada como sempre.
14. **Dados reais não entram na documentação por acidente.** A documentação é versionada num repositório que pode ser público: o rascunho não leva segredo, host, caminho privado nem nome de pessoa; e a pessoa vê o resultado inteiro no pull request antes do merge.
15. **Quando falta documentação, o agente é dito e não bloqueado.** Um repositório sem `.coxia/` não impede nenhuma execução; o agente trabalha do código, e a tela diz que a documentação não existe.
16. **O que já funciona não muda.** As cerimônias e os cinco agentes de sistema ficam como estão; o fluxo de uma execução comum, o gate da spec e o gate do plano também.

## Como isto se relaciona com #85 e #86

- **#85** (a entrada do app começa pelo provedor de modelo e traz skills próprias do Coxia) e **#86** (plugins nativos: skills, artefatos e integrações numa estrutura de plugin) **não estão implementadas** e **não entram aqui**.
- As `skills/` de `.coxia/` são os **procedimentos do próprio projeto**, escritos para os agentes daquele repositório; não são o catálogo de skills do Coxia (#85) nem a estrutura de plugin (#86). Uma das duas pode vir a ler `.coxia/skills/` depois; esta mudança não decide isso nem prepara um formato para isso.
- Esta mudança não cria nenhuma nova lista de skills, nenhum formato de plugin e nenhum caminho para instalar algo de fora.

## Fora do escopo

- **O catálogo de skills do Coxia e a estrutura de plugin** (#85 e #86): ver acima.
- **A configuração de MCP** (`mcpConfigFiles`, `.mcp.json`): fica como está.
- **Escrever `AGENTS.md` ou o formato de outras ferramentas.** Poderia ser uma issue própria depois; aqui o único formato novo é o de `.coxia/`.
- **Mudar as cerimônias dos cinco agentes de sistema** (`turn`, `reply`, `deep`, `teams`, `fix`): elas não passam a ler `.coxia/` por causa desta mudança, e o que elas leem hoje continua como está.
- **Mudar o `.claude/` e o `CLAUDE.md` de um projeto**: o app só os lê, para importar.
- **Documentação fora do repositório do projeto** (nos dados do espaço de trabalho, ou compartilhada entre repositórios).
- **Documentar o app a partir de uma conversa, ou gerar a documentação sem a pessoa aprovar** o pull request.
- **Deixar a documentação conferida por outro meio que não seja a revisão da pessoa**: o app marca "não conferida"; quem confere é a pessoa, pela revisão do pull request.
- **Empacotar o Claude Agent SDK** (`npm run dist`), como sempre.

## Critérios de aceite

1. Num repositório sem `.coxia/`, Configurações › Documentação diz que não há documentação padrão e oferece **Criar a documentação**.
2. **Criar a documentação** inicia uma execução sem issue para aquele repositório; o agente do rascunho só escreve dentro de `.coxia/`, e o rascunho para no gate da pessoa antes de qualquer push.
3. O rascunho tem `README.md`, regras com evidência (`arquivo:linha`) e testes, e o cabeçalho de cada arquivo traz o commit e a data da conferência e os caminhos da evidência.
4. A descrição do pull request do rascunho lista o que a importação deixou de fora do `.claude/` e do `CLAUDE.md` e por quê; ela não termina com "Closes #<n>".
5. O push e o pull request da documentação esperam o "sim" da pessoa em Ações; num espaço de trabalho de teste, são recusados.
6. O agente de uma execução, de uma menção e de uma conversa não recebe nada de `.claude/`, de `CLAUDE.md` nem do `~/.claude` da pessoa, nos dois motores: uma pergunta sobre "quem faz o pull request" não é respondida por uma regra de sessão do Claude Code.
7. Um espaço de trabalho com `docs.autoDetect` ligado não passa a acrescentar `.claude/` às fontes; as listas de `docs` que a pessoa preencheu continuam valendo.
8. Um repositório com `.coxia/` tem a visão geral entregue ao agente que trabalha nele, e as regras e skills cujo cabeçalho nomeia a etapa ou o papel dele (ou cuja evidência está nos caminhos que o trabalho toca) chegam também; as que não se aplicam, não.
9. A documentação entregue numa chamada cabe no orçamento por chamada; o que não coube é dito ao agente, e não cortado em silêncio.
10. Uma regra cujo arquivo citado mudou desde o commit do cabeçalho aparece como **não conferida** em Configurações › Documentação, e chega com essa marca ao agente que a lê.
11. Numa execução comum que muda um arquivo coberto por uma regra, a etapa de código recebe a regra e a atualiza no mesmo ramo; a mudança de documentação segue no mesmo pull request; uma regra deixada para trás é apontada pela revisão.
12. Configurações › Documentação mostra, por repositório: se `.coxia/` existe, quantas regras, skills e papéis, quais estão não conferidas, o botão de criar ou atualizar e as fontes extras; ela existe só no desktop, e um navegador pareado não a abre.
13. Num repositório público, antes do push de uma mudança de `.coxia/` ser proposto, o conteúdo passa pela verificação de texto (credencial mascarada, caminho local reescrito), e a pessoa vê o que mudou.
14. O app não escreve em `.claude/` nem em `CLAUDE.md` de nenhum repositório.
15. Um espaço de trabalho cujo repositório ainda não tem `.coxia/` continua executando; a tela diz que a documentação não existe e oferece o rascunho.
16. As cerimônias, o fluxo comum de uma execução e os gates 1 e 2 continuam como antes.

## Como foi conferido

Nesta etapa o código foi lido; nada foi executado e nada foi visto funcionando no aplicativo. Conferido por leitura, nesta árvore de trabalho:

- **O `docs` do espaço de trabalho e o que `autoDetect` acrescenta**: `src/shared/config/types.ts:157-169`, padrões em `src/shared/config/defaults.ts:51`, `resolveDocs` em `src/main/config-resolve.ts:203-238`.
- **Motor aberto**: o teto de 60.000 caracteres do `CLAUDE.md` (`src/main/engine/open/context.ts:65`), o índice de 120 arquivos (`:168`) e a leitura de `.claude/*` e `CLAUDE.md` subindo a árvore (`src/main/engine/open/bridge.ts:49-58`).
- **Motor do SDK**: `settingSources` só aparece, com valor vazio, no assistente inicial (`src/main/wizard.ts:173`); a chamada de agente não o define (`src/main/agents.ts:414` monta as opções). Que o Claude Code carregue por conta própria o `CLAUDE.md` e o `.claude/` nessa situação vem da documentação de tipos do SDK, **não foi confirmado numa execução real**.
- **Onde `docs` se edita**: só no passo `DocsStep.tsx` do assistente; os canais do assistente e da configuração são negados ao navegador pareado (`src/main/webPolicy.ts:53`).
- **Corpo do pull request** termina com "Closes #<n>" (`src/main/runner/publish.ts:655`); a execução de release é a única que não parte de uma issue (`src/shared/cycles/templates/releaseFlow.ts`).

Não verificado nesta etapa: se algum outro ponto do código lê `.claude/` além de `resolveDocs` e do motor aberto; como o app mostraria a documentação não conferida a um agente do motor do SDK (que hoje só recebe pastas legíveis); se a verificação de texto de comentário pode ser reaproveitada em arquivo versionado como está; e como se compara "o arquivo citado mudou" quando o cabeçalho cita um commit que a história do repositório já não tem. São dúvidas do plano, e ficam como riscos dele.

## Perguntas em aberto

1. **O nome da pasta**: `.coxia/` ou `docs/agents/`. Ver P1 em "Decisões para o gate 1".
2. **O orçamento por chamada**: o número de caracteres da primeira versão. Fica para o plano, com a recomendação de ficar abaixo do teto de 60.000 caracteres que o motor aberto já usa para o `CLAUDE.md`; a pessoa confirma ou muda no gate 2.
3. **O prazo de uma regra "não conferida"**: se a marca só sai com uma mudança aprovada que atualiza o cabeçalho (a recomendação desta especificação), ou se também pode sair por uma ação da pessoa em Configurações sem mudar o arquivo.

## Decisões para o gate 1

Cada ponto abaixo é uma proposta; a pessoa aprova ou muda um a um. A coluna "recomendação" é o que está escrito nesta especificação.

| # | Ponto | Recomendação | Alternativa |
|---|---|---|---|
| P1 | O layout e o nome da pasta | `.coxia/` na raiz de cada repositório, com `README.md`, `rules/<domínio>.md`, `skills/<nome>.md`, `roles/<papel>.md`; cabeçalho curto em cada arquivo (commit e data da conferência, caminhos da evidência, etapas e papéis opcionais); achada por convenção, sem lista nova. | `docs/agents/` no lugar de `.coxia/`: aparece junto da documentação do projeto, mas mistura a do app com a de pessoas e some de quem só olha a raiz. |
| P2 | O que os agentes do app leem | Só a `.coxia/` do repositório em que trabalham, nos dois motores: no SDK o app deixa de permitir que o Claude Code carregue `CLAUDE.md` e `.claude/`; no motor aberto a leitura de volta para `.claude` some; `autoDetect` deixa de acrescentar `.claude/`; as listas de `docs` ficam como fontes extras de propósito; um workspace sem `.coxia/` é avisado em Configurações e recebe a oferta do rascunho. | Continuar lendo `.claude/` até a `.coxia/` existir: o espaço de trabalho de hoje não muda nada, mas o caso que motivou a issue continua acontecendo até lá. |
| P3 | Como se cria | Uma execução de documentação, sem issue, iniciada por **Criar a documentação** em Configurações: rascunho (só escreve em `.coxia/`), gate da pessoa, push e pull request com o "sim" de sempre; a importação do `.claude/` e do `CLAUDE.md` lista na descrição do pull request o que deixou de fora e por quê. | Abrir uma issue antes e rodar o fluxo normal nela: reaproveita tudo o que existe, mas pede uma issue para uma tarefa que não é de produto, e o fluxo comum tem etapas (spec, plano) que não cabem. |
| P4 | Como se mantém verdadeira | Na execução comum, a etapa de código atualiza as regras que cobrem o que tocou, no mesmo ramo (mesmo pull request); a revisão aponta a regra deixada para trás; à parte, o app marca "não conferida" a regra cujos caminhos de evidência mudaram desde o commit do cabeçalho, em Configurações e para os agentes que a leem. | Uma execução de documentação separada depois de cada execução mesclada: o pull request de código fica limpo, mas a documentação nasce atrasada e a pessoa aprova duas vezes. |
| P5 | O que cada agente recebe | A visão geral sempre; as regras e skills cujo cabeçalho nomeia a etapa ou o papel, ou cuja evidência está nos caminhos tocados; um orçamento fixo de caracteres por chamada na primeira versão; regra não conferida chega com a marca. | Tudo, como hoje: mais simples, mas cada chamada paga o custo de tudo e o agente se perde entre o que não lhe diz respeito. |
| P6 | A tela | Configurações › Documentação (nova, só no desktop): por repositório, se `.coxia/` existe, quantas regras, skills e papéis, quais não conferidas, o botão de criar ou atualizar e as fontes extras que o assistente inicial edita hoje. | Deixar as fontes extras só no assistente e fazer a tela apenas informativa: menos a mudar, mas a pessoa continua sem um lugar de Configurações para a documentação. |
| P7 | Repositório público | Antes do push de uma mudança de documentação ser proposto, os arquivos de `.coxia/` passam pela mesma verificação de um comentário (credenciais mascaradas, caminhos locais reescritos) e o app diz o que mudou; a revisão da pessoa no pull request é o gate. | Não verificar e confiar só na revisão da pessoa e na auditoria própria do projeto: nada novo a construir, mas o que a verificação já pega hoje no comentário passaria sem pegar no arquivo. |
| P8 | O que fica de fora | O catálogo de skills e a estrutura de plugin de #85 e #86; a configuração de MCP; escrever `AGENTS.md` ou o formato de outras ferramentas; mudar as cerimônias dos cinco agentes de sistema. | Escrever `AGENTS.md` junto: ajuda quem usa outras ferramentas, mas cria um segundo formato a manter sem que o app o leia. |

Já decididas pelo mantenedor, e que não voltam ao gate: a documentação mora no repositório de cada projeto; o agente rascunha e a pessoa aprova, e depois ela é mantida por agentes com a pessoa aprovando, e uma regra cuja evidência mudou é marcada como não conferida; a documentação do Claude Code continua do Claude Code, com importação do que é fato do projeto; entra na 0.7.0.

## Registro

- 2026-10-06 — **Gate 1 aprovado** pelo mantenedor, com as recomendações de P1 a P8 como estão: `.coxia/` na raiz de cada repositório; os agentes do app leem só `.coxia/`, nos dois motores; a criação por uma execução de documentação sem issue; a manutenção no mesmo ramo e a marca "não conferida"; o filtro por etapa, papel e caminho com orçamento por chamada; a tela nova em Configurações, só no desktop; a verificação de texto antes do push; e o que fica de fora. A marca "não conferida" só sai com uma mudança aprovada que atualiza o cabeçalho.
