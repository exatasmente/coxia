# Conversa direta com um agente e as propostas que ela levanta

Esta passada fechou o que a revisão apontou como bloqueante: os dois defeitos que
perdiam escritas em silêncio no caminho de proposta, a volta do caminho de leitura do
host ao do espaço de trabalho, a tela inteira (o atalho para a conversa de um agente no
fórum, o "sim a todas" do lote em Ações e os interruptores de ferramentas por agente) e
os testes de comportamento que o plano pede. Os gates do repositório passam.

## O que mudou

### O caminho de proposta não perde mais nenhuma escrita

- **Uma escrita planejada em vários comandos é proposta inteira.** `proposeMention`
  (`src/main/mentions/propose.ts`) trocou `proposeVcsAction` (que guardava só
  `commands[0]`) por `proposeVcsCommands` (`src/main/actions.ts:274`), que cria uma
  proposta por comando com a chave sufixada. Num host que põe os rótulos numa chamada e
  tira um por chamada, aprovar a proposta agora tira todos os rótulos ditos, em vez de
  só pôr os novos. `ProposalOutcome` ganhou `count` (quantos comandos a escrita virou),
  e a linha de sistema `runner.mention.proposed` usa esse número.
- **A conversa de uma execução deixou de oferecer só a issue.** `raiseWrites`
  (`src/main/mentions/answer.ts:178`) não tem mais um ramo próprio para a thread de uma
  execução: toda resposta, onde quer que o agente responda, vai pelo mesmo caminho do
  módulo de menções (`deps.propose`). Um agente que responde na thread de uma execução
  propondo comentário, rótulo, estado ou fechamento agora vê cada um esperando em
  Ações, em vez de os descartar em silêncio. As escritas de uma execução registram o
  alvo na issue da execução; as demais, na issue do espaço de trabalho.
- Consequência: `Publisher.proposeIssue` e o ramo `mention-issue` do runner foram
  removidos (eram o caminho particular da issue na execução); os textos de sistema
  `runner.mention.issueProposed|issueRefused|issueCreated|issueNoId` e
  `main.runner.mention.issueSummary` saíram dos dois catálogos, por não terem mais uso.
- **A chave distingue cada proposta.** A chave passou a ser
  `mention:<thread>:<dono>:<agente>:<seq da resposta>:<índice>:<hash do corpo>`. Antes a
  segunda issue da mesma resposta colidia com a primeira e não era proposta; agora duas
  escritas iguais da mesma resposta são propostas distintas, e a mesma resposta
  reenviada não repete o que já espera.

### O caminho de leitura do host voltou a ser o do espaço de trabalho

- `wantsVcsTool` (`src/main/agents.ts:457`) voltou a decidir pelo caminho do espaço de
  trabalho (`vcsReadPolicy().via === 'tool'`), sem olhar o campo `tools` do agente. Um
  agente que nomeia as ferramentas pode desligar uma para si, nunca trocar o caminho de
  leitura do host — que o plano deixa fora desta entrega. As ferramentas **dizíveis por
  agente** continuam valendo para o que o agente usa (arquivos, skills, rastreador,
  CLI, subagentes), via `toolsForAgent`.

### A tela

- **Fórum:** `ForumScreen` (`src/renderer/src/screens/cycle/ForumScreen.tsx`) ganhou um
  bloco "Conversar com um agente" que abre `agent-<id>` de cada agente do time — a
  conversa direta já aparecia na lista (é uma thread `agent`); faltava o atalho.
- **Ações:** `Actions.tsx` agrupa por `unit.batch` e oferece o "sim a todas": um botão
  por lote, com confirmação, que aprova cada proposta do grupo por si (uma após a
  outra, cada escrita com o seu registro de auditoria). O agrupamento saiu para um
  módulo puro, `src/shared/actions/batch.ts` (`batchesOf`), para a tela e o teste lerem
  a mesma regra; uma proposta já feita ou pulada não entra no lote, uma que falhou
  entra (a pessoa a repete).
