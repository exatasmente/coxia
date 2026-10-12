# Plano técnico: regras de aprovação dos passos na tela

Base: `1_SPEC.md` (14 regras, 12 critérios). Tudo abaixo foi conferido por leitura do código; nada foi executado nesta etapa.

## Decisões

1. **Nome na interface: "aprovações dos passos na tela"** (en: "Screen step approvals"; campo `screenPolicy`). Não usa a palavra "autonomia", que já governa outra coisa (`runner.autonomy`, `devCycle.autonomy`, `SquadDef.autonomy`, `AgentDef.autonomous`). Modos exibidos: "Pede aprovação" / "Roda sem pedir".
2. **Forma da política:** `ScreenPolicy = Partial<Record<StepKind, 'held' | 'autonomous'>>`, com `StepKind` = os seis motivos já existentes: `submit | name | shortcut | dialog | unclassified | agent` (`HoldWhy` de `src/shared/browser.ts` + `agent`). Chave ausente = herda do nível seguinte.
3. **Onde mora:** `AgentDef.screenPolicy?`, `SquadDef.screenPolicy?` (opcionais, sem migração de dados) e `runner.screenPolicy` (workspace, padrão `{}`). O workspace fica em `runner` porque o agente e o squad já vivem em `agents`/`squads`; o bloco `runner.autonomy` não é tocado.
4. **Precedência por tipo:** agente > squad do agente > workspace > padrão retido. Função pura `resolveScreenPolicy`, devolve por tipo `{ mode, source: 'agent'|'squad'|'workspace'|'default' }`. Os nomes dos níveis são os que a #268 deve reutilizar no registro.
5. **As quatro categorias (pagamento, envio a pessoas, segredos, cartão) não são chaves da política.** São uma detecção própria (`sensitiveCategory`) que roda **antes** da política e vale para qualquer tipo de passo. Consequência: não existe "liberação armazenada" dessas categorias; o "ignorar com aviso" acontece (a) na tela, (b) na validação, que descarta e avisa chaves `payment|people|secret|card` vindas de arquivo ou importação, e (c) na janela de aprovação, quando um passo liberado é retido por ser sensível.
6. **Vigência = por chamada.** A política é resolvida quando a chamada (etapa ou resposta de conversa) abre a tela, guardada em `CallScreen` e repassada a cada chamada do navegador. Mudança no meio da etapa não altera a etapa em curso; a próxima abre com a nova (regra 9, critério 8). Não se muda a tela da execução (`run:<id>`), que sobrevive entre etapas: a política vai na chamada, não na sessão.
7. **Quem sobe a política não é o navegador pareado, nem modelo, nem importação.** Segue o molde de `screenRaised` em `src/main/configScope.ts`: passar qualquer tipo para `autonomous` por `config:cycle-save` é recusado; baixar é permitido; modelos e importações (`transfer.ts`) nunca trazem `autonomous` (removido com nota).
8. **Registro da mudança** no único ponto por onde toda gravação passa: `saveConfig` (`src/main/workspaceConfig.ts`), comparando a config anterior em memória com a nova. Entrada de auditoria `screen-policy` (via `config`) por tipo mudado, com nível, dono (id do agente/squad ou vazio), antes e depois. Sem config anterior (primeira carga) não registra.
9. **Registro do passo autônomo:** nova entrada `screen-autonomous` em `src/main/browser/audit.ts`, ao lado de `screen-hold` e `screen-confirm`, com `agent`, `place`, `why`, `step`, `site`, `policy: autonomous`, `policyLevel`. É a ligação com a #268: os nomes de campo e de nível ficam definidos aqui e a #268 os adota para os demais passos (comando no host, push, PR…). A ordem de entrega entre as duas não é verificada (ver riscos).
10. **Lista de palavras separada, em tabela, em `src/main/browser/sensitive.ts`** (não se mexe em `IRREVERSIBLE_WORDS`, que continua definindo "nome do controle"). Categorias, conservadoras (na dúvida, retém):
    - pagamento: pay, buy, purchase, order, checkout, transfer, place order, pagar, comprar, pedido, transferir;
    - envio a pessoas: send, share, post, invite, reply, forward, email, message, enviar, compartilhar, postar, convidar, responder, encaminhar, mensagem;
    - segredos: password, passcode, token, secret, otp, senha, segredo, e `probe.type === 'password'`;
    - cartão: card, cvv, cvc, credit, debit, cartao, credito, debito.
    "Salvar rascunho" não cai em nenhuma (critério 2). Limites da heurística continuam os documentados (controle chamado "Ir" que paga não é pego). `publish` e `delete` ficam com a política; a lista é uma tabela e ajustá-la na revisão é barato.
