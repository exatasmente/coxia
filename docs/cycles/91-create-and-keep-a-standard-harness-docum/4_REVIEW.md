# Revisão da documentação padrão do projeto (`.coxia/`): formato, entrega, conferência, execução de documentação e tela

Branch `feat-harness-docs` na worktree `a árvore de trabalho da branch`, contra `origin/release/0.7.0`. São 14 commits, 85 arquivos, +5741/-184. Li a spec e o plano inteiros (gates 1 e 2 aprovados, D1 a D12) e o `4_REVIEW.md` da #71 para o formato. Li o diff do código (`src/main`, `src/shared`, `src/renderer`), os testes novos e os docs. Rodei os seis gates. Escrevi e rodei dois scripts descartáveis na pasta de rascunho da sessão para reproduzir os achados 1 e 5. Nada foi editado no repositório.

## Achados

### 1. [bloqueante] A confinação de escrita a `.coxia/` vaza quando `.coxia` é um link simbólico

`src/main/runner/executor.ts:441-442`, `src/main/runner/hooks.ts:52`, `src/main/engine/open/tools/write.ts:16`, `src/main/engine/guard.ts:83`.

O guard novo usa `writeRoot = <worktree>/.coxia` como raiz do `checkPath`. `checkPath` resolve `real(root)` e aceita qualquer caminho que caia dentro dessa raiz real. Ninguém confere que a raiz real continua dentro do worktree. O `mkdirSync(writeRoot, { recursive: true })` não falha quando `.coxia` já existe como link para uma pasta.

Cenário: o repositório tem um `.coxia` versionado como link simbólico para uma pasta fora dele (um commit hostil, ou qualquer ponta de remoto). A execução de documentação parte da ponta do remoto. O agente escreve `.coxia/x.md` e a escrita cai fora do worktree. Antes desta mudança, com `root = worktree`, o mesmo caminho era recusado.

Reproduzi com `checkPath(wt/.coxia, anchored(wt, p))`, com `wt/.coxia -> /…/outside`:

- `.coxia/x.md` dá `{ ok: true, path: "…/outside/x.md" }`, e o caminho absoluto equivalente também.
- `x.md`, `src/a.ts` e `..` são recusados, como deve ser.

O teste de `test/runner-docs.test.ts:503` só cobre um link *dentro* de `.coxia` (`.coxia/up -> ..`), nunca o `.coxia` em si.

O mesmo buraco existe em volta:

- `ensureRunIgnore` (`src/main/runner/docs.ts:36-41`) usa `existsSync`, `readFile` e `writeFile` seguindo links, e acrescenta `.run/` ao arquivo apontado.
- `writeIssueRecord` escreve `0_ISSUE.md` em `.coxia/.run` pelo mesmo caminho.
- `harnessDirs` (`src/main/harness/deliver.ts:29`) usa `existsSync` e põe um `.coxia` que é link em `additionalDirectories` do SDK.
- `scanHarness` já usa `lstat` e trata `.coxia` link como inexistente. As duas visões divergem.

O que fazer:

- Antes da etapa de documentação, exigir `lstat(writeRoot).isDirectory()` (não link) e `realpath(writeRoot)` dentro de `realpath(worktree)`. Se não for, falhar a etapa com mensagem.
- De preferência, pôr essa verificação no próprio `checkPath` ou no `writeGuard`, para valer nos dois motores.
- Trocar `existsSync` por `lstat` em `harnessDirs`, `ensureRunIgnore` e `docsRecord`.
- Teste novo: `.coxia` como link para fora, nos dois motores.

### 2. [bloqueante] O agente da execução de documentação não está confinado a `.coxia/` se o `shell` dele for `sandbox` ou `host`

`src/main/runner/executor.ts:328` e `:343-344`.

O comentário diz que "a documentation run's agent runs none, whatever its `shell` says". Isso só vale para `commands`, que o `!run.docs` zera. A sessão do sandbox é aberta antes, por `agent.shell === 'sandbox' || 'host'`, sem olhar `run.docs`. Ela entra na chamada como `exec`, e a ferramenta `Shell` não passa pelo `writeGuard`.

