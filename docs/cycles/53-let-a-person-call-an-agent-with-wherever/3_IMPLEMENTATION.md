# Uma regra só: o `@` chama um agente onde a pessoa escreve

## O que foi implementado

O `@agente` deixou de ser um recurso da thread de uma execução e passou a valer em todo lugar onde a pessoa escreve para o aplicativo. O núcleo da resposta vive em `src/main/mentions/`, compartilhado por três donos: o runner (a thread de uma execução, com o comportamento de antes preservado), um módulo novo (os demais threads do fórum) e as cerimônias (que chamam o núcleo direto, porque o texto de uma cerimônia não é uma mensagem do fórum).

Esta passada corrige os quatro pontos que a revisão bloqueou e ajusta um caminho que a revisão não cobriu.

## Os passos do plano, um a um

1. **Núcleo do lugar** (`src/main/mentions/call.ts`, `place.ts`, `answer.ts`). `mentionCall` não exige mais uma `Run`: recebe `ref`, `title`, `mission`, `repos` e o lugar (`run`, `channel`, `general`, `ceremony`); `placeOfThread` resolve o lugar de um thread pelo run store e pela config; `answerMentions` é o laço de resposta — os três primeiros nomes, a cópia descartável do código, a resposta no thread e a proposta de issue — com a fonte de comandos por lugar.

   A thread de uma execução continua com o runner (`src/main/runner/service.ts`): `answerMention` é uma casca fina que monta o lugar de execução e passa um `openSession` que reusa o `openStageSandbox` (worktree, etapa do fluxo e o "sim" por comando do host). `src/main/runner/mention.ts` foi removido. A prova de que o caminho da execução não mudou: os testes de menção da thread de execução passam sem edição.

2. **O resto do fórum** (`src/main/mentions/module.ts`, registrado em `src/main/modules.ts`). Assina o fórum, ignora threads `run-` e responde os demais, um de cada vez por thread. `personPost` (`src/main/forum.ts`) acrescenta a linha de sistema quando o texto traz um `@nome` que não é agente do time; `unknownMentions` e `MAX_MENTIONS` entraram em `src/shared/forum.ts`. O sandbox passou a viver em `src/main/sandbox/workspace.ts`, importável pelo módulo sem ciclo.

3. **As cerimônias** (`src/main/mentions/ceremony.ts`). `answerCeremonyMentions` lê o texto, resolve os nomes, chama `runAgent` para cada um (com o mesmo watchdog e limites da execução) e devolve as respostas; uma falha vira uma resposta com o texto de falha, para a cerimônia seguir de pé. Os handlers que chamam: `reply` e `deepAsk` (`agents.ts`), `answerGate` e `explainGate` (`gate.ts`), `askQa` (`qa.ts`), `askRetro` (`retro.ts`) e `askReentry` (`feedback.ts`).

4. **A tela da cerimônia.** `Talk` ganhou `agent?` (`src/shared/types.ts`); `ReplyResult` e `DeepAnswer` ganharam `mentions`. O `useCeremony` expõe `team`, `agentNameOf` e `voiceOfAgent`; as seis telas (`Call`, `Deep`, `Gate`, `QaHandoff`, `Reentry`, `RetroScreen`) registram a resposta do agente nomeado e a falam com a voz dele antes da resposta do agente do sistema.

5. **A tela do thread** (`src/renderer/src/screens/cycle/Thread.tsx`). O rótulo de chamada só aparece para post de pessoa e só lista os `MAX_MENTIONS` primeiros; os demais ganham a linha de "não chamado". A prop `channel` saiu e o aviso `ui.forum.noteChannel` deixou os catálogos; `ui.forum.noteMention` virou a regra única e entrou `ui.forum.mentionsOverLimit`.

## O que esta passada corrigiu

A revisão anterior sustentou `changes` em quatro pontos. Todos foram fechados aqui.

1. **Comandos de host sem o "sim" da pessoa.** Fora da thread de uma execução, `openMentionSession` abria a sessão de host sem `approve`, e o host executava sem confirmação (`host.ts` libera o comando quando não há `approve`). Agora a sessão de host de um lugar de menção recebe um `approve` que recusa todo comando: um `@agente` num canal, numa conversa geral ou numa cerimônia **nunca** roda comando no computador da pessoa sem o "sim" — como a thread de uma execução, e sem depender de uma tela que hoje não existe para pedir. Coberto por um teste novo em `test/mentions-shell.test.ts` (um agente com `shell: host` tem o comando recusado; a sessão abre como host, e nada roda).

2. **Handoff de QA.** `askQa` calculava as respostas dos agentes nomeados e as descartava. Agora elas entram em `q.talk` com o id do agente, na ordem pessoa → nomeados → sistema.

3. **Retro.** O mesmo em `askRetro`: as respostas dos agentes nomeados entram em `retro.talk` antes de `proposeRetroIssues`.

