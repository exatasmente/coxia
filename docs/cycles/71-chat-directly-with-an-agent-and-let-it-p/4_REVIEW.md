# Revisão: conversa direta com um agente e as propostas que ela levanta

## Veredito

**changes.** O núcleo de runtime está implementado e os gates do repositório passam, mas a entrega não fecha o que a especificação e o plano fixaram: falta a tela inteira (abrir a conversa direta pela equipe, decidir o lote em Ações, ajustar as ferramentas por agente), não existe nenhum teste novo de comportamento, e o caminho de proposta tem dois defeitos que já perdem escritas hoje.

## O que foi conferido nesta etapa

Toda a conferência é leitura do código da árvore de trabalho e execução dos gates do repositório. Nada foi visto funcionando no aplicativo; a conversa no telefone pareado e a ausência de memória entre conversas continuam **não verificadas**.

Gates rodados nesta etapa, todos com saída em arquivo:

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0, sem saída |
| `npx vitest run` | exit 0 — 221 arquivos, 3639 testes passando |
| `node scripts/theme-audit.mjs` | exit 0 — 55 pares ok nos dois temas |
| `npm run i18n:lint` | exit 0 — 4058 chaves nos dois idiomas |
| `node scripts/public-audit.mjs` | exit 0 — 910 arquivos, nada da empresa ou de pessoa |

CI também roda `electron-vite build`; não foi rodado nesta etapa.

## O que está de acordo com a spec e o plano

- **A conversa `agent` existe no fórum.** `THREAD_KINDS` ganhou o quarto tipo, o cabeçalho o aceita (`src/shared/forum.ts`), `agentThreadId(agentId)` devolve `agent-<id>`, `ensureAgentThread` cria de forma idempotente e `forum:list` a garante por agente do time (`src/main/forum-channels.ts`, `src/main/forum.ts`). O dono vai no campo `squad` do cabeçalho e `summaryOf` expõe `agent` (`src/main/forum-core.ts`). Como `forumLists` classifica por `kind === 'channel'`, uma conversa `agent` cai na lista de conversas (`src/shared/forumView.ts`), como a spec pede (regra 3).
- **O dono responde sem `@`.** `placeOfThread` reconhece `agent` e devolve o dono em `MentionPlace.owner` (`src/main/mentions/place.ts`); `callsOf(message, owner)` chama o dono primeiro, sem `@`, mantendo o teto de 3, e uma mensagem de agente continua não chamando ninguém (`src/main/mentions/module.ts`).
- **A resposta pode propor escritas.** O esquema trocou `issue` por `proposals`, com as cinco operações e leitura leniente que descarta um item inválido sem derrubar a resposta (`src/main/mentions/call.ts`). O `proposeMention` planeja cada escrita por `provider.planWrite`, trata `unsupported` (host sem a operação), propõe por `proposeVcsAction` e, quando o agente é autônomo e a escrita é de baixo risco, roda por `runVcsAuto` (`src/main/mentions/propose.ts`). Fechar, mudar estado e abrir issue sempre propõem — `LOW_RISK` só tem `comment` e `labels`, o que honra a regra 11.
- **Ferramentas por agente.** `AgentDef.tools` é opcional, `toolsForAgent` sobrepõe campo a campo o do espaço de trabalho (inclusive ligando o que o espaço desligou), e `allowedFor`/`wantsVcsTool`/`toolsOf` passam a usar as efetivas (`src/shared/config/types.ts`, `team.ts`, `src/main/agents.ts`). A escrita em arquivos não nasce de uma conversa: `toolsOf` só dá `Edit`/`Write` com `call.confine`, que uma menção nunca tem (`src/main/agents.ts:997-1002`).
- **Migração v12→v13.** `CONFIG_SCHEMA_VERSION` subiu e o passo está em `STEPS`, sem levantar nada (`src/shared/config/migrations.ts`).

## Achados bloqueantes

### 1. Comandos extras do host são descartados na proposta

`proposeMention` chama `proposeVcsAction`, que guarda só `commands[0]` (`src/main/mentions/propose.ts:113-122`). Vários hosts planejam mais de um comando para uma escrita: num host em que pôr e tirar rótulos é uma chamada para pôr e uma por rótulo a tirar (`src/main/vcs/github.ts:531-537`), `planWrite` devolve mais de um `VcsCommand`. A rota da autonomia itera todos os comandos, a rota da proposta guarda só o primeiro: uma proposta de rótulos aprovada no lote põe os rótulos e **não tira** os que devia tirar, sem dizer nada. O certo é `proposeVcsCommands` (ou `proposeVcsGroup`), que já existe para isso (`src/main/actions.ts:274-276`).