- **Time:** `TeamSection.tsx` ganhou os interruptores de ferramentas por agente
  (`ToolsFields`): seguir o espaço de trabalho ou definir para este agente, campo a
  campo, inclusive ligando uma ferramenta que o espaço desligou. O rascunho já
  carregava o campo `tools`; faltava mostrá-lo.

### O texto do agente

- O texto de sistema da menção deixou de dizer "You only read: change nothing", que
  contradizia a seção de propostas. Agora diz que o agente não altera arquivo nem ramo
  e que o que precisa de código é uma issue que ele propõe (os dois catálogos).

## O que foi verificado

Rodado nesta árvore de trabalho, com a suíte inteira:

- `npx tsc --noEmit` — limpo.
- `npx vitest run` — 223 arquivos, **3657 testes passando**, exit 0.
- `npm run i18n:lint` — 4074 chaves nos dois idiomas, 0 não traduzidas.
- `node scripts/theme-audit.mjs` — exit 0.
- `node scripts/public-audit.mjs` — 914 arquivos, exit 0.

Testes de comportamento novos, exercitados nesta passada (não só escritos):

- `test/mentions-agent-chat.test.ts` (12): a conversa direta (dono, listagem como
  conversa, idempotência, lugar), a chamada do dono sem `@` e o teto de 3, a resposta
  em ordem com a conversa como contexto, o agente sem confinamento mesmo com as
  ferramentas de arquivo ligadas só para ele; e as propostas: cada operação vira uma
  proposta em Ações, **uma escrita planejada em vários comandos vira uma proposta por
  comando** (o defeito apontado), as chaves distinguem duas iguais e não repetem entre
  respostas, o host sem a operação é dito indisponível e não propõe, a autonomia solta
  só comentário e rótulo (auditados) e faz fechar, estado e abrir issue esperarem, e um
  espaço de trabalho de teste recusa a escrita sem auditoria.
- `test/actions-batch.test.ts` (3): o lote agrupa por `unit.batch`, mantém conversas
  diferentes e o que não tem lote separados, e só segura o que ainda espera.
- `test/agent-team.test.ts`: `toolsForAgent` segue o espaço quando o agente não nomeia
  e sobrepõe campo a campo quando nomeia (inclusive ligando o que o espaço desligou), o
  esquema aceita e descreve o campo, e a migração v12→v13 não levanta `tools` para
  ninguém.
- `test/runner-mention-actions.test.ts`: a issue proposta na thread de uma execução
  agora espera como `mention-write` e a linha de sistema é `runner.mention.proposed`.

## O que não foi verificado

- **Nada foi visto funcionando no aplicativo** em nenhuma das telas novas (o atalho do
  fórum, o "sim a todas" de Ações, os interruptores de ferramentas). Os testes de tela
  não existem neste repositório; o que foi exercitado é a regra pura (`batchesOf`) e a
  compilação dos componentes.
- **A conversa direta no telefone pareado** e a **ausência de memória entre conversas**
  continuam não verificadas. O que se sabe por leitura é que a lista e a leitura do
  fórum já são abertas ao navegador pareado (`src/main/webPolicy.ts:20-25`) e que a
  conversa direta é uma thread comum de id estável (`agent-<id>`); ninguém a abriu no
  navegador.
- O `electron-vite build`, que o CI roda, não foi rodado.
- Nada foi exercitado contra um host de código real: o host dos testes é um falso.

## Arquivos tocados

- Proposta: `src/main/mentions/propose.ts`, `src/main/mentions/answer.ts`,
  `src/main/mentions/module.ts`, `src/main/runner/service.ts`,
  `src/main/runner/publish.ts`.
- Ferramentas por agente: `src/main/agents.ts`.
- Tela: `src/renderer/src/screens/Actions.tsx`,
  `src/renderer/src/screens/cycle/ForumScreen.tsx`,
  `src/renderer/src/screens/team/TeamSection.tsx`, `src/shared/actions/batch.ts` (novo).
- i18n: os oito catálogos (`main`, `ui-cycle`, `ui-docs`, `ui-team`, nos dois idiomas).
- Testes: `test/mentions-agent-chat.test.ts` (novo), `test/actions-batch.test.ts`
  (novo), `test/agent-team.test.ts`, `test/runner-mention-actions.test.ts`.
