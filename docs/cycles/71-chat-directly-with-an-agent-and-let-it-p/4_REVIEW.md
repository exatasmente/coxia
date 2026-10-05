# Conversa direta com um agente e as propostas que ela levanta

## Veredito

**approved.** Os cinco achados bloqueantes da rodada anterior estão atendidos: uma escrita
planejada em vários comandos é proposta inteira, a conversa de uma execução deixou de
descartar as propostas que não são uma issue, o caminho de leitura do host voltou a ser o do
espaço de trabalho, a tela toda existe (atalho da conversa direta, "sim a todas" do lote,
interruptores de ferramentas por agente) e há testes de comportamento novos. Os gates do
repositório passam. O que resta são sugestões, não defeitos que impedem a entrega.

## O que foi conferido nesta etapa

Toda a conferência é leitura do código da árvore de trabalho e execução dos gates do
repositório. Nada foi visto funcionando no aplicativo.

Gates rodados nesta etapa:

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0, sem saída |
| `npx vitest run` | exit 0 — 223 arquivos, 3657 testes passando |
| `node scripts/theme-audit.mjs` | exit 0 |
| `npm run i18n:lint` | exit 0 — 4074 chaves nos dois idiomas |
| `node scripts/public-audit.mjs` | exit 0 — 914 arquivos |

Também conferido por leitura: nenhuma referência a `mention-issue` ou `proposeIssue`
restou na árvore, e os textos de sistema removidos não são mais usados.

## O que a rodada anterior pediu, e o que foi feito

1. **Uma escrita em vários comandos era cortada no primeiro.** `proposeMention` passou a
   propor por `proposeVcsCommands`, que cria uma proposta por comando com a chave sufixada
   (`src/main/mentions/propose.ts`), e há teste que exercita três comandos de rótulos e
   verifica as três propostas (`test/mentions-agent-chat.test.ts`).
2. **A conversa de uma execução descartava as demais propostas.** O ramo próprio da thread
   de uma execução saiu; `raiseWrites` trata todo lugar pelo mesmo caminho (`src/main/mentions/answer.ts`).
   A issue proposta na thread de uma execução agora espera como `mention-write`
   (`test/runner-mention-actions.test.ts`).
3. **`wantsVcsTool` trocava o caminho de leitura do host.** Quando o agente nomeia
   ferramentas, o caminho de leitura do host continua decidido pelo espaço de trabalho
   (`vcsReadPolicy().via === 'tool'`), e o `tools` do agente só decide o ramo do agente que
   lê o host por ferramenta (`src/main/agents.ts`).
4. **A tela não existia.** O atalho "Conversar com um agente" no fórum abre `agent-<id>`
   (`src/renderer/src/screens/cycle/ForumScreen.tsx`); o "sim a todas" agrupa por
   `unit.batch` com a regra pura em `src/shared/actions/batch.ts` (`Actions.tsx`); os
   interruptores de ferramentas por agente estão em `TeamSection.tsx` (`ToolsFields`), e o
   rascunho trata "seguir o espaço de trabalho" como o campo ausente (`agentEdit.ts`). As
   chaves de idioma dos três existem nos dois catálogos.
5. **Não havia teste de comportamento novo.** Existem `test/mentions-agent-chat.test.ts`
   (conversa `agent`, dono sem `@`, propostas por operação, chave, host sem a operação,
   autonomia estreita, espaço de teste) e `test/actions-batch.test.ts` (lote), além de
   casos em `test/agent-team.test.ts` (`toolsForAgent` e migração v12→v13) e em
   `test/runner-mention-actions.test.ts`.

## O que foi revisado e está de acordo com a spec e o plano

- **A conversa `agent` no fórum.** O quarto tipo está em `THREAD_KINDS`, o formato aceita o
  cabeçalho, `agentThreadId` devolve `agent-<id>`, a criação é idempotente por agente e o
  dono vai no campo `squad`, exposto como `agent` no resumo. Como a lista classifica por
  `kind`, uma conversa `agent` cai na lista de conversas.
- **O dono responde sem `@`.** `placeOfThread` reconhece `agent` e devolve o dono,
  `callsOf(message, owner)` chama o dono primeiro, o teto de 3 vale e um texto de agente não
  chama ninguém.
- **O esquema `proposals`.** As cinco operações são lidas lenientemente, um item inválido é
  descartado sem derrubar a resposta, e a autonomia só solta comentário e rótulo — fechar,
  mudar estado e abrir issue sempre esperam.
- **Ferramentas por agente.** `AgentDef.tools` é opcional e `toolsForAgent` sobrepõe campo a
  campo o do espaço de trabalho, inclusive ligando o que o espaço desligou; a migração
  v12→v13 não levanta nada e um agente sem o campo segue usando o do espaço.
- **A escrita em arquivos continua impossível por uma conversa.** Uma menção não recebe
  `confine`, então `Edit`/`Write` ficam fora mesmo com as ferramentas de arquivo ligadas só
  para o agente.

## Sugestões

- Na conversa de uma execução, as propostas deixaram de carregar o `runId` na unidade, e a
  linha que dizia onde a issue proposta foi criada não é mais escrita na conversa. O que já
  esperava em Ações continua esperando; o que se perde é o aviso na conversa da execução.
- O alvo do registro de uma proposta numa conversa sem `ref` fica no número 0; o que a
  pessoa lê vem do resumo e do título, então a leitura da tela não quebra, mas o registro de
  auditoria fica sem o número da issue.
- O texto de sistema da menção já não diz ao agente que ele "só lê", o que resolve a
  contradição apontada antes.

## O que não foi revisado

- A conversa direta no telefone pareado e a ausência de memória entre conversas: o
  comportamento não existiu para ser visto, e a política do navegador só foi lida; a
  conversa é uma thread comum de id estável, aberta como as demais.
- O `electron-vite build`, que o CI roda e esta etapa não rodou.
- A tela exercitada no aplicativo: não há teste de renderer; o que foi exercitado é a regra
  pura do lote e a compilação dos componentes.
- Nada foi exercitado contra um host de código real nem com dados reais.