O agente `docs-writer` nasce com `shell: 'none'`, mas é um agente comum, editável em Configurações › Time (o plano e `docs/harness.md` dizem isso). Se a pessoa o puser em `sandbox` (ou se outro agente com `sandbox` for ligado às etapas do fluxo), ele passa a escrever em qualquer parte do worktree. Isso contradiz o critério 2 ("só escreve dentro de `.coxia/`") e a documentação. Nenhum teste cobre.

O que fazer:

- Na execução de documentação, não abrir a sessão: `const session = !run.docs && (agent.shell === 'sandbox' || …) ? … : null`.
- Opcionalmente, um aviso na verificação do fluxo quando o agente de uma etapa do `docs` tem shell.
- Teste: agente com `shell: 'sandbox'` numa execução `docs` não recebe `exec`.

### 3. [bloqueante] "Salvar as fontes" em Configurações › Documentação sobrescreve a configuração inteira com um retrato velho

`src/renderer/src/screens/DocsSection.tsx:59` (o retrato é lido uma vez, ao montar) e `:98` (`wizardApi.save({ ...config, docs: … })`).

`config:save` substitui a configuração inteira (`src/main/configModule.ts:58`). A `TeamSettings` fica na mesma tela, logo acima, e mantém a configuração atualizada pelo evento `config`. A `DocsSection` não escuta o evento.

Cenário:

1. A pessoa abre Configurações e edita o time (adiciona ou altera um agente).
2. Na mesma tela, acrescenta uma fonte extra e clica em "Salvar as fontes".
3. O retrato de antes do passo 1 é gravado por cima, e a edição do time some sem aviso.

Também acontece quando "Adicionar e iniciar" aplica o modelo `docs-flow` e a partida falha. A seção chama só `read()`, que atualiza o status mas não o retrato da configuração, e o salvar seguinte remove o fluxo e o agente recém-adicionados. A seção compartilha a lista de fontes com o assistente, mas o assistente é dono da configuração durante o fluxo dele; Configurações não é.

O que fazer:

- No `save`, reler a configuração (`wizardApi.config()`) e trocar só os campos de `docs`.
- Ou usar o armazenamento compartilhado que a `TeamSettings` usa.
- Como o projeto não tem teste de componente, extrair a mesclagem para uma função pura e testá-la.

### 4. [sugestão] As listas explícitas de `docs` ainda levam arquivos do Claude Code ao agente

`src/main/agents.ts:428` (`openDocs`), `src/main/wizard-core.ts:159-176` e `src/main/agentPrep-core.ts:317`.

Isso segue o critério 7 ("as listas preenchidas continuam valendo"), então não é erro de implementação. Mas o caso que motivou a issue era justamente um workspace com as listas preenchidas, e quem as preencheu foi o assistente (as propostas "encontrado") e o "Preparar agentes", que continuam sugerindo `CLAUDE.md` e `.claude/` sem aviso. No motor aberto, um `claudeMdRoots` explícito entra inteiro no texto de sistema. O critério 6 e a verificação M7 vão falhar para esse workspace até a pessoa remover os itens, e o único aviso é o selo "do Claude Code" em Configurações.

O que fazer: avisar no assistente e em Configurações, uma vez, que as entradas marcadas ainda chegam aos agentes. Ou decidir com o mantenedor se `isClaudeSource` filtra as listas para os agentes do time, o que muda o critério 7. Registrar a decisão em `3_TEST_PLAN.md` (M7).

### 5. [sugestão] A reescrita de texto estraga documentação legítima e o carimbo a marca como conferida

`src/shared/runs/comment.ts:131` (`ABSOLUTE`), `src/main/errorlog-core.ts:15-22` (`SECRETS`) e `src/main/harness/finalize.ts:72`.

Rodei `rewriteLocal` sobre um corpo de regra comum:

