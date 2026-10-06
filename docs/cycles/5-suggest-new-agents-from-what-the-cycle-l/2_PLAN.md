# O plano técnico: um agente novo nasce do histórico da execução e espera em Ações

## 1. O que muda, em uma frase

Uma função pura lê os arquivos que o app já grava (runs, atas e fórum), agrupa as repetições por
impressão (papel + etapa + tipo de evidência), monta uma sugestão de agente com nome, papel, etapa
existente, rascunho de prompt e permissões no mínimo, e a deixa como uma proposta de um tipo novo em
Ações, com a evidência à vista; aceitar cria o agente no time, editar abre o editor já preenchido e
recusar guarda o motivo — e a decisão fica num arquivo de registro do espaço de trabalho. Nada é
gravado no repositório, nada é aplicado sem o "sim" e nada de história nova é escrito na v1.

## 2. O que a leitura desta etapa confirmou

Tudo abaixo foi lido no código desta árvore. Nada foi executado, nenhum teste rodou, o app não foi
aberto e nenhum modelo foi chamado; ver a seção 9.

| Fato | Onde |
|---|---|
| `AgentDef` é a entidade a criar: `id`, `name`, `job`, `model`, `stages`, `permission`, `tracker`, `shell`, `autonomous`, `turnsTo`, `squad`, `instructions`, `system` | `src/shared/config/types.ts:512-548` |
| `newAgent` preenche tudo menos o `id` e nasce `permission: 'read'`, `tracker: 'none'`, `shell: 'none'`, `autonomous: false` — já é o mínimo da Regra 5 | `src/shared/config/team.ts:38-56` |
| `addAgent` recusa id reservado, inválido ou duplicado; `isSystemId` protege os cinco agentes do app | `src/shared/config/team.ts:12,84-91` |
| A etapa que a sugestão cobre é uma `StageDef` de `devCycle.stages` (e dos fluxos de squad, `devCycle.flows`), com `id`, `type`, `agentId` | `src/shared/config/types.ts:203-234,414-424` |
| `stageAgent` resolve quem trabalha uma etapa (o `agentId` da etapa, senão o primeiro do time que a lista) — o que a proposta aponta | `src/shared/config/team.ts:68-73` |
| A execução fica em `<dados>/workspaces/<id>/runs/<id>.json`, um JSON conferido contra esquema a cada leitura, com `stages`/`attempts`, `returns`, `reviews`, `qa`, `history`, `question` | `src/main/runs-core.ts:1-91`, `src/shared/runs/types.ts:337-393` |
| As fontes por execução são campos gravados: `StageRecord.attempts`/`status` (`skipped`), `Run.returns` (devoluções por etapa), `Run.reviews[].findings[].severity`, `Run.qa[].scenarios[].result`/`.severity`, `Run.history[]` (`question`, `answer`, `handback`, `sent-back`, `gate-rejected`, `gate-skipped`, `stage-returned`), `Run.question` (`needs-person` chega quando o `holder` é nulo) | `src/shared/runs/types.ts:21-36,87-97,148-232,357-364` |
| A devolução por etapa e o limite são gravados em `Run.returns` e comparados com `FlowStage.roundLimit` na transição | `src/shared/runs/transitions.ts:436-456`, `src/shared/runs/types.ts:424` |
| O pedido de comando a uma pessoa vive só em memória (`commands`, `PendingCommand`), e é a linha de auditoria (`kind: 'exec'`) que sobra, com `by` = agente e `target` = comando | `src/main/runner/service.ts:269-309`, `src/main/runner/executor.ts:236-249`, `src/shared/runs/types.ts:59-66`, `src/shared/auditoria.ts:1-19` |
| A linha de auditoria fica em `<dados>/workspaces/<id>/auditoria.jsonl`, lida por `listAudit()` (mais recente primeiro, cortada em 2000) | `src/main/auditoria.ts:41-51` |
| As decisões e efeitos das cerimônias ficam nas atas (`SavedCeremony.decisions`/`.effects`) e em `historico/<id>.json`; a retro também é gravada por dia em `retros/<id>.json` | `src/shared/types.ts:237-259`, `src/main/historyFiles.ts:6-32`, `src/main/retro.ts:17-53` |
| A retro já é o momento em que a conversa levanta propostas: `askRetro` chama `proposeRetroIssues` antes de gravar | `src/main/retro.ts:176-190`, `src/main/retroIssues.ts:61-102` |
| Uma proposta aparece em Ações por `proposeVcsAction`/`blank`/`write`; `write()` emite o evento `actions` e a tela a mostra; uma proposta sem comando já existe (`sync`, `qa-comment`), então um tipo interno novo cabe no mesmo caminho | `src/main/actions.ts:85-106,120-197,295-297` |
| `approveAction` roteia por `kind`; um `kind` novo precisa de um ramo próprio (como `run-push` e `release-git` têm) | `src/main/actions.ts:481-548,943-975` |
| O que a pessoa vê num cartão comum vem de `summary` (título), `issueTitle`/`stage` (subtítulo, só quando há um) e `output` num `<pre>` | `src/renderer/src/screens/Actions.tsx:21-38,78-131` |
| Os cartões de proposta do runner são desenhados por `RunProposal`, escolhido por `proposalPurpose(a)`; um `unit.purpose` desconhecido cai no cartão comum | `src/renderer/src/screens/cycle/RunProposal.tsx:11-56`, `src/shared/runs/proposal.ts:9-92` |
| A escrita externa passa por `assertExternalWrite` e é recusada num espaço de trabalho de teste; `approveAction` já a chama antes de tudo | `src/main/workspace.ts:8-21`, `src/main/actions.ts:482` |
| O botão de Configurações › Time é a aba Time do editor, que hoje salva por `config:save`/`config:cycle-save` | `src/renderer/src/screens/team/TeamSettings.tsx`, `src/main/configModule.ts:58-71` |
| Uma mudança de configuração exige um passo em `STEPS` e o trio `types.ts`/`defaults.ts`/`schema.ts` | `src/shared/config/migrations.ts:250-251`, `src/shared/config/types.ts:5`, `src/shared/config/defaults.ts`, `src/shared/config/schema.ts` |
| Os testes do runner montam o mundo com `boot`, `makeForge` e um mock de `askAgent`; as propostas têm teste próprio | `test/helpers/runner.ts:243-306`, `test/retro-issues.test.ts:14-31` |

