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

## O que mudou nesta passada

Esta passada corrigiu o ponto que a revisão apontou como bloqueante e as duas sugestões que ela deixou.
Nada de novo em comportamento visível além disto:

- O fim da retro voltou a funcionar como o desenho manda. A retro passa a ser **gravada antes** de o
  aplicativo levantar as sugestões, de modo que a leitura do que o ciclo mostra já inclui a retro que
  acabou de ser respondida. Antes disso, a retro que estava sendo respondida ainda não estava no disco
  quando a leitura acontecia.
- O aplicativo voltou a encontrar a retro de um squad. A busca pela última retro de um squad exigia que
  o nome do arquivo inteiro coubesse no formato do dia, o que nenhum arquivo de retro de squad cumpre:
  a leitura sempre ficava sem a retro e caía na retro do espaço de trabalho inteiro. Agora um arquivo
  de retro de squad é reconhecido pelo sufixo do squad, e o do espaço de trabalho inteiro é reconhecido
  pelo nome do dia.
- A proposta em Ações passou a ser deduplicada apenas contra ela mesma enquanto espera decisão. Quem
  decide se uma sugestão já decidida pode voltar é a regra da recusa (evidência nova), e não a fila de
  Ações; antes, uma proposta já decidida podia ser lida como "reapresentável" e a decisão da recusa
  ficava ambígua.
- O caminho "Editar" passou a ser consumido uma vez. O pedido de edição enviado do cartão é limpo
  depois de entregue, e o próprio painel guarda qual pedido já tratou, de modo que voltar à seção não
  reabre o editor de agente com um rascunho que ninguém pediu de novo.

## O que foi verificado nesta etapa

Tudo abaixo foi rodado nesta árvore, com os comandos do repositório.

- `npx tsc --noEmit` — sem erro.
- `npx vitest run` — a suíte inteira: 214 arquivos, 3564 testes, todos verdes. Os testes novos desta
  passada são três em `test/retro-issues.test.ts` e três em `test/suggestions-module.test.ts`, somados
  aos que já existiam de `test/suggestions.test.ts` (17) e `test/suggestions-module.test.ts` (agora 16).
- `node scripts/theme-audit.mjs` — sem cor literal nova.
- `npm run i18n:lint` — 4031 chaves nos dois idiomas, zero texto solto e paridade entre os catálogos.
- `node scripts/public-audit.mjs` — 864 arquivos, nada que pertença a empresa ou pessoa.
- `npx electron-vite build` — build do CI conclui.

O que os testes cobrem: a leitura das fontes por execução (perguntas que chegam à pessoa, devoluções,
achados de revisão e cenários de QA, etapas feitas à mão), a linha de auditoria de comando permitido, as
decisões das atas, o limiar (nada abaixo dele), o agrupamento por impressão, a chave de evidência, o
registro da decisão, o bloqueio da recusa e a volta com evidência nova, o aceite criando o agente comum
com as permissões no mínimo, a recusa do aceite quando a etapa já não existe, a edição, o teto de duas
sugestões no fim da retro, a retro de squad sendo encontrada, a retro sendo gravada antes da leitura, e a
proposta já decidida podendo voltar sem deixar dois cartões iguais esperando.

Para o ponto bloqueante: com a gravação da retro de volta para depois da leitura, os três testes novos
de `test/retro-issues.test.ts` ficam vermelhos (conferido nesta passada, revertendo a ordem de propósito
e rodando de novo); com a deduplicação antiga de volta, o teste do cartão já decidido fica vermelho
(conferido do mesmo modo). O caminho "Editar" não tem teste de tela e não foi verificado por execução.

## O que não foi verificado

- O comportamento do **modelo real**: se ele devolve uma sugestão útil a partir da evidência. Os testes
  usam um modelo simulado; nenhuma chamada real foi feita.
- O **volume real** do histórico e a velocidade da leitura.
- O **limiar final**: ficou em três ocorrências e duas execuções distintas; é um valor de partida, não
  medido em uso real.
- A **renderização do cartão** numa tela de verdade e o caminho "editar" abrindo o editor preenchido de
  ponta a ponta; foram conferidos por tipos e testes, não abertos no aplicativo.
- O gancho do fim da retro **em todas as famílias de retro** (workspace e squad): o caminho de squad foi
  exercitado por teste com a retro e a ata montadas à mão; a retro do espaço de trabalho inteiro não foi
  exercitada de ponta a ponta nesta passada.

## Onde cada peça ficou

- `src/main/suggestions.ts` — a leitura pura: `gatherEvidence`, `patterns`/`scoreFindings`,
  `impressionOf`, `evidenceKeyOf`, `blockedByRejection`, o limiar e o registro (`suggestions.json`).
- `src/main/suggestionsModule.ts` — o fluxo: monta as sugestões acima do limiar, pede o rascunho ao
  modelo, deixa a proposta em Ações, cria o agente no aceite e grava cada decisão; o botão e os canais.
- `src/main/actions.ts` — `proposeAgentSuggestion` e o ramo de `suggest-agent` em `approveAction`
  (não passa por escrita externa); a deduplicação do cartão.
- `src/main/retro.ts` — o gancho do fim da retro, agora depois de `write(retro)`, e `latestRetro`
  reconhecendo a retro de squad.
- `src/shared/types.ts` — `ActionKind` ganhou `suggest-agent`; `src/shared/suggestions.ts` — o
  contrato do cartão e o teto por retro.
- `src/renderer/src/screens/SuggestionCard.tsx` — os três caminhos; `TeamSection.tsx` e
  `TeamSettings.tsx`/`teamNav.ts` — o botão, o editor preenchido e o pedido de edição consumido.
- `src/main/webPolicy.ts` — os canais de decisão são desktop-only.
- Catálogos: `main.*.json`, `ui-docs.*.json`, `ui-team.*.json` e o prompt `prompt.sdd.suggest.*`.

## Fronteiras respeitadas

A sugestão nunca cria, remove ou reordena etapa do fluxo: a etapa proposta é sempre uma que existe e
`runs:migrateFlow` não é tocado. A v1 não grava história nova nem lê a transcrição das cerimônias. A
recusa guarda a impressão no registro do workspace, fora do repositório. O gancho da retro lê as
decisões e as atas e não transforma melhoria de processo em nada — essa é outra frente.