- `apiKey: string;` virou `apiKey: [redacted];`, e `token: string | null` virou `token: [redacted] | null`.
- `/var/log/app/app.log` virou `app.log`, e `/tmp/cache` virou `cache`.

O corpo é reescrito no arquivo e depois carimbado. A pessoa só vê "N caminhos reescritos e M credenciais mascaradas", sem saber o quê, e o agente seguinte lê o texto já estragado. `docs/harness.md` avisa só de hashes e cadeias longas.

O que fazer: poupar blocos de código (cercas e crases) e atribuições de tipo (`: string`) na reescrita de `.coxia/`. Ou pôr o trecho original e o reescrito na linha do fórum. Ou listar de fato esse limite na documentação.

### 6. [sugestão] O modelo `docs-flow` é aplicado antes de a partida ser validada

`src/main/harness/docsRun.ts:27-31`.

`startDocsRun` chama `applyFlow()` e só depois `startDocs`, que valida o modo, o repositório (`no-clone`), a identidade (`no-identity`) e a duplicata. Se a partida falhar, a configuração já ganhou o agente e o fluxo, e o estado fica diferente do que o clique prometia.

O que fazer: validar modo e repositório antes de aplicar. Ou aplicar só depois de o worktree existir.

### 7. [sugestão] Endurecer arquivos dentro de `.coxia/`

`src/main/harness/finalize.ts:68-76` e `:112-116`, e `src/main/runner/hooks.ts:52`.

- `finalizeHarness` e `stampHarness` usam `readFile` e `writeFile`. Um `rules/x.md` que seja link e tenha sido criado ou alterado na passada (por exemplo por um agente com shell no sandbox) faz o app, no lado do host, ler e regravar o arquivo apontado. Conferir `lstat(...).isFile()` antes de ler ou escrever, como `scanHarness` já faz.
- `.coxia/.gitignore` e `.coxia/.run/` são do app (`HARNESS_OWN`), mas o `writeGuard` deixa o agente escrevê-los. Basta o agente apagar a linha `.run/` para o registro e a memória da execução irem no pull request. Recusar essas duas entradas no guard.

### 8. [sugestão] O orçamento "no máximo N caracteres" não é o total do texto entregue

`src/shared/harness/select.ts:25-27` e `src/main/harness/deliver.ts:98-136`.

A soma conta corpo, moldura (`FRAME`) e marca (`MARK`, 220). Ficam de fora o cabeçalho `runner.docs.head` (cerca de 800 caracteres), as quebras e tags, a linha "não coube" (até 40 nomes) e a marca real, que pode passar de 220 com três nomes longos. O teste aceita folga de +1500 (`test/harness-deliver.test.ts:143`). Com o piso de 3.000 (janela pequena), o excesso é proporcionalmente grande.

O que fazer: contar o cabeçalho e a linha de "não coube" dentro do orçamento, ou reformular o texto da tela (`ui.settings.docs.budget`) para "o orçamento da documentação, fora o cabeçalho e as listas de nomes".

### 9. [sugestão] A execução de documentação ainda tem caminhos que usariam o número 0

`src/main/runner/publish.ts:926-943` (`stageEntered`), `:857-870` (`proposePriority`) e `:895-908` (esperas `label` e resposta).

As guardas do plano cobrem `deliver`, `prOf`, `prState` e `reporter`, e o detector de `planWrite` com `iid: 0` passa no fluxo padrão. Mas `stageEntered` planeja `setIssueLabels` em `run.issue.iid` assim que uma etapa do fluxo `docs` tiver `trackerStatus`. O fluxo `docs` é editável por importação de configuração. A escrita iria para a issue 0 (que ficaria pendente em Ações, ou seria recusada).

O que fazer: `if (run.docs) return` em `stageEntered`, `proposePriority`, `squadRouted`, `requestIssue` e nas esperas lidas da issue, como já feito em `deliver`. Estender o teste do detector a um fluxo `docs` com `trackerStatus`.

### 10. [sugestão] O vão entre o plano de teste e o código na parte de estado de commit sem história