## 3. Desenho fechado

### 3.1 A etapa que o agente cobriria é sempre uma etapa existente

A spec (Regra 4) já decidiu: a sugestão aponta uma etapa que existe. Nenhum caminho novo de fluxo é
preciso — **não se cria, remove nem reordena etapa**. A leitura da etapa é `devCycle.stages` do
workspace e os fluxos de squad (`devCycle.flows`), reduzidos aos `id` existentes. A sugestão guarda
o **id** da etapa, nunca uma cópia da etapa; se a etapa sumir do ciclo antes de o cartão ser aceito, o
aceite é recusado com um motivo em vez de criar um agente que aponta para o nada (`stageAgent` volta
`null`, seção 4.3).

Fronteira com `runs:migrateFlow` (`src/main/runner/service.ts:800-810`): nada a ver. Aquele caminho
move uma execução em andamento para o fluxo atual do workspace e não é tocado por esta mudança; esta
mudança não altera o fluxo e, portanto, não pode quebrar uma execução em curso nem pedir migração.

Se a etapa não tiver agente hoje, a sugestão é ainda mais forte (um agente novo a cobriria); se já
tiver um, a sugestão só se levanta quando o padrão for "o agente da etapa devolve ou é substituído à
mão", e o cartão diz isso na evidência.

### 3.2 De onde a sugestão é derivada, fonte por fonte

Uma função pura, `gatherEvidence(input)`, lê os arquivos já gravados e devolve uma lista de
**achados** (`Finding`), cada um com `{ source, kind, stage, agent, at, ref, count, link, text }`.
As fontes, e a estrutura exata de cada uma:

