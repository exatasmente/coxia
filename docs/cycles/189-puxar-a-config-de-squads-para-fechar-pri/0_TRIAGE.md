# Chiar a prioridade por squad com base na config de squads do workspace

## Tipo

**Pedido de processo (condução do ciclo)**, na dimensão "condução do ciclo". Não é bug: não descreve um comportamento errado de código do aplicativo, e sim uma ação de análise — puxar a lista de squads com mission, scope e liaison do workspace e reemitir a decisão de prioridade por squad, aplicando o rótulo de tracker pela regra priority-ordering.md. A decisão original saiu da retro de 08/10/2026 tomada sem a config de squads em mãos, o que arrisca alocação por domínio que não casa com o escopo real de cada squad.

## Dá para entender? Como foi conferido

Dá para entender como está escrita. Conferido **por leitura apenas** — nada foi executado. O que a leitura achou e o que a resposta de quem abriu a issue confirmou:

- O modelo de squad existe e traz exatamente os campos que a issue cita: `SquadDef` tem `id`, `name`, `mission`, `scope` (repositórios, rótulos, pastas, e se recebe o que ninguém reivindica), `liaison` e `label` (o rótulo de tracker que o squad põe na issue), em `src/shared/config/types.ts`. A leitura dos squads do config (lista, por id, se o workspace tem squads) está em `src/shared/config/squads.ts`.
- Não há nada de "prioridade" no código do app: a busca por "prioridade"/"priority" em `src/**` não devolveu ocorrência (só o histórico de mudanças do produto menciona prioridade como config de ciclo). Ou seja, a prioridade por squad é uma decisão conduzida pelo ciclo do workspace, não uma funcionalidade do app — este pedido se exerce fora (ou por cima) do código, usando o que o config expõe.
- A config de squads deste espaço de trabalho, dada por quem abriu a issue: **plataforma** (runtime do Coxia: runner, sandbox, motores de agente, provedores de código, config e fronteira de segurança; paths src/main/runner, src/main/sandbox, src/main/engine; liaison tl-plataforma) e **experiência** (o que a pessoa vê e ouve: telas, cerimônias, voz e catálogos de texto; paths src/renderer, src/shared/i18n, sidecar; liaison tl-experiência).
- A regra **priority-ordering.md** vive em `.claude/rules/priority-ordering.md` do checkout do repositório do app, e a ata da retro de 08/10/2026 no arquivo de retro dessa data na pasta de dados do espaço de trabalho — ambos fora do GitHub de propósito (a auditoria pública mantém `.claude/` e a pasta de dados fora dele).

**O que resta não verificado:** o conteúdo da regra e da ata foi dado só como resumo na resposta de quem abriu a issue (os arquivos estão fora do alcance de leitura desta etapa); o config real de squads do workspace também não foi lido por esta etapa, é o resumo da resposta. A busca das regras de prioridade nos documentos do worktree só confirmou o histórico do produto (priority labels, ordenação por prioridade), não a regra em si.

## O que falta

Para entender, nada; para que outra etapa exepute, falta só ler os dois textos nos locais informados (a regra em .claude/rules/priority-ordering.md do checkout do app e a retro de 2026-10-08 na pasta de dados do workspace). Ambos os locais foram dados por quem abriu a issue. A config de squads está no texto da resposta; quem reemitir pode também ler a config que o aplicativo expõe às etapas do ciclo.

## Issues relacionadas

Nenhuma duplicada ou diretamente relacionada encontrada nas pastas de ciclo existentes (busca por prioridade/squad nos documentos de ciclo só trouxe ocorrências de design antigo de squads, não relacionadas à reemissão de prioridade).

## Sugestões (não decisão)

- Prioridade sugerida: `priority:medium` — é uma conferência de qualidade de decisão recente (risca alocação por domínio sem casar com o escopo real), mas não bloqueia código em andamento. A prioridade final é do refinamento do produto.
- A reemissão em si é trabalho de análise conduzido pelo ciclo (provavelmente na etapa de refinamento ou de planejamento), não um ciclo de código tradicional.
- O squad que poderia levar é o **plataforma**, que cuida da fronteira de config do app (onde os squads e seus campos vivem) — mas por ser item de condução, mais do que de código, a alocação é decisão de quem escolhe.
