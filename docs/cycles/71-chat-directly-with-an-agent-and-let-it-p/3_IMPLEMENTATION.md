# Implementação: conversa direta com um agente e as propostas que ela levanta

Esta passada implementou parte do plano da 71 no worktree, seguindo a decisão da pessoa do portão 3 (opção B: o módulo de menções ganha um caminho de proposta próprio, que planeja por `planWrite` e propõe direto pela porta de Ações, sem passar pelo publicador da execução). O que ficou implementado é o núcleo de fórum, menção, proposta e configuração; a tela e os testes de comportamento novos ficaram de fora e estão listados abaixo.

## O que mudou

### Fórum: a conversa direta de um agente

- `THREAD_KINDS` ganhou o quarto tipo `agent` e o enum do cabeçalho o aceita (`src/shared/forum.ts`). O agente dono vai no campo `squad` do cabeçalho, que já existia; nenhum campo novo no formato do arquivo.
- `agentThreadId(agentId)` = `agent-<id>` e `ensureAgentThread(forum, agent, language)` (`src/main/forum-channels.ts`), criando a conversa de forma idempotente, com o título `main.forum.agentTitle`; `forum:list` garante uma conversa por agente do time, como já garantia a geral e os canais (`src/main/forum.ts`).
- `summaryOf` (`src/main/forum-core.ts`) passa a expor `agent` para uma conversa `agent`, e `ensureThread` grava `squad` também para `agent`.
- A conversa cai na lista de conversas (não de canais), porque `forumLists` classifica por `kind === 'channel'` e pelo id da geral (`src/shared/forumView.ts`).

### Menção: o dono sem `@` e o lugar

- `placeOfThread` reconhece `agent`: um lugar `kind: 'channel'`, `squad: null`, com o dono em `MentionPlace.owner` e os repos do espaço de trabalho (`src/main/mentions/place.ts`).
- `callsOf(message, owner)` (`src/main/mentions/module.ts`) chama o dono sem `@` e antes dos mencionados, mantendo o teto de 3; mensagem de agente continua não chamando ninguém. O módulo injeta `propose: proposeMention`.

### A resposta que propõe escritas

- `mentionCall` trocou `issue: boolean` por `proposals: boolean`, com o esquema `proposals` (`comment`, `labels`, `status`, `close`, `createIssue`) e a leitura leniente `readProposedWrites`, que descarta um item inválido sem derrubar a resposta (`src/main/mentions/call.ts`).
- `mayPropose` (antes `proposesIssue`) vale onde há caminho de proposta: fora da execução, `deps.propose`; na thread de uma execução, o `proposeIssue` do publisher. `raiseWrites` (`src/main/mentions/answer.ts`) roteia: a thread de uma execução mantém o publisher para `createIssue`; os demais lugares usam `deps.propose`, e cada resultado vira uma linha de sistema (`runner.mention.proposed|autoWrote|unsupported|proposalFailed`).
- Novo `src/main/mentions/propose.ts` (`proposeMention`): planeja cada escrita com `provider.planWrite`, trata `VcsError`/`unsupported` (host sem a operação) como indisponível, propõe por `proposeVcsAction` com a chave `mention:<thread>:<dono>:<agente>:<n>:<hash do corpo>`, e, quando o agente é autônomo e a escrita é de baixo risco (comentário ou rótulo), roda por `runVcsAuto` (auditada). Fechar, mudar estado e abrir issue sempre propõem.
- A cerimônia segue sem propostas (`proposals: false`).

### Permissões de ferramentas por agente

- Campo opcional `tools?: AgentToolsConfig` no `AgentDef` (`src/shared/config/types.ts`); `toolsForAgent(config, agent)` (`src/shared/config/team.ts`) devolve o do agente sobrepondo campo a campo o do espaço de trabalho, inclusive ligando uma ferramenta desligada no espaço.
- `allowedFor`, `wantsVcsTool` e `toolsOf` (`src/main/agents.ts`) passam a usar as ferramentas efetivas; `EngineRequest` ganhou `tools?`. O caminho da cerimônia usa as do agente system do time.
- Esquema: o objeto `agents.tools` virou o schema `agentTools`, reusado em `agentDef.tools` (com descrição própria) e em `agents.tools` (`src/shared/config/schema.ts`). `newAgent` carrega o campo quando presente.
- `CONFIG_SCHEMA_VERSION` 12 → 13 e passo `v12ToV13` em `STEPS` (`src/shared/config/migrations.ts`), que não levanta nada: um agente sem `tools` continua usando o do espaço de trabalho.

### i18n

- `prompt.sdd.runner.mention.proposals` nos dois catálogos, substituindo `prompt.sdd.runner.mention.issue`, que foi removido (não era mais usado). `main.forum.agentTitle` e os quatro códigos de sistema entraram nos dois catálogos.

## O que foi verificado

Nada foi visto funcionando no aplicativo. Rodado nesta árvore:

- `npx tsc --noEmit` — limpo.
- `npx vitest run` — 3638 testes passando e 1 falhando na primeira rodada (`test/cycle-prompts.test.ts`, acusando `runner.mention.issue` não usado no catálogo); a chave foi removida e o teste passa.
- `npm run i18n:lint` — passa (chaves iguais nos dois idiomas).
- Testes ajustados ao novo contrato: `test/runner-mention-actions.test.ts` (campo `proposals` no lugar de `issue`) e os testes de configuração que fixavam a versão 12 (agora 13) e a lista de campos do agente (ganhou `tools`).

## O que ficou fora e não foi verificado

- A tela: o atalho da equipe para abrir a conversa de um agente, a tela de Ações com o "sim a todas" do lote e os interruptores de ferramentas na tela do agente.
- Os testes de comportamento novos: fórum (criação idempotente e listagem), lugar/chamada (dono sem `@`), propostas por operação e chave, host sem a operação, autonomia, lote e permissões por agente; e o teste de migração v12→v13.
- Não rodados os gates `node scripts/theme-audit.mjs` e `node scripts/public-audit.mjs`.
- Não verificado: a conversa direta no telefone pareado e a ausência de memória entre conversas.
