# Aprovações dos passos na tela: o que foi construído

## O que mudou (por passo do plano)

1. **Tipos e resolução** (`src/shared/config/screenPolicy.ts`, exportado em `config/index.ts`): `ScreenPolicy`, `resolveScreenPolicy` / `resolveLevels` (agente > squad > workspace > padrão retido, tipo a tipo), `releasedKinds`, `runsAlone`, `sanitizePolicy`, `heldOnly`, `releasedIn`, `screenPolicyChanges`, `policyRaised`. `STEP_KINDS` e `SENSITIVE_CATEGORIES` em `src/shared/browser.ts`.
2. **Config v29**: `AgentDef.screenPolicy?`, `SquadDef.screenPolicy?` e `runner.screenPolicy` (padrão `{}`), schema, migração `v28ToV29` e normalização em `newAgent`/`newSquad`. A validação descarta com **aviso** uma chave desconhecida ou de categoria (`payment|people|secret|card`).
3. **Detecção** (`src/main/browser/sensitive.ts`): tabela en/pt das quatro categorias, mais o tipo `password` do campo. `classify()` marca `sensitive` sem mudar `class`/`why`.
4. **Decisão no intermediário**, nesta ordem:
   - livre: roda;
   - sensível: pergunta (com `sensitive` no pedido quando a política o liberaria);
   - passe do site: só se não for sensível;
   - tipo liberado: roda, `gate.autonomous` grava `screen-autonomous`, e o registro de passos marca `autonomous`;
   - senão: pergunta como hoje.

   Confirmação do agente (`confirmPortFor`): `pay`/`send` e palavras sensíveis sempre perguntam; o tipo `agent` liberado responde "sim" e grava `screen-autonomous`.
5. **Por chamada** (`callScreen.ts`): `policyOf` lê a config quando a chamada abre a tela e guarda em `CallScreen.policy`. A mesma política vai em cada `browser.call` e no `confirm`, e `promptFor` a repassa ao prompt. Prompt (`screenPrompt.ts`): a frase `runner.rules.screen.policy` ("Exceção aos passos segurados acima…") só aparece com tipo liberado que a chamada pode dar; sem isso o texto é o de hoje.
6. **Registro da mudança**: `saveConfig` chama `auditPolicyChanges` (uma linha `screen-policy` por tipo mudado, com nível, dono, antes e depois). A primeira carga não grava.
7. **Escopo e arquivos**:
   - navegador pareado: `screenPolicyRaised` recusa liberar um tipo ou tirar uma retenção no agente/squad; `runner.screenPolicy` não é editável pelo navegador pareado;
   - modelos: `apply.ts` guarda só as retenções, com aviso;
   - importação de config: lista as liberações em `collectCommands`.
8. **Interface**:
   - `ScreenPolicyFields.tsx`: seis tipos, modo, nível de origem, bloco fixo das quatro categorias e aviso quando há liberação. Aparece no editor de agente, de squad e do workspace, só no computador;
   - janela de aprovação (`AskCard`) e notificação (`askNotice`) dizem por que um tipo liberado pergunta assim mesmo;
   - tela de auditoria: tipos `screen-autonomous` e `screen-policy`;
   - textos nos dois catálogos (main, ui-team, ui-today).
9. **Docs**: `CHANGELOG.md` (Unreleased › Added, com a condição da #268) e `docs/configuration.md` (v29 e o campo).

## Diferenças em relação ao plano

- `HoldGate.autonomous` é opcional: uma tela sem política (testes, ferramentas) não precisa dele. O gate real (`asks.ts`) o implementa.
- A política vai para o navegador por um envoltório em `openCallScreen`; `BrowserPort` não mudou.
- O agente é procurado pelo id na config da chamada, não pelo `Pick` do pedido.
- Os testes de resolução ficaram em `test/screen-step-approvals.test.ts`, porque `test/screen-policy.test.ts` já existia com outro assunto.
- `policyChanges` virou `screenPolicyChanges` para não colidir com o `policyChanges` que a #268 cria em `config/autonomy.ts` (o `export *` de `config/index.ts` ficaria ambíguo na mescla).
- O `autocomplete` de campo de cartão não é lido pelo probe; fica como limite documentado.

## Testes

Novos:
- `test/screen-step-approvals.test.ts`: precedência por tipo, nível parcial, sanitização com aviso, mudanças e elevação, rascunhos de agente e squad.
- `test/browser-sensitive.test.ts`: tabela das categorias.
- `test/browser-call-screen.test.ts`: instantâneo por chamada e confirmação liberada ou sensível.

Acrescentados:
- `browser-classify`, `browser-intermediary` (critérios 1–4), `browser-asks`, `screen-audit`, `config-getters` (registro no `saveConfig`);
- `prompts-screen` (texto idêntico sem política, frase com tipo liberado, hand-off igual);
- `config-migrations` (v28→v29), `config-web-scope`, `cycle-templates`;
- `screen-settings-ui` (grade e editor do agente), `screen-ui` (aviso na janela), `team-runner-edit`.

Ajustados à v29: `agent-team`, `squads-config`, `config-schema`, `runner-config`, `cycle-prompts`, `team-suggestion-edit`.

## Verificação (rodada nesta tentativa)

- `npx tsc --noEmit`: sem erros.
- `node scripts/theme-audit.mjs`: saída 0; cores literais 14 antes e 14 depois (`--before HEAD`).
- `npm run i18n:lint`: 0 problemas.
- `node scripts/public-audit.mjs`: nada a apontar.
- `npx vitest run`: 7812 passam. Falham 4 arquivos de navegador real (browser-contract, browser-quit, browser-runtime, browser-sites), porque o módulo `@playwright/mcp` não existe neste computador. Na primeira rodada completa as mesmas 4 falhas já apareciam (além das de config que corrigi), e pelo menos browser-contract parou na importação desse módulo; não rodei esses arquivos na base sem a mudança. `agent-assist-prompts` e `workspace-guard` falharam só na rodada completa e passaram rodados sozinhos; a causa não foi investigada.

## Não verificado

- `electron-vite build`.
- A tela e a janela de aprovação vistas no app (só testes de renderização).
- Os 4 testes de navegador real.
- Mescla com a #268.

## Limite conhecido e pendência

- A detecção é por palavras (en/pt) e pelo tipo `password`: um controle de nome genérico que paga não é pego, e o `autocomplete` de cartão não é lido.
- A #268 (em implementação noutra execução) grava `auto-step` / `policy-change` com `policy.level`. Esta entrega grava `screen-autonomous` / `screen-policy` com `policyLevel`. Unificar os nomes é decisão da mescla.
- A regra 14 (não ir à produção sem a #268) é condição de lançamento e não é imposta em código.