`src/main/harness/stale.ts:72`.

`git diff` não lista arquivos novos não rastreados. Um arquivo novo sob uma pasta de evidência só conta como mudança depois de `git add` ou commit. É minoria, e a verificação M4 deveria incluir o caso, ou `docs/harness.md` deveria dizê-lo.

## O que está de acordo, conferido

- **Isolamento (SDK).** `sdkOptions` acrescenta `settingSources: []` e `settings: { autoMemoryEnabled: false }` quando `req.isolated`, e o `...req.extra` que vem depois não os sobrescreve. `runAgent` põe `isolated: true` sempre, inclusive para a retomada `wrapUpAnswer`, que copia a requisição. O `runOnce` (cerimônias) não define, como D6 manda. A leitura de memória só se confirma em M1.
- **Isolamento (motor aberto).** `openDocs(…, true)` devolve listas sempre definidas e `[]` não é `undefined`, então `defaultDocSources` (`bridge.ts:99`) e `discoverClaudeMd` (`loop.ts:226`) não são alcançados. O gancho `openEngineFromEnv` também recebe `docs`. O sub-agente `Agent` do motor aberto lê das mesmas listas.
- **Escrita.** O guard do SDK e as ferramentas `Write` e `Edit` do motor aberto recusam caminho relativo ao worktree, `..`, absoluto, `~`, link dentro de `.coxia` que sai dele e a própria `.coxia`. `anchored` resolve o caminho relativo contra o `cwd`, como as ferramentas fazem. A exceção é o achado 1.
- **Porta.** O push é proposto por `door.proposePush` e o pull request por `door.propose`; nenhum é autônomo, mesmo com `docs-writer` autônomo. O push só nasce depois do gate (duas etapas que escrevem, `pushStagesOf` intocado). Espaço de teste: proposto e recusado na confirmação (`test/runner-docs.test.ts:388`). Sem "Closes".
- **Canais.** `/^docs:/` em `webPolicy.ts:53` nega `docs:status` e `docs:start` ao navegador. O teste enumera todos os canais `docs:*` servidos por módulo.
- **Texto e carimbo.** O cabeçalho nunca é reescrito (`splitFile`). O carimbo vai em segundo commit, com o mesmo `identity` e o mesmo `commitMessage` do runner. Squash, rebase, commit ausente e edição não commitada estão cobertos em `test/harness-stale.test.ts`.
- **Fluxos existentes.** A suíte inteira passa, incluindo `runner-golden`, `runner-release`, `runs-flow` e `host-terms-leak`. `src/shared/runs/flow.ts` não foi tocado.
- **Convenções.** Os 14 commits têm autor e committer `22161417+exatasmente@users.noreply.github.com`, assunto `feat:` ou `fix:` em minúsculas e no imperativo, sem trailer nem "Generated with". `public-audit` passa e não achei caminho privado, host ou pessoa no diff (`/home/ana`, `/home/nobody` e `/home/someone` são neutros). Todas as chaves novas estão nos dois catálogos (`i18n:lint` fecha com 4186 chaves). Não achei cor literal nova (`theme-audit` passa). `CHANGELOG.md` tem as linhas em `[Unreleased]`.

## Critérios de aceite