| Fonte | O que se lê | Como vira achado |
|---|---|---|
| Perguntas `needs-person` do mesmo tema | `Run.question` (quando `kind` é `agent`/`squad` e chega à pessoa) e `Run.history` com `type: 'question'`/`'answer'`; o tema é o texto normalizado (minúsculas, sem acento, sem pontuação), agrupado pelo `kind` e por palavras-chave | `kind: 'needs-person'`, `count` = execuções distintas com o mesmo tema; link = a execução e a mensagem |
| Devoluções repetidas para a mesma etapa pelo mesmo motivo | `Run.returns` (contagem por etapa que devolveu), `Run.reviews[].findings[]` com `severity: 'blocking'`, `Run.qa[].scenarios[]` com `result: 'fail'` e `severity: 'blocking'`; o motivo é a etapa de destino (`returnsTo`) | `kind: 'returns'`, `count` = soma das devoluções para a mesma etapa/destino entre execuções |
| Rodadas de revisão e cenários de QA que repetem o tipo de achado | `Run.reviews[]` (rodadas) e `Run.qa[].scenarios[]` agrupados pelo nome do cenário normalizado e pelo `severity` | `kind: 'review-rounds'` / `'qa-scenarios'`, `count` = repetições do mesmo cenário/tipo entre execuções |
| Etapas que a pessoa assumiu à mão | `Run.stages[]` com `status: 'skipped'`; `Run.history[]` com `type: 'gate-skipped'`, `'gate-rejected'`, `'stage-returned'`, `'sent-back'` e `by: 'person'`; uma `answer` da pessoa em uma pergunta que devia ter ido a um agente | `kind: 'manual-stage'`, `count` = vezes que a pessoa fez o trabalho da etapa |
| O mesmo comando permitido de novo e de novo | `auditoria.jsonl` (`listAudit()`), linhas com `kind: 'exec'`, `via: 'host'`/`'sandbox'`, `ok: true`, agrupadas pelo `target` (o comando normalizado) e pelo `by` (agente) | `kind: 'command'`, `count` = quantas vezes o mesmo comando foi autorizado/rodou; link = a execução (`fields.run`) |
| Decisões e atas das cerimônias | `SavedCeremony.decisions`/`.effects` via `getHistory`/`listHistory` e os arquivos `historico/<id>.json`; a retro (`retros/<id>.json`) já traz `worked`/`stuck`/`rework` e a conversa | `kind: 'ceremony-decision'`, `count` = decisões do mesmo tema entre atas; link = a ata |

Duas observações que fecham os pontos abertos do refino:

- **A peça que hoje só existe pela linha de auditoria.** Confirmado: `PendingCommand` não é gravado
  (`src/shared/runs/types.ts:59`), e o pedido de comando só entra no fórum (`service.ts:302,776`). A
  única fonte persistente de "o mesmo comando de novo e de novo" é `auditoria.jsonl` (`kind: 'exec'`).
  A v1 lê essa linha (Regra 1: lê só o que já existe). Se a linha não existir (uma versão antiga sem
  auditoria), essa fonte simplesmente não produz achado — não se grava nada novo para alimentá-la.
- **`needs-person` não é um campo.** Chega-se a ela pela cadeia: `Run.question.holder` nulo e
  `kind` `agent`/`squad` significam que a pergunta desceu até a pessoa; `Run.history` com
  `question`/`answer`/`handback` diz quando. O plano lê esses campos; não inventa um `needs-person`.

O agrupamento por **impressão** (Regra 8) é `{ role, stage, evidenceKind }` — não o texto da sugestão,
nem o `count`. É a chave com que o registro decide se uma recusa anterior já viu esta evidência.

### 3.3 Onde o registro da decisão é gravado, e como a impressão barra a volta

Um arquivo novo por espaço de trabalho, irmão de `acoes.json`: `<dados>/workspaces/<id>/suggestions.json`
(nome de arquivo curto e neutro, ao lado do que já existe; nada vai para o repositório). Forma:

```ts
interface SuggestionRecord {
  id: string;                 // id estável do cartão (o mesmo entre a proposta e a decisão)
  impression: string;         // chave: papel + etapa + tipo de evidência (normalizados, unidos por ":")
  proposed: { name: string; role: string; stage: string; prompt: string; permission: 'read' };
  evidence: Finding[];        // os achados que a produziram, com ref/link/count
  decision: 'accepted' | 'rejected' | 'edited';
  reason: string | null;      // o motivo da recusa, opcional
  by: string;                 // 'person'
  at: string;                 // ISO
  agentId: string | null;     // o agente criado (aceite) ou o id que o editor salvou (edição)
  evidenceKey: string;        // hash do conjunto de achados (refs), para saber se a evidência é nova
}

interface SuggestionsStore {
  records: SuggestionRecord[];
}
```

