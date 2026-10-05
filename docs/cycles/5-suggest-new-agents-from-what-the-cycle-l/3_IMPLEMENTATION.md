# O que ficou construído: a sugestão de agente que nasce do histórico e espera em Ações

## O que mudou para quem usa

Em **Configurações › Time** existe o botão **Sugerir agentes**. Ao ser usado, o aplicativo lê o
histórico que já grava — execuções, linhas de auditoria de comandos e as decisões das atas — e, quando
encontra um padrão repetido o bastante, deixa uma proposta em **Ações**. Cada proposta mostra, no
próprio cartão, o nome, o papel, a etapa que o agente cobriria, o rascunho do prompt, as permissões
propostas e a evidência, com um link por execução, ata ou linha de onde saiu. Quando o histórico ainda
não repete nada o suficiente, nenhuma proposta aparece e a tela diz por quê.

O cartão da proposta traz os três caminhos: **Aceitar e criar o agente** cria um agente comum do time,
somente leitura, sem comandos e sem acesso ao host, editável depois como qualquer outro; **Editar**
abre o editor de agente em Configurações › Time já preenchido com o que a sugestão propunha, e salvar
cria o agente; **Recusar** pede um motivo opcional e o guarda. Nada é aplicado em silêncio: o agente só
nasce quando a pessoa decide.

A decisão fica num arquivo próprio dos dados do espaço de trabalho (`suggestions.json`), nunca no
repositório. Uma sugestão recusada não volta igual: a mesma impressão (papel + etapa + tipo de
evidência) só reaparece quando há uma execução ou ata que a recusa não tinha visto, e nesse caso o
cartão diz que já foi recusada antes, quando, e o que mudou.

No fim de uma retro, o aplicativo pode levantar sozinho até **duas** sugestões, só as que passam do
limiar e não batem com uma recusa. Fora do pedido e do fim da retro, nenhuma sugestão é oferecida —
nunca no meio de uma execução nem de uma cerimônia.

## O que foi verificado nesta etapa

Tudo abaixo foi rodado nesta árvore, com os comandos do repositório.

- `npx tsc --noEmit` — sem erro.
- `npx vitest run` — a suíte inteira: 214 arquivos, 3558 testes, todos verdes. Os novos são
  `test/suggestions.test.ts` (17 testes) e `test/suggestions-module.test.ts` (13 testes).
- `node scripts/theme-audit.mjs` — sem cor literal nova.
- `npm run i18n:lint` — 4031 chaves nos dois idiomas, zero texto solto e paridade entre os catálogos.
- `node scripts/public-audit.mjs` — 862 arquivos, nada que pertença a empresa ou pessoa.
- `npx electron-vite build` — build do CI conclui.

Os testes cobrem: a leitura das fontes por execução (perguntas que chegam à pessoa, devoluções,
achados de revisão e cenários de QA, etapas feitas à mão), a linha de auditoria de comando permitido, as
decisões das atas, o limiar (nada abaixo dele), o agrupamento por impressão, a chave de evidência, o
registro da decisão, o bloqueio da recusa e a volta com evidência nova, o aceite criando o agente comum
com as permissões no mínimo, a recusa do aceite quando a etapa já não existe, a edição, e o teto de duas
sugestões no fim da retro.

## O que não foi verificado

- O comportamento do **modelo real**: se ele devolve uma sugestão útil a partir da evidência. Os testes
  usam um modelo simulado; nenhuma chamada real foi feita.
- O **volume real** do histórico e a velocidade da leitura.
- O **limiar final**: ficou em três ocorrências e duas execuções distintas; é um valor de partida, não
  medido em uso real.
- A **renderização do cartão** numa tela de verdade e o caminho "editar" abrindo o editor preenchido de
  ponta a ponta; foram conferidos por tipos e testes, não abertos no aplicativo.
- O gancho do fim da retro **em todas as famílias de retro** (workspace e squad).

## Onde cada peça ficou

- `src/main/suggestions.ts` — a leitura pura: `gatherEvidence`, `patterns`/`scoreFindings`,
  `impressionOf`, `evidenceKeyOf`, `blockedByRejection`, o limiar e o registro (`suggestions.json`).
- `src/main/suggestionsModule.ts` — o fluxo: monta as sugestões acima do limiar, pede o rascunho ao
  modelo, deixa a proposta em Ações, cria o agente no aceite e grava cada decisão; o botão e os canais.
- `src/main/actions.ts` — `proposeAgentSuggestion` e o ramo de `suggest-agent` em `approveAction`
  (não passa por escrita externa).
- `src/main/retro.ts` — o gancho do fim da retro.
- `src/shared/types.ts` — `ActionKind` ganhou `suggest-agent`; `src/shared/suggestions.ts` — o
  contrato do cartão e o teto por retro.
- `src/renderer/src/screens/SuggestionCard.tsx` — os três caminhos; `TeamSection.tsx` e
  `teamNav.ts` — o botão e o editor preenchido.
- `src/main/webPolicy.ts` — os canais de decisão são desktop-only.
- Catálogos: `main.*.json`, `ui-docs.*.json`, `ui-team.*.json` e o prompt `prompt.sdd.suggest.*`.

## Fronteiras respeitadas

A sugestão nunca cria, remove ou reordena etapa do fluxo: a etapa proposta é sempre uma que existe e
`runs:migrateFlow` não é tocado. A v1 não grava história nova nem lê a transcrição das cerimônias. A
recusa guarda a impressão no registro do workspace, fora do repositório. O gancho da retro lê as
decisões e as atas e não transforma melhoria de processo em nada — essa é outra frente.