| # | Critério | Situação |
|---|---|---|
| 1 | Sem `.coxia/`, a tela diz e oferece Criar | Código mais teste do status (`docs-status`); a tela só à mão (M3) |
| 2 | Criar inicia execução sem issue; o agente só escreve em `.coxia/`; para no gate | Código mais teste, **com os buracos dos achados 1 e 2** |
| 3 | O rascunho traz README, regras com evidência e cabeçalho | Formato e carimbo por teste; o conteúdo do rascunho depende de modelo real: só à mão (M3) |
| 4 | A descrição do PR lista o que ficou de fora e não termina em "Closes" | Código mais teste (`runner-docs`) |
| 5 | Push e PR esperam o "sim"; em espaço de teste são recusados | Código mais teste |
| 6 | Nada de `.claude/`, `CLAUDE.md` ou `~/.claude` nos dois motores | Código mais teste (opções do SDK e texto de sistema do motor aberto); o SDK real só em M1 e M7; ressalva do achado 4 |
| 7 | `autoDetect` não acrescenta `.claude/`; as listas valem | Código mais teste (`config-resolve`, `agent-isolation`) |
| 8 | Visão geral mais o que cabe por etapa, papel e caminho | Código mais teste (`harness-select`, `harness-deliver`) |
| 9 | Cabe no orçamento; o que não coube é dito | Código mais teste; o total passa um pouco do número dito (achado 8) |
| 10 | Regra com arquivo citado mudado vira "não conferida", na tela e para o agente | Código mais teste (`harness-stale`, `docs-status`, `harness-deliver`); a tela só à mão (M4) |
| 11 | Etapa de código recebe a regra e a atualiza no mesmo ramo; a revisão aponta a esquecida | Código mais teste (`runner-docs-keep`); o comportamento de um modelo real só à mão |
| 12 | A tela por repositório, só no desktop | Código mais teste do status e da política; a tela e o navegador pareado só à mão (M3, M4, M6); **bug do achado 3 nas fontes extras** |
| 13 | Verificação de texto antes do push, com o que mudou dito | Código mais teste (`harness-finalize`); a pessoa vê contagens e arquivos, não o diff (achado 5) |
| 14 | O app não escreve em `.claude/` nem em `CLAUDE.md` | Só por código: nenhum caminho do app o faz e a execução de documentação é confinada (com os achados 1 e 2); não há teste dedicado da ausência |
| 15 | Repositório sem `.coxia/` continua executando, a tela diz | Código mais teste (nenhum texto novo, `runner-docs-keep:257`, `agent-isolation:167`); a tela só à mão |
| 16 | Cerimônias, fluxo comum e gates 1 e 2 como antes | Código mais teste (suíte inteira, golden e release verdes, `flow.ts` intacto) |

## Testes: o que não está coberto

- `.coxia` como link simbólico, e escrita ou leitura por link dentro de `.coxia` que fica dentro dele (achado 1).
- Execução de documentação com agente de `shell: 'sandbox'` ou `'host'` (achado 2).
- `finalizeHarness` e `stampHarness` sobre um arquivo que é link, e escrita do agente em `.coxia/.gitignore` e `.coxia/.run/` (achado 7).
- `startDocsRun` com falha depois de aplicar o modelo (achado 6).
- Fluxo `docs` com `trackerStatus` e esperas `label` ou resposta (achado 9).
- `DocsSection`: o projeto não tem teste de componente, e o bug do achado 3 está justamente na lógica de salvar. Extrair a mesclagem para uma função pura resolveria.
- `rewriteLocal` sobre blocos de código e assinaturas de tipo (achado 5).

## Docs

`docs/harness.md` e as páginas atualizadas (`configuration.md`, `cycles.md`, `runner.md`, `llm-providers.md`, `README.md`, `CHANGELOG.md`) descrevem o que o código faz. O formato, o orçamento, a conferência, o fluxo e os canais batem.

Divergências a corrigir junto com os achados:

- A frase "sem comandos" e "o guarda recusa o resto" omite que o shell do `docs-writer` é editável (achado 2).
- "O orçamento" não diz o que fica fora (achado 8).
- Os limites da reescrita não incluem os de código e caminhos (achado 5).

## Gates rodados

Ordem e variáveis conforme pedido: `source ~/.nvm/nvm.sh && nvm use`, com `CERIMONIAS_DATA_DIR` e `CERIMONIAS_SPECS_DIR` em pastas vazias sob a pasta de rascunho da sessão. Os registros estão em `.runlogs-review-*.log` na worktree (ignorados pelo git).

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0, sem saída |
| `npx vitest run` | exit 0, 239 arquivos, 3901 testes passando (126 s) |
| `node scripts/theme-audit.mjs` | exit 0 |
| `npm run i18n:lint` | exit 0, 4186 chaves nos dois idiomas |
| `node scripts/public-audit.mjs` | exit 0, 962 arquivos |
| `npx electron-vite build` | exit 0 |