- **Aceitar** grava `decision: 'accepted'` com o `agentId` criado e o `evidenceKey` de então.
- **Editar** grava `decision: 'edited'` com o agente salvo pelo editor.
- **Recusar** grava `decision: 'rejected'`, `reason` (opcional) e o `evidenceKey`.
- **Bloqueio da volta** (Regra 8): ao montar uma sugestão nova, se existir um registro com a mesma
  `impression` e `decision: 'rejected'`, a sugestão só é oferecida quando o `evidenceKey` novo tiver
  pelo menos uma execução/ata/mensagem que o `evidenceKey` recusado **não** citava. Nesse caso o
  cartão diz que já foi recusada antes, quando (`at`) e o que mudou (a evidência acrescentada).
  Sem evidência nova, nada é oferecido — é a leitura de "a mesma impressão só volta com evidência
  nova".

Nenhum prazo: os registros ficam. Uma sugestão aceita não volta (o agente já existe); o registro do
aceite fica junto do `agentId` para o histórico.

**Migração?** Não: `suggestions.json` não vive na configuração, então não entra em `STEPS` nem no
trio `types.ts`/`defaults.ts`/`schema.ts` (essa exigência vale para `config.json`, não para os dados do
espaço de trabalho). O arquivo nasce ausente e é criado no primeiro registro, como `acoes.json`. Se um
campo novo da configuração fosse necessário (não é nesta mudança), aí sim o passo e o trio seriam
exigidos.

### 3.4 Como a proposta aparece em Ações

A proposta **não** reusa `proposeVcsAction`: essa função exige um `VcsCommand` e valida uma escrita no
host. A sugestão não escreve nada no host — ela cria um agente local. Então:

- Um tipo de ação novo, `kind: 'suggest-agent'`, em `ActionKind` (`src/shared/types.ts:392`), e uma
  função própria `proposeAgentSuggestion(...)` em `src/main/actions.ts`, no molde de `proposeRunPush`
  (`:943-961`): deduplica por `key`, chama `blank()`, faz `write()`, emite o evento `actions` e
  notifica. `unit` guarda `{ purpose: 'suggest-agent', suggestionId }`.
- O cartão comum de Ações já mostra `summary` como título, o subtítulo e `output` num `<pre>`
  (`Actions.tsx:21-38,78-131`). O `output` carrega, em seções curtas: nome, papel, etapa, o rascunho
  do prompt, as permissões propostas e a **evidência**, com um link por execução/mensagem/ata.
  O subtítulo só aparece quando há `issueTitle`/`stage` (`Actions.tsx:91`), então a proposta usa
  `stage` = a etapa proposta e `issueTitle` vazio, ou nenhum — a decidir no detalhe da implementação.
- `approveAction` ganha um ramo para `suggest-agent` (como tem para `run-push`): **aceitar cria o
  agente** via `addAgent` sobre a configuração atual, grava o registro e não chama `assertExternalWrite`
  (não é escrita no host — criar agente é local). O "aceitar" **não** abre o editor.
- **Editar** e **recusar** são caminhos separados do cartão comum de Aprovar/Pular:
  - Editar: um botão no cartão abre Configurações › Time com o editor já preenchido pela sugestão
    (nome, papel, etapa, prompt, permissões mínimas); salvar chama o `config:save`/`config:cycle-save`
    de sempre e grava o registro `edited` por um canal novo (`suggestions:decide`).
  - Recusar: um botão com um campo de motivo opcional; grava o registro `rejected` e marca a ação como
    pulada (sem qualquer escrita externa).
- Uma sugestão **não** deve usar `approveAction` do cartão comum sem esse ramo novo, senão cairia no
  ramo genérico de publicação. Por isso o ramo novo é obrigatório.
- O canal `suggestions:decide(id, decision, reason?)` e o `suggestions:suggest()` (o botão) ficam
  **desktop-only** como `config:save`; um navegador pareado não cria agente. A leitura do estado da
  proposta (o registro) pode ficar aberta como os demais reads.

### 3.5 O botão em Configurações › Time e o gancho do fim da retro

- **Botão.** Na aba Time (`TeamSettings.tsx`), um botão **Sugerir agentes** chama
  `suggestions:suggest()`. A resposta é a lista de sugestões criadas (nenhuma, uma ou várias) e um
  motivo quando não há nenhuma ("histórico insuficiente"); a tela diz isso. O botão respeita a Regra
  10: só quando a pessoa pede.