### 2. Na thread de uma execução, as demais propostas são engolidas

`raiseWrites` trata a thread de uma execução com um ramo próprio que só olha `createIssue` e retorna (`src/main/mentions/answer.ts:183-190`). Como o esquema agora oferece as cinco operações em qualquer lugar onde o agente lê o rastreador, um agente que responda na thread de uma execução propondo um comentário, um rótulo, um estado ou um fechamento tem essas propostas **descartadas em silêncio** — nem esperam em Ações, nem viram uma linha de sistema dizendo por quê. A spec (regra 7) pede que o agente proponha em qualquer lugar onde responde, inclusive na conversa de uma execução.

### 3. `wantsVcsTool` muda o caminho de leitura do host quando o agente tem `tools`

Em `src/main/agents.ts:457`, a expressão virou `!req.confine && (req.tools ? req.tools.vcsCli : vcsReadPolicy().via === 'tool')`. Quando a chamada traz `req.tools` (qualquer chamada de um agente com o campo), o `via === 'tool'` do espaço de trabalho deixa de ser consultado, e o que decide é só `tools.vcsCli`. Um agente com `tools.vcsCli: true` mas um espaço de trabalho cujo caminho de leitura é outro passa a receber a ferramenta `VcsRead` fora do caminho configurado; um agente com `tools.vcsCli: false` perde a ferramenta mesmo que o espaço de trabalho a dê. A regra 12 da spec fala das ferramentas **dizíveis por agente**, não de trocar o caminho de leitura do host — e o próprio plano diz que "o que um agente lê do host" fica fora desta entrega.

### 4. A tela não existe

A entrega não tem nenhum dos três pontos de tela que o plano fixou: o atalho para abrir a conversa direta de um agente a partir da equipe, o "sim a todas" do lote em Ações agrupado por `unit.batch` (`src/renderer/src/screens/Actions.tsx`) e os interruptores de ferramentas por agente (`TeamSection.tsx`). O diff do renderer desta passada muda só `agentEdit.ts` para carregar o campo no rascunho; sem a tela, o critério de aceite 1 (a conversa aparece e se abre pelo agente, também no telefone) e o "sim a todas" do critério 6/10 não são alcançáveis pelo uso. Não verificado: nada disso foi visto funcionando.

### 5. Nenhum teste novo de comportamento

A passada só ajustou testes que fixavam a versão 12 e o contrato `issue`→`proposals`. Não existe teste para: fórum `agent` (criação idempotente e listagem), lugar/chamada do dono sem `@`, propostas por operação e a chave que as distingue, host sem a operação, autonomia só para comentário/rótulo, lote, ferramentas por agente sem `Edit`/`Write` numa menção, e a migração v12→v13. Sem eles, os defeitos 1 e 2 passaram pelos gates verdes: a suíte atual não exercita nenhuma proposta fora de `createIssue`.

## Achados menores

- O texto de sistema da menção continua dizendo ao agente que ele "só lê: não altere nada" (`prompt.sdd.runner.mention.system`, `src/shared/i18n/main.en.json:851`), enquanto a seção de propostas diz que ele pode propor escritas. São duas instruções que se contradizem no mesmo texto de sistema.
- No ramo da thread de execução, todas as escritas `createIssue` de uma resposta usam a mesma chave `${seq}-${agent}` (`src/main/mentions/answer.ts:187`). Duas issues propostas na mesma resposta colidem e a segunda não é proposta (a deduplicação por `key` em `proposeVcsAction` devolve `null`). A spec admite várias propostas por resposta.
- A projeção para o alvo do registro usa `place.ref`, que numa conversa direta é indefinido: `iidOfRef` devolve 0 e o `issue` da ação fica 0. A spec e o plano dizem que toda proposta leva "a issue-projeto do espaço de trabalho como alvo"; não foi conferido se o alvo 0 é aceito pela tela de Ações.

## O que não foi revisado

- A conversa direta no telefone pareado e a ausência de memória entre conversas: o comportamento não existiu para ser visto, e a política do navegador só foi lida.
- O `electron-vite build`, que o CI roda e esta etapa não rodou.
- Nada foi exercitado contra um host de código real nem com dados reais; a leitura de capacidades por host foi feita pelo código (`src/shared/vcsCaps.ts` e os `unsupported` dos provedores).