Também conferi à mão `git log --format='%h %ae %ce %s'` (identidade e assuntos) e procurei no diff por atribuição de IA, caminho privado e host: nada.

## O que não foi verificado

- Que o Claude Code real, com `settingSources: []` e `autoMemoryEnabled: false`, não carrega `CLAUDE.md`, `.claude/` nem a memória (M1). O código só foi lido contra os tipos.
- Que `.mcp.json` ainda chega aos agentes do SDK. `docs/harness.md` diz que sim para todo agente, mas no caminho do SDK o app não repassa `mcpConfigFiles` (só o motor aberto lê). Com `settingSources: []` o Claude Code deixa de carregá-lo sozinho. Como `allowedTools` é explícito em modo `dontAsk`, é provável que a mudança seja invisível, mas não conferi.
- A tela de Ações com push e pull request de uma execução sem issue (sem "#0"; M5), a tela de Configurações em si, o navegador pareado (M6) e a pergunta do caso real (M7).
- O rascunho gerado por um modelo real: se importa certo o que é fato do projeto e o que é regra de sessão, e o orçamento reduzido pela janela de um modelo pequeno (M2).
- `git log -S` em squash, rebase e merge de verdade num forge (M4); os testes usam repositórios temporários.
- Nada foi exercitado contra host de código real nem com dados reais.

## Veredito

**Bloqueia.** Os gates passam e a cobertura de teste é ampla, mas há três achados bloqueantes que o `3_TEST_PLAN.md` não pegaria e que a suíte atual não alcança:

- **Achado 1:** a confinação de escrita a `.coxia/` pode ser contornada com `.coxia` como link. Reproduzido por script.
- **Achado 2:** o shell do agente de documentação não é zerado.
- **Achado 3:** "Salvar as fontes" apaga edições feitas antes na mesma tela.

Os achados 1 e 2 são correções de poucas linhas e cada um merece um teste. O achado 3 pede uma releitura da configuração antes de salvar. Depois disso a entrega fica de acordo com a spec; as sugestões 4 a 10 podem ir em seguida ou virar issues.

## Rodada 2

Revisei os nove commits de correção (`ebb26f9` a `2714c42`) contra o código e os testes de cada um. Refiz os gates e as duas reproduções da rodada 1, a do achado 1 (link simbólico) e a do achado 5 (reescrita de texto), com as correções aplicadas. Os três achados bloqueantes estão resolvidos e não achei bloqueante novo.

### Estado dos achados da rodada 1