11. **Confirmação do agente** (`screen_confirm`) já traz `kind` (`send|save|delete|publish|pay|other`): `pay` = pagamento e `send` = envio a pessoas, sempre retidos; as palavras livres (`words`) também passam por `sensitiveCategory`. `save|delete|publish|other` seguem o tipo `agent` da política. Liberado e não sensível: a ferramenta responde "sim" sem perguntar e grava `screen-autonomous`.
12. **Passe por site** ("sim para o resto da tela") continua só para `unclassified`, e passa a não valer para um passo sensível (defesa extra; fora disso o comportamento não muda).

## Mudanças, arquivo e função, na ordem

### 1. Tipos e resolução (puro)
- `src/shared/browser.ts`: `STEP_KINDS` (seis, com `agent`), `SENSITIVE_CATEGORIES`, tipo `SensitiveCategory`; `PendingAsk.sensitive?`.
- `src/shared/config/screenPolicy.ts` (novo, exportado em `config/index.ts`): `ScreenPolicy`, `resolveScreenPolicy(config, agent)`, `policyChanges(prev, next)` (lista das mudanças por nível/dono/tipo), `sanitizePolicy(raw)` (descarta chaves desconhecidas e as quatro categorias, devolve também o que descartou), `policyRaised(prev, next)` (para o escopo web). Usa `squadOf` de `squads.ts`.

### 2. Config
- `types.ts`: `AgentDef.screenPolicy?`, `SquadDef.screenPolicy?`, `RunnerConfig.screenPolicy: ScreenPolicy`; `CONFIG_SCHEMA_VERSION` 28 → 29.
- `defaults.ts`: `runner.screenPolicy: {}`.
- `schema.ts`: objeto `screenPolicy` (propriedades dos seis tipos, enum `held|autonomous`) no agente, no squad e em `runner`; `schemaVersion` já usa a constante.
- `migrations.ts`: `v28ToV29` (adiciona `runner.screenPolicy = {}`, nota no log) e entrada `28: v28ToV29` em `STEPS`; comentário da lista de versões.
- `validate.ts`: usa `sanitizePolicy`; chave desconhecida ou de categoria sempre retida vira **aviso** (não erro) e é descartada.
- `team.ts` (normalização do agente) e `squads.ts` (normalização do squad): preservam `screenPolicy` válido, nunca criam.
- `transfer.ts`: exportação/importação de modelo remove `autonomous` e acrescenta nota (como `screen`/`browserProfile`).
- `configScope.ts`: `screenPolicyRaised(was, now)` ligado ao mesmo ponto de `screenRaised`.

### 3. Detecção e decisão
- `src/main/browser/sensitive.ts` (novo): `sensitiveCategory(text)` e `sensitiveTarget(target)` (nomes via `namesOf` + `probe.type`).
- `classify.ts`: `Classification.sensitive?`; um envoltório no fim de `classify()` marca todo passo retido (`irreversible`/`unclassified`) cujo alvo ou foco é sensível. Não muda `class`/`why`.
- `intermediary.ts`, etapa 4: ordem nova da decisão: livre → roda; sensível → pergunta (com `sensitive` no `HoldRequest` quando a política o teria liberado); passe de site (só se não sensível); política `autonomous` para `c.why` → roda e chama `d.gate.autonomous(...)`; senão → pergunta como hoje. `CallOptions.policy?: ResolvedScreenPolicy`, lida uma vez por chamada; sem política = tudo retido.
- `HoldGate` ganha `autonomous(record)` (a implementação em `asks.ts` grava `auditScreen.autonomous` pelo mesmo `sink`); `HoldRequest.sensitive?` vai até `PendingAsk`.
- `audit.ts`: `ScreenAutonomous` + `screenAutonomousEntry` + `auditScreen.autonomous`; `screen-policy` para o registro da mudança.
- `engineTool.ts`: `ConfirmPort` recebe a política; `confirmPortFor` decide auto-sim / pergunta; `BrowserPort.call` aceita `policy` nas opções; `runBrowser` não muda de forma (a política é injetada, ver 4).

