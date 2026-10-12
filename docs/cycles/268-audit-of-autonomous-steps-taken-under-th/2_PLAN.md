# Plano: política e nível em cada passo autônomo, decisões e mudanças de política no registro

## Leitura que sustenta o plano

- `AuditEntry` (`src/shared/auditoria.ts`) tem `by`, mas nenhum campo de política/nível e nenhum tipo para decisão ou mudança de política.
- O log é escrito só por `recordWrite` (`src/main/auditoria.ts`, append em `auditoria.jsonl`). O único canal de leitura é `auditoria:list`. Não há canal de edição ou remoção. Módulos de memória e procedimentos recebem uma porta `audit` que só acrescenta.
- `autonomyOf`/`choiceOn`/`boardAutonomous` (`src/shared/config/autonomy.ts`) são chamados em: `executor.ts` `hostApproval` (comandos no host), `service.ts` `autoGate`, `publish.ts` `chooses` (push e pull request), `boardHost.ts` `send` (quadro), e `flow.ts` `cycleOn` (início de etapa, via `cycleAutonomous`).
- Hoje já geram linha: escrita ao host por `runVcsAuto` (`by`), push (`pushRunBranchAuto`), pull request autônomo (via `runVcsAuto`), quadro (`runNow`). Não geram linha: comando no host (só mensagem no fórum), portão aprovado pelo app, início de etapa, decisão da pessoa sobre passo retido (a aprovação grava a escrita, não a decisão; a recusa em `skipAction` não grava nada), mudança de política.
- Ponto único de mudança de configuração: `saveConfig` em `src/main/workspaceConfig.ts` (usado por `config:save`, `config:cycle-save` e `updateConfig`).

## Mudanças, em ordem

1. **Tipo e política gravada** (`src/shared/auditoria.ts`, `src/shared/config/autonomy.ts`).
   - Novos `AuditKind`: `auto-step` (início de etapa, comando no host, portão), `decision` (passo retido aprovado/recusado), `policy-change`.
   - Campo opcional `policy?: AuditPolicy` em `AuditEntry`: `{ cycle, hostCommands, gates, push, pullRequest, board?, level, flow }`. `level` é `'workspace' | 'flow'` hoje e vem de `EffectiveAutonomy.from`; `flow` é a chave do fluxo (`''` principal, id do squad, `release`).
   - Função pura `auditPolicyOf(config, flowKey)` em `autonomy.ts` e `levelOf(from)`: único lugar que traduz para o nome do nível. Quando a #269 definir agente/squad/workspace, só `levelOf` muda.
   - Campos opcionais: registros antigos continuam válidos e não são reescritos.
   - Para `decision` e `policy-change`, `fields` carrega `decision` (`approved`|`refused`), `before`, `after`; `by` = `person` ou `app`.

2. **Porta de escrita do log** (`src/main/auditoria.ts`).
   - `recordWrite` passa a aceitar `policy` e a escrever sempre `at`, `scrub` nos campos e `cut` no resultado (já faz). Nova função `recordAutoStep(entry)` fina, para o runner receber por injeção (`deps.audit`), sem importar `actions.ts`.
   - Encadeamento à prova de adulteração: cada linha ganha `chain = sha256(chainAnterior + corpo)`; `listAudit` marca `tampered: true` na primeira linha cuja cadeia não fecha. Linhas antigas sem `chain` ficam fora da verificação (início da cadeia na primeira linha com `chain`).

3. **Passos que já escrevem linha ganham a política** (`src/main/actions.ts`).
   - `AutoWrite` e `AuditOrigin` ganham `policy?`; `audited` o copia para a entrada. Chamadores: `boardHost.runNow` (política do workspace, com `board`), `mentions/propose.ts`, `runner/publish.ts` (`door.push`, abertura do pull request) passam `auditPolicyOf(config, flowKeyOf(run.squad))`. Plugins (`by: plugin`) não são política da #269 e ficam sem `policy` (decisão 3).

4. **Passos sem linha hoje** (`src/main/runner/executor.ts`, `service.ts`).
   - Comando no host: em `hostApproval`, quando `auto && !trusted`, uma linha `auto-step` por comando (a mensagem `noteAuto` continua só na primeira; a linha do log é por comando, com o comando já passado por `redact`/`scrub`). Agente = `agent.id`.
   - Portão: em `autoGate`, após `gateBy(..., 'app')` bem-sucedido, linha `auto-step` com agente do estágio julgado.
   - Início de etapa: em `enter` (`transitions.ts`) o fluxo puro decide com `rec.autonomous` e `start`; o registro é feito em `service.ts` `tell`, quando a execução entra num estágio de trabalho com `rec.autonomous` e sem que o `startStage` tenha vindo da pessoa. Para distinguir, `startStage` (pessoa) marca a chamada; o plano exige que o desenvolvedor confirme no código o ponto exato antes de escrever (único item não fechado por leitura).
   - Falha ou recusa: o mesmo ponto grava `ok:false` e `result`; nenhum passo autônomo sai sem linha (regra 6).