- **Gancho do fim da retro.** A retro termina quando a conversa da retro é usada; hoje `askRetro`
  (`retro.ts:176-190`) é o único ponto por onde a conversa passa. O gancho natural é depois de
  `proposeRetroIssues` (que já é o padrão da retro levantar uma proposta), chamando
  `suggestFromRetro(retro)` — no máximo duas sugestões (Regra 10), só as acima do limiar e que não
  batem com recusa. A retro #16 é vizinha em forma (proposta em Ações, gancho do fim da retro), mas
  **não se herda o conteúdo dela**: nada de melhorias de processo viram issue aqui; aqui só se olha o
  que a retro registrou para alimentar os achados da fonte "cerimônias".
  - A retro do workspace e a de squad: o gancho vale para a retro que acabou de ser gravada, coerente
    com `latestRetro(squad)`; um filtro pelo `squad` da retro evita misturar insumos.
- Fora desses dois momentos (o pedido e o fim da retro), nenhuma sugestão é oferecida. Nunca no meio
  de uma execução nem de cerimônia: a função de leitura só é chamada por esses dois gatilhos.

### 3.6 Limiar e modelo

- **Agrupamento puro primeiro, modelo depois.** `gatherEvidence` + `scoreFindings` são funções puras
  que filtram pelo **limiar** (um mínimo de repetições, ex.: 3 ocorrências em execuções distintas e 2
  fontes, valor final na implementação) e produzem as impressões acima do limiar. Só o que passa vira
  chamada de modelo.
- **Montar a sugestão** (nome, papel, rascunho de prompt) é uma chamada de agente de um papel que só
  lê, com a evidência no prompt e um esquema estruturado (nome, papel, id de etapa existente, prompt) —
  no molde de `askAgent` que `retro.ts` usa. A etapa proposta é validada contra os `id` do
  `devCycle.stages`/`flows` antes de virar cartão; uma etapa inexistente descarta a sugestão.
- Sem evidência acima do limiar, nenhuma chamada de modelo é feita e nada é oferecido (Regra 2/3).
- Isto é o desenho; o comportamento do modelo (se ele devolve uma sugestão útil) **não foi verificado**
  — exige execução real e fica para a revisão e o QA.

## 4. Contratos

### 4.1 Arquivo novo `src/main/suggestions.ts`

- `readSuggestions(): SuggestionsStore` / `writeSuggestions(s)` — atômico (tmp + rename), no molde de
  `read`/`write` de `actions.ts:85-97`.
- `impressionOf(role, stage, evidenceKind): string` — normaliza (minúsculas, sem acento) e une.
- `evidenceKeyOf(findings): string` — hash estável das refs ordenadas.
- `blockedByRejection(store, impression, evidenceKey): { at: string; changed: string[] } | null`.
- `gatherEvidence(input): Finding[]` — puro; recebe `runs`, `audit`, `ceremonies`/`retros` já lidos
  (nada de I/O dentro: a leitura fica nos módulos), para ser testável com objetos.
- `scoreFindings(findings, threshold): Impression[]`.
- `suggestAgents(deps, { source: 'button' | 'retro', retro?: Retro, max?: number }): Promise<ReleaseAction[]>`.

### 4.2 `src/main/actions.ts`

- `ActionKind` ganha `'suggest-agent'`.
- `proposeAgentSuggestion(input)` no molde de `proposeRunPush`.
- Ramo em `approveAction` para `suggest-agent`: valida a etapa, `addAgent`, grava o registro, devolve a
  ação concluída. Sem `assertExternalWrite`.
- `skipAction` para `suggest-agent` exige (ou aceita) o motivo opcional e grava o registro `rejected`.
  A tela de recusa é um botão próprio, para o motivo não se perder.

### 4.3 `src/main/team` e a criação

- Aceitar usa `addAgent(getConfig(), newAgent({ id, name, job, stages: [stage], permission: 'read', ... }))`
  e `updateConfig(...)`; `id` derivado do nome (slug) com desambiguação contra `agents.team` e
  `isSystemId`. Se a etapa não existir mais, recusa com motivo.