| # | Achado | Estado | Verificação |
|---|---|---|---|
| 1 | `.coxia` como link burla a confinação | **Resolvido** | `checkPath` ganhou `fence` e `realFolderIn`: a raiz estreita precisa ser pasta real (`lstat`, não link) e estar dentro do worktree. O mesmo guard vale nos hooks do SDK e nas ferramentas `Write` e `Edit` do motor aberto. A execução recusa a etapa com `docs-folder-unsafe` antes de chamar o agente. A partida recusa o repositório (`ensureRunIgnore` e `prepareDocsFolder` com `lstat`; `writeIssueRecord` passa pelo guard; `harnessDirs` e `runDocsAsk` com `lstat`). Refiz a reprodução: com `.coxia` link, `.coxia/x.md` e o caminho absoluto dão `outside`; com pasta real, o mesmo caminho é aceito. Há testes de partida, de etapa, dos hooks e do motor aberto (`runner-docs`). |
| 2 | Shell do agente de documentação não zerado | **Resolvido** | `executeStage` não abre sandbox nem sessão de host quando `run.docs`. Com `call.confine` o `allowedTools` é fixo (`Read`, `Grep`, `Glob`, `Edit`, `Write`), sem `Bash`. Teste parametrizado para `sandbox` e `host`. |
| 3 | Salvar fontes sobrescreve a configuração | **Resolvido** | `DocsSection` não guarda mais o retrato. O salvar lê a configuração atual e troca só as listas, por `withDocsSources`, extraída para função pura e testada (`docs-sources.test.ts`). Resta uma janela mínima entre a leitura e o `config:save`, que é o limite do desenho de substituição total, não deste código. |
| 4 | Listas explícitas levam arquivos do Claude Code | **Mantido de propósito** | Segue o critério 7 da spec aprovada. Continua valendo a nota de que M7 falha no workspace do caso original até a pessoa remover as entradas marcadas. Aceito como decisão do mantenedor. |
| 5 | A reescrita estraga documentação legítima | **Em parte** | Resolvido para o que apontei: `apiKey: string;` e `/var/log/app/app.log` em cerca ou trecho de código ficam intactos, e a prosa continua reescrita. Credencial por forma (`ghp_…` virou `[key]`) e caminho do próprio worktree continuam reescritos no código. O fechamento de cerca, a cerca sem fim e a crase solta têm teste, e uma entrada adversária de 20 mil repetições processou em cerca de 280 ms. Ficam duas ressalvas, nos achados 11 e 12 abaixo. |
| 6 | Modelo aplicado antes de validar a partida | **Resolvido, com ressalva** | `checkDocs` valida modo, duplicata, repositório e identidade antes de `applyFlow`, e `createDocs` reusa as mesmas perguntas (`docsPrecheck`). Quatro testes confirmam que a configuração não muda quando a partida não pode acontecer. Ressalva: ver a avaliação (b). |
| 7 | Endurecer arquivos dentro de `.coxia/` | **Resolvido** | Novo código de recusa `reserved`: o guard recusa `.gitignore` e `.run` (e o que está sob eles, em qualquer caixa) nos dois motores, com chaves nos dois catálogos. `finalizeHarness` e `stampHarness` usam `lstat` e pulam o que não é arquivo comum; a linha de fórum `runner.docs.notAFile` avisa. Há testes dos hooks, do motor aberto e dos dois. |
| 8 | O orçamento não é o total entregue | **Resolvido** | `harnessSection` mede o texto real, incluindo cabeçalho, marcas e a linha "não coube", e reduz a parte dos arquivos em até 12 rodadas até caber. Os testes cobrem o corte de arquivo longo e o piso do orçamento com muitos nomes. Se as 12 rodadas não bastarem, devolve o texto acima do limite; só o teste de piso exerce esse extremo. |
| 9 | Caminhos que usariam a issue 0 | **Resolvido** | `proposePriority`, `stageEntered`, `squadRouted`, `requestIssue` e as esperas lidas da issue retornam cedo para `run.docs`. Os testes cobrem um fluxo `docs` editado para ter `trackerStatus`. |
| 10 | Arquivo novo não rastreado | **Resolvido** | A limitação foi escrita nos dois idiomas de `docs/harness.md`, na seção da conferência. |

### Avaliação das três escolhas apontadas

**(a) `redactCode` e `password = "…"` em código: aceito, com uma sugestão.** A troca é razoável: o que é credencial pela forma (prefixos conhecidos, JWT, cadeia opaca longa, URL com senha) continua mascarado em código, e é justamente a atribuição a um nome que "parece" segredo que gerava o estrago. Mas `const password = "hunter2"` numa cerca sai no pull request, e esse arquivo vai para um repositório possivelmente público. Veja o achado 11.

**(b) Falha depois de aplicar o modelo, sem desfazer: aceito.** O que sobra depois do pré-voo são condições previsíveis do repositório ou do dia: `branch-exists`, `dest-exists`, `docs-folder-unsafe` na ponta do remoto e fluxo inválido por id de agente já existente. A mudança é só acrescentar um agente e um fluxo, depois de um "sim" explícito, e uma nova tentativa não pergunta de novo. Desfazer em falha pode apagar o que a pessoa editou entre uma coisa e outra, e é pior que deixar. Uma sugestão pequena: o texto de erro dizer que o fluxo ficou adicionado.