5. **Decisões sobre passos retidos** (`actions.ts`, `service.ts`).
   - `approveAction`: linha `decision` `approved` (por `person`) antes da execução, com `ok` refletindo o que a escrita fizer; a escrita segue gravando a sua própria linha.
   - `skipAction`: linha `decision` `refused`, cobrindo recusa de proposta de push, pull request, quadro, comentário. Só quando o estado muda de verdade (a guarda `handled` já existente).
   - Portão decidido pela pessoa (`gateBy` com `by:'person'`) e pergunta de comando no host (`askCommand`, `deny`/`once`/`stage`): linha `decision`.

6. **Mudança de política** (`src/main/workspaceConfig.ts` `saveConfig`).
   - Antes de `writeConfigFile`, compara `runner.autonomy` e cada `devCycle.autonomy[flow]` (inclui `useWorkspace`) do estado atual com o novo. Para cada escolha que mudou, uma linha `policy-change` com `before`, `after`, `level`, `flow`. Na primeira carga (sem estado) não registra. Uma mudança que não toca a política não registra nada.
   - Quem mudou: `person` no `config:save`; o chamador de `updateConfig` informa a origem quando a persona fizer a mudança (por padrão `person`; decisão 4).

7. **Visão do log** (`src/renderer/src/screens/Auditoria.tsx`): mostra `policy` (escolhas ligadas e nível) e os novos tipos, sem tela nova; marca `tampered`. Textos novos por `t()` nos dois catálogos (en e pt-BR); sem cores literais.

8. **Documentação**: `CHANGELOG.md` `Unreleased`; `AGENTS.md` só se alguma instrução ficar falsa (não prevista).

## Testes (fakes, sem rede)

| Comportamento | Arquivo |
|---|---|
| `auditPolicyOf` e `levelOf`: workspace, fluxo, `release`, `board` | `test/autonomy.test.ts` (existente) |
| Comando no host autônomo grava `auto-step` com agente, hora, política e nível; sem autonomia não grava | `test/runner-host-shell.test.ts` (existente) |
| Portão aprovado pelo app e início de etapa autônomo gravam; portão e etapa por pessoa não gravam `auto-step` | `test/runner-flow.test.ts` (existente) |
| Push e pull request autônomos trazem `policy`; mesma etapa sob workspace e sob fluxo mostra níveis diferentes (critério 5) | `test/runner-publish.test.ts` (existente) |
| Escrita do quadro autônoma traz `policy`/`board` | `test/board-host.test.ts` (existente) |
| `approveAction`/`skipAction` gravam `decision` aprovado/recusado; recusado não executa a escrita | `test/actions-group.test.ts` (existente) |
| Mudar política (workspace e depois fluxo) grava uma linha por mudança com antes, depois e nível; mudança sem relação e primeira carga não gravam | `test/audit-policy.test.ts` (novo) |
| A persona não tem como apagar/editar: não há canal `auditoria:*` além da leitura; ferramentas e portas de auditoria dos módulos só acrescentam; `listAudit` detecta linha alterada ou removida (`tampered`); registro antigo sem `policy` continua lendo | `test/audit-policy.test.ts` (novo) |
| Paridade dos catálogos e textos novos | `npm run i18n:lint` |

Gates antes de entregar: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`. Nenhum foi rodado nesta etapa.

## Riscos

- **Agente com shell no host alcança o arquivo.** Um agente `shell: host` roda como a pessoa e pode, em tese, editar `auditoria.jsonl` pelo sistema de arquivos. O app não impede isso no nível do sistema operacional. Mitigação: cadeia de hash com detecção (`tampered`) e teste; o critério 3 fica cumprido para as ferramentas e canais da persona, não como proteção do sistema de arquivos. Dito na spec/PO como limite conhecido.
- **Registro que falha não pode virar falha do passo.** `recordWrite` já engole o erro; manter, e o teste cobre disco indisponível sem derrubar o passo. Efeito colateral: um passo autônomo pode sair sem linha se o disco falhar; mitigação: o erro vai ao console e o teste fixa o comportamento.
- **Segredos no log.** Comando e campos passam por `scrub`/`cut`; teste com um token falso no comando.
- **Volume.** Uma linha por comando autônomo aumenta o log; retenção está fora do escopo; `listAudit` já limita a 2000.
- **Colisão com a #269.** Ela mexe em `autonomy.ts` e na config (tipos/defaults/schema); esta mudança não altera o esquema de configuração, só lê. Ordem: mesclar esta antes ou junto, e `levelOf` é o único ponto a ajustar.
- **Dupla gravação de decisão e escrita.** A aprovação grava `decision` e a escrita grava a sua linha: intencional, ligadas pelo `origin.actionId`.

## Decisões

1. Política gravada como campo `policy` opcional, não kinds novos para cada passo já auditado: preserva a leitura de registros antigos e a visão existente.
2. `level` = `workspace|flow` por ora; tradução isolada em `levelOf` para a #269.
3. Plugins ficam sem `policy`: a autonomia deles não é a política de cinco escolhas.
4. Mudança de política é gravada em `saveConfig` (ponto único), com `by:person` por padrão.
5. Cadeia de hash entra; se o revisor achar grande demais, corta-se só a detecção e o resto fica.
6. Sem tela nova de consulta (proposta da spec mantida).

## Critérios de aceite

Cobertos: 1 a 7 da spec. O critério 3 cobre as ferramentas e canais da persona e a detecção de adulteração, não a proteção contra um agente com shell no host (ver risco). A lista de passos autônomos segue sem confirmação contra o texto completo do product owner (truncado).