- `permission: 'read'`, `tracker: 'none'`, `shell: 'none'`, `autonomous: false` — o mínimo da spec.

### 4.4 Canais e tela

- `suggestions:suggest()` — desktop-only; devolve `{ actions: ReleaseAction[]; reason?: string }`.
- `suggestions:decide(id, decision, reason?)` — desktop-only; `decision` é `'accepted' | 'edited' |
  'rejected'`.
- A aba Time ganha o botão e o estado da última chamada; o cartão em Ações ganha os três caminhos.

### 4.5 Catálogos

Toda string nova (`main.suggestions.*` para o main, `ui.team.suggest.*` e `ui.actions.suggest.*` para a
fila tela) nos **dois** catálogos (`en.json` e `pt-BR.json`), o texto do cartão (nome, papel, etapa, prompt,
permissões, evidência, "recusada antes em {when}, mudou {what}") incluso. Tema por tokens, nunca cor
literal.

## 5. Ordem de trabalho (commits)

Cada commit deixa a árvore verde nos gates da seção 7.

1. `feat: read the cycle history into suggestions` — `src/main/suggestions.ts` (leitura pura, limiar,
   impressão, evidência) + `test/suggestions.test.ts` com fixtures de runs/auditoria/atas. Nada de
   tela, nada de modelo.
2. `feat: record and block a suggestion decision in the workspace data` — o registro
   `suggestions.json`, `blockedByRejection`, `suggestions:decide`, a criação do agente pelo aceite e o
   rascunho do modelo. Testes do registro e do bloqueio da recusa.
3. `feat: offer the agent suggestion as a proposal in actions` — `kind: 'suggest-agent'`,
   `proposeAgentSuggestion`, o ramo de `approveAction`, o botão em Configurações › Time e o gancho do
   fim da retro. Testes de proposta → aceitar cria agente, editar grava, recusar guarda o motivo,
   retro levanta no máximo duas.

## 6. Testes

`test/suggestions.test.ts` (novo), no molde de `test/runner-squads-publish.test.ts` mais `boot` de
`test/helpers/runner.ts:293-306` e o mock de `askAgent` de `test/retro-issues.test.ts:14-21`:

1. **Fonte por execução** — grava runs com `returns`/`reviews`/`qa`/`history` repetidos e confere os
   achados e o agrupamento por impressão; abaixo do limiar, lista vazia.
2. **Fonte comando** — grava linhas `kind: 'exec'` no `auditoria.jsonl` e confere o achado `command`
   com o `count` certo; sem linha, nenhum achado.
3. **Fonte cerimônia** — grava uma ata (`historico/<id>.json`) com decisões repetidas e confere o achado.
4. **Sem evidência, sem sugestão** — nenhum achado acima do limiar não chama o modelo e não cria ação.
5. **Proposta** — com o mock do modelo, `suggestions:suggest()` cria ações `kind: 'suggest-agent'` com
   `summary`, `output` com evidência e link, permissões no mínimo; deduplicação por `key`.
6. **Aceitar** — `approveAction` cria um agente comum (`system: false`, `permission: 'read'`,
   `shell: 'none'`, `stages: [etapa]`) e grava o registro `accepted` com o `agentId`; a etapa inexistente
   recusa com motivo.
7. **Recusar** — grava `rejected` com o motivo; a mesma impressão não volta sem evidência nova; com uma
   execução nova na evidência, volta e o cartão diz que já foi recusada, quando e o que mudou.