**(c) A partida também recusa repositório com `.coxia` link: acertado.** Sem isso a execução nasceria e falharia na primeira etapa. A recusa deixa tudo como estava, com mensagem nos dois catálogos e teste. Também cobre `.coxia/.gitignore` e `.coxia/.run` como link.

### Achados novos

**11. [sugestão] Atribuição quotada a nome de segredo em código segue sem máscara.**
`src/main/errorlog-core.ts` (`redactCode` ignora `ASSIGNMENT`). Rodei a reescrita: `const password = "hunter2";` numa cerca de código permaneceu como está. Um valor entre aspas é quase sempre um literal que alguém digitou, e `apiKey: string` (o que causou o achado 5) não tem aspas.
O que fazer: em `redactCode`, mascarar só a atribuição cujo valor é literal entre aspas não vazio (`password = "…"`, `token: '…'`), e deixar passar identificador ou tipo (`: string`, `= next()`). Acrescentar o caso ao teste "still masks a credential by its shape inside code".

**12. [sugestão] A regra de e-mail ainda estraga versão fixada, até em código.**
`src/main/errorlog-core.ts:25` (`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`, que `redactCode` também aplica). Rodei `redactCode('npm i -g pnpm@9.0.0 && git clone git@example.com:org/repo.git && uses actions/checkout@v4.1.1')`: saiu `npm i -g [email] && git clone [email]:org/repo.git && uses actions/[email]`. Instruções de instalação com versão fixada, URLs SSH e `uses: x@v1.2.3` são comuns numa documentação de projeto, são mascaradas como credenciais e entram na contagem da linha do fórum. Não vem das correções, mas é a mesma classe do achado 5 e a correção não a fecha.
O que fazer: em `redactCode`, não aplicar a regra de e-mail, ou exigir que o domínio tenha um TLD alfabético e a parte antes do `@` não termine em nome de pacote. Em prosa, o mesmo cuidado com `nome@x.y.z` (ao menos tratar `@` seguido de dígito como versão). Acrescentar o caso a `harness-finalize`.

**13. [sugestão] A mensagem de falha depois de aplicar o modelo.**
Ver (b): quando a partida falha depois do `applyFlow`, o erro mostrado não diz que o agente "Redator da documentação" e o fluxo já ficaram na configuração. Acrescentar uma frase ao erro da janela, ou uma linha no fórum.

### Gates (`source ~/.nvm/nvm.sh && nvm use`, com `CERIMONIAS_DATA_DIR` e `CERIMONIAS_SPECS_DIR` em pastas vazias; logs em `.runlogs-review2-*.log`)

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | exit 0, sem saída |
| `npx vitest run` | exit 0, 240 arquivos, 3930 testes passando (124 s) |
| `node scripts/theme-audit.mjs` | exit 0 |
| `npm run i18n:lint` | exit 0, 4192 chaves nos dois idiomas |
| `node scripts/public-audit.mjs` | exit 0, 965 arquivos |
| `npx electron-vite build` | exit 0 |

As reproduções dos achados 1 e 5 foram rodadas fora do repositório (scripts descartáveis). Os nove commits têm autor e committer com a identidade noreply, assunto `fix:` em minúsculas e no imperativo, e nenhum trailer de atribuição.

### Ainda não verificado

O mesmo que na rodada 1: o comportamento do Claude Code real com `settingSources: []` (M1), a tela de Configurações e o navegador pareado (M3, M4, M6), Ações com push e pull request sem issue (M5), a pergunta do caso real (M7) e o rascunho de um modelo real. Também não exercitei uma partida real contra um repositório cujo `.coxia` é link, só os testes.

### Veredito

**Aprova.** Os três achados bloqueantes da rodada 1 estão corrigidos, cada um com teste, e confirmei os dois reproduzíveis por script. Os gates passam. O achado 4 foi mantido por decisão da spec. As sugestões 11 a 13 e a ressalva de (b) não impedem a entrega; as 11 e 12 valem uma correção antes do release, porque mexem no que sai num repositório possivelmente público.