### 4. Instantâneo por chamada e prompt
- `callScreen.ts`: `openCallScreen` resolve a política com `rc()` e o agente (o `Pick` do agente passa a incluir `squad` e `screenPolicy`), guarda em `CallScreen.policy`, e embrulha `lease.browser.call` e o `confirm` para injetá-la. `promptFor` passa a política a `screenPromptOf`.
- `screenPrompt.ts`: `ScreenPrompt.policy?` (só os tipos `autonomous` efetivos); `screenRules` acrescenta, depois da regra de `confirm` e antes do `handoff`, uma frase **só quando há tipo liberado** (`runner.rules.screen.policy`, com os tipos por extenso e a lista fixa das quatro categorias). Sem tipo liberado, nenhuma frase: o texto fica idêntico ao de hoje. `screen_handoff` e `runner.rules.screenHandoff*` não são tocados.
- Chave nova `prompt.<modelo>.runner.rules.screen.policy` nos dois catálogos para cada prefixo de modelo que já tem `runner.rules.screen.confirm` (conferir `cyclePrompts.ts` na implementação). Conferir também se o texto atual de `runner.rules.screen` diz "todo" passo irreversível pede aprovação; se disser, a frase nova abre com "Exceção à regra acima:".

### 5. Registro da mudança
- `workspaceConfig.ts` `saveConfig`: antes de trocar `state`, `policyChanges(state?.config, config)` → `recordWrite` por mudança (`kind: 'screen-policy'`).

### 6. Interface (squad Experiência junto)
- `src/renderer/src/screens/team/ScreenPolicyFields.tsx` (novo): grade com os seis tipos; no agente e no squad cada linha tem "Herdar / Pede aprovação / Roda sem pedir"; no workspace "Pede aprovação / Roda sem pedir". Mostra sempre o modo efetivo e o nível de origem (critério 7), calculados com `resolveScreenPolicy` sobre o rascunho. Bloco fixo "Sempre pede aprovação: pagamento, envio a pessoas, segredos e cartão"; ao marcar um tipo como `autonomous`, aviso `role="note"` dizendo isso (critério 5).
- Usado em `ScreenFields.tsx`/`agentEdit.ts` (nível agente, só no desktop, como o restante: `isWeb()` não desenha), `SquadsSection.tsx`/`squadEdit.ts` (squad) e `RunnerSection.tsx`/`runnerEdit.ts` (workspace).
- Janela de aprovação (`askView.ts` e o cartão do ciclo): linha de aviso quando `PendingAsk.sensitive` existe; `askNotice` em `asks.ts` idem. Cores só por tokens de tema.
- Catálogos: `ui-team.{en,pt-BR}.json` (grade, rótulos, avisos), `main.{en,pt-BR}.json` (`main.browser.ask.sensitive.*`, `main.config.screenPolicy.ignored`), `ui-today.{en,pt-BR}.json` (`ui.audit.kind.screenAutonomous`, `ui.audit.kind.screenPolicy`), mais as chaves de prompt do item 4.

### 7. Documentação
- `CHANGELOG.md` (`Unreleased`); `docs/` onde o classificador e a retenção são descritos (localizar por `unclassified` na implementação) e, se a lista de arquivos de config citar `runner.autonomy`, citar o novo campo; `AGENTS.md` não muda.

## Testes (um por comportamento)