8. **Fim da retro** — o gancho levanta no máximo duas, só as do limiar e sem bater com recusa; a
   conversa da retro não ganha melhoria de processo (fronteira com a #16).
9. **Espaço de trabalho de teste** — o cartão aparece; aceitar/editar/recusar não escrevem ao host
   (não são escrita externa); nenhuma chamada de rede.

Atualizações: `test/main-catalogs.test.ts` e `test/i18n.test.ts` cobrem a paridade das chaves novas;
`ActionKind` novo exige conferir o mapa `STATE_LABEL`/`title`/`what` de `Actions.tsx` e o
`DESKTOP_ONLY` de `webPolicy.ts` (um teste de política já percorre os canais).

## 7. Gates

Um commit só está pronto com os cinco do `CLAUDE.md` verdes, mais o build do CI:

```
nvm use
npx tsc --noEmit
npx vitest run
node scripts/theme-audit.mjs
npm run i18n:lint
node scripts/public-audit.mjs
electron-vite build
```

`public-audit` importa: nenhuma fixture pode trazer host, pessoa, número de issue real ou segredo — a
evidência é dos dados de teste, com placeholders (`group/project`, `#123`).

## 8. Riscos e como são cobertos

1. **A leitura do histórico é grande e pode ficar lenta.** Cobertura: a leitura é por workspace, com
   `RunStore.list()` já ordenado; o limiar corta cedo; a proposta é a pedido ou no fim da retro, nunca
   no meio de uma execução. **Não verificado** em volume real.
2. **Fonte comando fraca.** Só a linha de auditoria sobra. Cobertura: sem linha, nenhum achado; nada de
   história nova. Risco aceito e registrado (é o que o refino pediu para fechar).
3. **O modelo pode devolver uma etapa inexistente ou um prompt ruim.** Cobertura: a etapa é validada
   contra os `id` do ciclo antes do cartão; uma etapa fora é descartada. O prompt é rascunho: o aceite
   cria um agente comum e editável.
4. **Um `kind` novo pode cair no ramo genérico de `approveAction`.** Cobertura: ramo próprio, testado;
   a proposta não tem `command`, então um ramo faltante falharia visivelmente no teste.
5. **Criar agente pelo aceite é uma escrita local, não externa.** Cobertura: o aceite não passa por
   `assertExternalWrite` (correto: nada sai da máquina), mas grava o registro e respeita a validação de
   `addAgent` (id reservado/duplicado/inválido).
6. **Misturar com a #16 (melhorias da retro viram tarefa).** Cobertura: o gancho da retro só chama
   `suggestFromRetro`, que lê as decisões/atas; nada de melhorias virando issue; teste 8 fixa a fronteira.
7. **Strings de interface fora do `t()` ou cor literal.** Cobertura: os gates `i18n:lint` e
   `theme-audit`, e a paridade de chaves nos dois catálogos.
8. **Vazamento no arquivo de registro.** O `suggestions.json` fica nos dados do workspace, nunca no
   repositório; nenhum dado real de pessoa em fixture, e o `public-audit` barra o resto.

## 9. O que esta etapa não verificou

Nada foi alterado nem executado: nenhum gate foi rodado, nenhum teste, nenhum build, o app não foi
aberto e nenhum modelo real foi chamado. Tudo acima é leitura de código e de documentos — conferida no
código desta árvore, linha a linha, na coluna "Onde" da seção 2. Em particular, **não verificado**: se o
modelo devolve uma sugestão útil a partir da evidência; se o volume de histórico real torna a leitura
lenta; se o limiar escolhido é o certo; se o cartão de Ações renderiza a evidência com links como
descrito; e se o gancho do fim da retro cobre todas as famílias de retro. Os documentos referenciados
fora do repositório (as regras do workspace) não puderam ser lidos nesta etapa: só se leu o que está
dentro desta árvore.

## 10. Registro de decisões

1. **A sugestão nasce de função pura sobre arquivos já gravados, sem I/O dentro da função.** Permite
   testar com objetos e mantém a leitura onde ela já mora.
2. **Um `kind` de ação novo, não `proposeVcsAction`.** A sugestão não escreve no host; reusar a
   proposta de VCS exigiria um `VcsCommand` falso e passaria pela validação de escrita externa.
3. **O registro num arquivo próprio (`suggestions.json`), não na configuração.** É dado do espaço de
   trabalho, sem migração de schema e sem tocar o repositório.
4. **A impressão é `papel + etapa + tipo de evidência`.** É o que a spec fixou (Regra 8) e o que
   permite o bloqueio da recusa sem bloquear uma evidência nova.
5. **A etapa é sempre existente; nenhum caminho de fluxo novo.** Fronteira explícita com
   `runs:migrateFlow`, que não é tocado.
6. **O aceite não abre o editor.** Aceitar cria o agente comum direto (Regra 9); editar é o outro
   caminho, que abre o editor preenchido.
7. **Os canais de decisão são desktop-only.** Criar agente é um efeito local; um navegador pareado não
   o faz, como não salva configuração.
8. **O gancho da retro herda só a forma da #16 (proposta em Ações no fim da retro), não o conteúdo.**
