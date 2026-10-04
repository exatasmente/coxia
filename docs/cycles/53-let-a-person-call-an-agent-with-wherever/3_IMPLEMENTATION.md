# Uma regra só: o `@` chama um agente onde a pessoa escreve

## O que foi implementado

O `@agente` deixou de ser um recurso da thread de uma execução e passou a valer em todo lugar onde a pessoa escreve para o aplicativo. O núcleo da resposta vive em `src/main/mentions/`, compartilhado por três donos: o runner (a thread de uma execução, com o comportamento de antes preservado), um módulo novo (os demais threads do fórum) e as cerimônias (que chamam o núcleo direto, porque o texto de uma cerimônia não é uma mensagem do fórum).

## Os passos do plano, um a um

1. **Núcleo do lugar** (`src/main/mentions/call.ts`, `place.ts`, `answer.ts`). `mentionCall` deixou de exigir uma `Run` e recebe `ref`, `title`, `mission`, `repos` e o lugar (`run`, `channel`, `general`, `ceremony`); `placeOfThread` resolve o lugar de um thread pelo run store e pela config; `answerMentions` é o laço de resposta — os três primeiros nomes, a cópia descartável do código, a resposta no thread e a proposta de issue — com a fonte de comandos por lugar.

   A thread de uma execução continua com o runner (`src/main/runner/service.ts`): `answerMention` virou uma casca fina que monta o lugar de execução e passa um `openSession` que reusa o `openStageSandbox` (worktree, etapa do fluxo e o "sim" por comando do host). `src/main/runner/mention.ts` foi removido. A prova de que o caminho da execução não mudou: os testes de menção da thread de execução passam sem edição.

2. **O resto do fórum** (`src/main/mentions/module.ts`, registrado em `src/main/modules.ts`). Assina o fórum, ignora threads `run-` e responde os demais, um de cada vez por thread. `personPost` (`src/main/forum.ts`) acrescenta a linha de sistema quando o texto traz um `@nome` que não é agente do time; `unknownMentions` e `MAX_MENTIONS` entraram em `src/shared/forum.ts`. O sandbox passou a viver em `src/main/sandbox/workspace.ts`, importável pelo módulo sem ciclo.

3. **As cerimônias** (`src/main/mentions/ceremony.ts`). `answerCeremonyMentions` lê o texto, resolve os nomes, chama `runAgent` para cada um (com o mesmo watchdog e limites da execução) e devolve as respostas; uma falha vira uma resposta com o texto de falha, para a cerimônia seguir de pé. Os handlers que chamam: `reply` e `deepAsk` (`agents.ts`), `answerGate` e `explainGate` (`gate.ts`), `askQa` (`qa.ts`), `askRetro` (`retro.ts`) e `askReentry` (`feedback.ts`). Em cada registro a ordem é: a fala da pessoa, as respostas dos agentes nomeados, e por fim a do agente do sistema.

4. **A tela da cerimônia.** `Talk` ganhou `agent?` (`src/shared/types.ts`); `ReplyResult` e `DeepAnswer` ganharam `mentions`. O `useCeremony` expõe `team`, `agentNameOf` e `voiceOfAgent`; as seis telas (`Call`, `Deep`, `Gate`, `QaHandoff`, `Reentry`, `RetroScreen`) registram a resposta do agente nomeado e a falam com a voz dele antes da resposta do agente do sistema.

5. **A tela do thread** (`src/renderer/src/screens/cycle/Thread.tsx`). O rótulo de chamada só aparece para post de pessoa e só lista os `MAX_MENTIONS` primeiros; os demais ganham a linha de "não chamado". A prop `channel` saiu e o aviso `ui.forum.noteChannel` deixou os catálogos; `ui.forum.noteMention` virou a regra única e entrou `ui.forum.mentionsOverLimit`.

## Onde cada lugar entrega o quê

| Lugar | O que o agente recebe | Comandos |
|---|---|---|
| Thread de uma execução | A conversa, os documentos da pasta do ciclo e a cópia da execução | Sim, pela sessão de etapa do runner |
| Canal de squad | A conversa, a missão do squad e os repositórios do escopo dele | Sim, sobre uma cópia descartável |
| Canal sem squad / conversa geral | A conversa e os repositórios do espaço de trabalho | Sim, sobre uma cópia descartável |
| Cerimônia | A conversa da cerimônia e o cartão/issue em discussão | Não (a resposta diz por quê) |
| Lugar sem repositório | A conversa | Não, e a linha de sistema diz por quê |

## Decisões tomadas na implementação

- A cópia descartável fora de uma execução é montada sob `ATAS/sandbox/mention/<thread>/<seq>-<agente>`, com `copyTree` (um repositório: a cópia é a própria pasta; vários: uma subpasta por repositório) e removida ao fim da resposta.
- Um lugar sem repositório (uma cerimônia, ou um canal cujo repositório não existe no disco) não abre sessão de comandos; o thread diz por quê, e a resposta sai mesmo assim.
- A sessão fora de uma execução abre com `reader: false` sobre a pasta de rascunho (que já é a cópia), para não copiar duas vezes.
- Canal e conversa geral nunca propõem issue (a conversa de canal é interna, como o refino fixou); só o lugar de execução tem publicador.

## O que foi verificado nesta passada

Todos os gates do repositório foram rodados nesta árvore de trabalho:

```
npx tsc --noEmit            passou
npx vitest run              passou (3552 testes, 217 arquivos)
node scripts/theme-audit.mjs passou
npm run i18n:lint           passou
node scripts/public-audit.mjs passou (865 arquivos)
npx electron-vite build     passou
```

Numa das passadas do suite completo dois testes do runner falharam e passaram na passada seguinte; foram tratados como instabilidade do ambiente (são de tempo), não como regressão desta mudança.

Testes novos: `test/mentions-place.test.ts` (a resolução do lugar), `test/forum-mentions.test.ts` (os nomes chamados, o desconhecido, a resposta num canal e a falha que não para o próximo), `test/mentions-shell.test.ts` (a fonte de comandos), `test/ceremony-mentions.test.ts` (as respostas dentro de uma cerimônia) e `test/forum-mentions-view.test.ts` (o que o thread diz).

## Não verificado

- O módulo novo de menções não tem teste ponta a ponta: a assinatura do fórum e o run store são singletons do processo, e nenhum teste sobe o módulo. O laço em si (`answerMentions`), a resolução do lugar e a fonte de comandos foram exercitados por teste.
- O sandbox real nunca foi aberto sobre a pasta de rascunho de vários repositórios; o teste usa um `SandboxService` falso.
- Não houve execução com um modelo real nem abertura do aplicativo: o texto de sistema novo e o comportamento das seis telas ao falar cada resposta não foram vistos funcionando.
- O estado de "trabalhando" enquanto o agente responde é da issue irmã e não foi construído aqui.