4. **Aprofundamento.** As respostas dos agentes nomeados eram faladas mas não gravadas em `DeepState.msgs`. Agora a atualização do estado grava cada uma com `agent` e `speech`, antes da resposta do agente do sistema, então o registro da cerimônia as guarda e elas não se perdem ao recarregar.

Além disso, um caminho que a revisão não cobriu e que a spec exige: a **resposta livre de um portão** (`answerGate`, o ramo em que a pessoa digita uma resposta livre) não chamava o núcleo — só o `explainGate` chamava. Agora a resposta livre também chama `answerCeremonyMentions` e as respostas entram em `g.talk`. E a ordem no `explainGate` foi acertada: antes as respostas dos nomeados eram empilhadas antes da fala da pessoa; agora a fala da pessoa vem primeiro, depois os nomeados, depois o sistema.

## Onde cada lugar entrega o quê

| Lugar | O que o agente recebe | Comandos |
|---|---|---|
| Thread de uma execução | A conversa, os documentos da pasta do ciclo e a cópia da execução | Sim, pela sessão de etapa do runner (host com o "sim" por comando) |
| Canal de squad | A conversa, a missão do squad e os repositórios do escopo dele | Sim, sobre uma cópia descartável (host recusado, sem tela que pergunte) |
| Canal sem squad / conversa geral | A conversa e os repositórios do espaço de trabalho | Sim, sobre uma cópia descartável (host recusado) |
| Cerimônia | A conversa da cerimônia e o cartão/issue em discussão | Não |
| Lugar sem repositório | A conversa | Não, e a linha de sistema diz por quê |

## Decisões tomadas na implementação

- A cópia descartável fora de uma execução é montada sob `ATAS/sandbox/mention/<thread>/<seq>-<agente>`, com `copyTree` (um repositório: a cópia é a própria pasta; vários: uma subpasta por repositório) e removida ao fim da resposta.
- Um lugar sem repositório (uma cerimônia, ou um canal cujo repositório não existe no disco) não abre sessão de comandos; o thread diz por quê, e a resposta sai mesmo assim.
- A sessão fora de uma execução abre com `reader: false` sobre a pasta de rascunho (que já é a cópia), para não copiar duas vezes.
- Canal e conversa geral nunca propõem issue (a conversa de canal é interna, como o refino fixou); só o lugar de execução tem publicador.
- Um agente com `shell: host` chamado fora da thread de uma execução tem cada comando recusado: a sessão de host é aberta, mas com um `approve` que nega sempre, porque não há, hoje, uma tela de menção para o "sim" por comando (o `CommandApproval` é do `RunScreen`). É o limite que preserva a fronteira; quando houver onde perguntar, o "sim" pode voltar a ser oferecido.

## Correções

- `src/main/mentions/answer.ts`: `openMentionSession` passa `approve` (que nega) ao `openHost`.
- `src/main/qa.ts`, `src/main/retro.ts`: as respostas dos nomeados entram no `talk`.
- `src/renderer/src/screens/Deep.tsx`: as respostas dos nomeados entram em `DeepState.msgs`.
- `src/main/gate.ts`: `answerGate` (resposta livre) chama o núcleo; a ordem do `explainGate` corrigida.
- `test/mentions-shell.test.ts`: teste novo do comando de host recusado.

## O que foi verificado nesta passada

Todos os gates do repositório foram rodados nesta árvore de trabalho:

```
npx tsc --noEmit            passou
npx vitest run              passou (3553 testes, 217 arquivos)
node scripts/theme-audit.mjs passou
npm run i18n:lint           passou
node scripts/public-audit.mjs passou (867 arquivos)
npx electron-vite build     passou
```

Testes novos e existentes que cobrem esta passada: `test/mentions-shell.test.ts` (a fonte de comandos e o comando de host recusado), `test/forum-mentions.test.ts` (os nomes chamados, o desconhecido, a resposta num canal), `test/ceremony-mentions.test.ts` (as respostas dentro de uma cerimônia), `test/gate.test.ts` (o portão), `test/retro-issues.test.ts`, `test/runner-mention-actions.test.ts` (o caminho da thread de uma execução, sem edição). Todos passaram.

## Não verificado

- O módulo novo de menções não tem teste ponta a ponta: a assinatura do fórum e o run store são singletons do processo, e nenhum teste sobe o módulo. O laço em si (`answerMentions`), a resolução do lugar, a fonte de comandos e a recusa do comando de host foram exercitados por teste.
- O sandbox real nunca foi aberto sobre a pasta de rascunho de vários repositórios; o teste usa um `SandboxService` falso.
- Não houve execução com um modelo real nem abertura do aplicativo: o texto de sistema novo, a ordem de fala das seis telas e o registro dos nomeados no portão, na QA e na retro não foram vistos funcionando.
- A conversa da cerimônia não chega ao agente nomeado no call diário e no aprofundamento (`reply` e `deepAsk` passam `msgs: []`): a conversa dessas duas telas mora no renderer, e os handlers só recebem o cartão e o texto. Fica como sugestão; não foi alterado.
- O estado de "trabalhando" enquanto o agente responde é da issue irmã e não foi construído aqui.