| Comportamento | Arquivo |
|---|---|
| Precedência agente > squad > workspace > padrão, por tipo, nível parcial deixa o resto para o seguinte (critério 6) | `test/screen-policy.test.ts` (novo) |
| Padrão retido; `sanitizePolicy` descarta categorias e chaves estranhas com aviso | `test/screen-policy.test.ts` |
| `policyChanges` e `policyRaised` (antes/depois/nível/dono) | `test/screen-policy.test.ts` |
| Detecção das quatro categorias: tabela en/pt, sem acento/caixa, `password`, "Salvar rascunho" livre | `test/browser-sensitive.test.ts` (novo) |
| `classify` marca `sensitive` em "Pagar agora", "Enviar mensagem", campo de senha e de cartão, sem mudar `class`/`why` | `test/browser-classify.test.ts` |
| Sem política, "Enviar pagamento" pede aprovação (critério 1) | `test/browser-intermediary.test.ts` |
| Tipo `name` liberado: "Salvar rascunho" roda sem perguntar e o gate recebe o registro autônomo (critério 2) | `test/browser-intermediary.test.ts` |
| Liberado, "Pagar agora", "Enviar mensagem", senha e cartão seguem perguntando, com `sensitive` no pedido (critérios 3 e 4) | `test/browser-intermediary.test.ts` |
| Passe de site não vale para passo sensível; segue valendo para `unclassified` comum | `test/browser-intermediary.test.ts` |
| Política da chamada fica fixa: trocar a config entre duas chamadas não altera a primeira (critério 8) | `test/browser-call-screen.test.ts` (novo, com fakes de sessões e asks) |
| `screen_confirm`: `pay`/`send`/palavras sensíveis perguntam; `save` com `agent` liberado responde sim e registra | `test/browser-asks.test.ts` |
| Entradas de auditoria `screen-autonomous` e `screen-policy` (campos e nível) | `test/browser-asks.test.ts` e `test/screen-policy.test.ts` |
| Prompt idêntico ao de hoje sem política; com tipo liberado a frase aparece e cita as quatro categorias; `screen_handoff` byte a byte igual (critérios 9 e 10) | `test/prompts-screen.test.ts` |
| Migração v28 → v29 e config nova válida | `test/config-migrations.test.ts` |
| Navegador pareado não sobe a política, pode baixar | `test/config-web-scope.test.ts` |
| Modelo/importação não trazem `autonomous` | `test/config-transfer.test.ts` |
| Agente e squad com `screenPolicy` validam e normalizam | `test/agent-team.test.ts` |
| Grade da tela: seis tipos, modo e origem, mudar o nível atualiza, aviso das quatro categorias (critério 7) | teste de renderização junto dos existentes de `ScreenFieldsView` (nome a confirmar na implementação) |
| Catálogos | `npm run i18n:lint` (critério 11) |

Gate final (critério 12): `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, e `electron-vite build` como no CI.

## Riscos e como se evitam

- **Liberar "nome do controle" liberaria pagamento/envio** (a lista atual mistura os dois). Evitado pela detecção própria antes da política, com teste de tabela e teste de intermediário por categoria. Limite que fica: a heurística é de palavras (idiomas fora de en/pt, controle sem nome, nome genérico passam como "nome do controle" ou livre); a documentação diz isso.
- **Falso negativo em segredo/cartão.** Só nome e `type="password"` são lidos; o atributo `autocomplete` de cartão **não foi verificado** que o `probe` colete. Se não coletar, fica fora desta entrega e documentado como limite; se coletar barato, entra na `sensitiveTarget`.
- **Elevação de privilégio por navegador pareado, modelo ou importação.** Fechado por `screenPolicyRaised` e pela remoção em `transfer.ts`, ambos com teste.
- **Prompt dizendo uma coisa e o app outra.** Prompt e decisão usam o mesmo objeto resolvido, guardado na `CallScreen`; teste compara os dois.
- **Mudança no meio da etapa.** A política é por chamada, não por sessão da tela; teste de instantâneo.
- **Texto do prompt mudar para quem não configura.** A frase só existe com tipo liberado; teste de igualdade com o texto atual.
- **Confirmação do agente liberada vira "sim" automático para o que o agente descrever.** Mitigado: `pay`/`send` e palavras sensíveis sempre perguntam; o resto fica no registro `screen-autonomous`, e o prompt avisa o agente da exceção.
- **Colisão de nome com "autonomia".** Campo `screenPolicy` e rótulos próprios; nenhum campo existente muda.
- **#268.** Os critérios se sobrepõem (registro com política e nível). Esta entrega define `screen-autonomous`, `screen-policy` e os nomes de nível; a #268 deve adotá-los. Se a #268 entrar primeiro com outro formato, o campo é renomeado sem mudar a decisão. O formato real do plano da #268 não foi lido além da spec. A regra 14 (não ir à produção sem a #268) **não pode ser imposta em código**: fica como condição de mesclagem/lançamento, dita no pull request e no CHANGELOG, e é decisão de quem lança.
- **Escritas externas.** Nenhuma nova: a mudança só altera quando o navegador do app pergunta; nada passa a escrever no host de código fora de `Actions`.

## Cobertura dos critérios

1–4 e 8: intermediário, chamada e asks (testes acima). 5: validação, tela e janela. 6: resolução. 7: tela (teste de renderização; conferência visual não feita nesta etapa). 9–10: `prompts-screen`. 11–12: lint e gates. Nenhum critério ficou sem cobertura; os de aparência (janela de aprovação e tela) dependem de verificação visual na etapa de QA.

## Não verificado nesta etapa

Tela de configurações além de `ScreenFields.tsx`; arquivos exatos dos testes de renderização; chaves de prompt por modelo em `cyclePrompts.ts`; coleta de `autocomplete` no `probe`; plano da #268; qualquer execução (tsc, vitest, lints).
