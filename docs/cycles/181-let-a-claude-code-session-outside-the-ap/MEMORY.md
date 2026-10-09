# Memória do ciclo

## Decisões

- Pedido de funcionalidade; **1_SPEC.md:** servidor é processo stdio separado reutilizando a leitura e o mascaramento do app; um workspace por instância; sessão escolhe pela entrada de projeto em .mcp.json (mesma forma {mcpServers} que o app lê); conjunto de leitura confirmado.
- **2_PLAN.md (D1–D10):** entrada de build mcp-state rodada por node sem Electron nem SDK; workspace nomeado por id via env CERIMONIAS_MCP_WORKSPACE resolvido pelo registry com DATA_ROOT de env; servidor coxia_state, ferramentas coxia_state_*; módulos server.ts/tools.ts/entry.ts; só código electron-free; comando pendente nunca visível (D6); merge sem sobrescrever estrangeira (D8); caminhos máquina-só com shrinkHome em tela (D9); mascaramento por superfície (D10).
- **Implementação (3_IMPLEMENTATION.md):** construído; desvios honrados pelo plano: procedures é leitura real da loja #179 (sem passos; id opcional) e o caminho do arquivo na entrada é absoluto real (shrink só na linha de exibição).
- **Revisão:** r1 aprovou design, seis ferramentas de leitura, resolução/recusas de workspace, merge-never-clobber, guarda desktop-only e electron-freeness; os 5 bloqueantes da r1 corrigidos (o novo teste achou que a cadeia deny de webPolicy não aplicava MCP_STATE_ADMIN; agora aplicado). **Re-review (r2) aprovado.**
- **QA (5_TEST_PLAN.md):** aprovado. Planejamento de teste: critério 2 (sessão externa real) fica como não-verificação da pessoa; painel de Configurações verificado por suites, não pela tela.

## Restrições

- Só leitura; escritas futuras em issues separadas; testes só com fakes; repositório público.
- Gates = tsc, vitest, theme-audit, i18n:lint, public-audit; node do .nvmrc.

## Tentado e descartado

- Ler a pasta de dados diretamente; API de web access; servidor dentro do app; caminho de dados absoluto no .mcp.json.
- Subir o app Electron na tela virtual para olhar o painel de Configurações: o helper SUID do Electron não é configurável aqui e o otimizador do vite não escreve no node_modules só-leitura desta sandbox; verificação visual não executável no ambiente.

## Perguntas abertas

## Onde o trabalho está

Branch da issue no worktree, revisão aprovada e QA aprovada; nada de código mudado pela QA. Sugestões não aplicadas: typo no comentário de cli.ts ("Stdio us broken"), duplicação do DATA_ROOT literal em tools.ts, comentário de server.ts sobre resolução "once".

QA nesta tentativa: suites (10 arquivos, 117 testes) verdes — as suites mcp-state {-server,-tools,-redact,-build,-entry}, config-mcp-state, config-migrations, settings-mcp-state, mcpstate-policy, ui-i18n; tsc 0 erros; i18n:lint 0 achados (5408 chaves); theme-audit exit 0 com os 14 achados pré-existentes em telas de ciclo; public-audit verde (1530 arquivos); electron-vite build exit 0, produzindo out/main/mcp-state.js (out/ é gitignore). Fim-a-fim com processo real: CLI construído rodado como node comum sobre pastas de dados descartáveis, guiado por pipes JSON-RPC — initialize (protocolo 2024-11-05), tools/list só as seis leituras, as leituras de ciclos/execução/conversa/evidências/atividades/procedimentos, segredos semeados mascarados, refusais de workspace (off/sem variável/desconhecido/identificador inválido) em toda ferramenta, ferramenta de escrita recusada, método desconhecido -32601, nenhum socket aberto durante o serviço, arquivos do workspace byte-a-byte iguais após as respostas. Suites de browser deste ambiente falham por módulo @playwright/mcp ausente (ambiental; não em arquivos tocados).

Não verificado: sessão real de Claude Code (pessoa), painel na tela (Electron não sobe aqui), asar/Windows.
- Passagem support → product-owner: Refinement: decide whether the stdio MCP server runs inside the app or as a separate process reading through the app's store code; decide which workspace it serves and how the terminal session picks it; confirm the read set (runs, conversation, evidence, #179 procedures, activities); coordinate with #179 so its store is shaped for outside reads. Product refinement may look at how a Claude Code session picks up a stdio server in its settings. <!-- handoff:7 -->
- Passagem product-owner → pessoa: Build the read-only stdio server per 1_SPEC.md: a separate process reusing the app's read and masking code; one workspace per instance via an environment variable in its setup entry; opt-in toggle per workspace in Settings that shows a copyable {mcpServers} entry and offers to write it into the project folder; first steps are the independent reads — cycles, runs, conversations, activities, evidence — plus masking along answers; the procedure read waits for #179's store. Tests with fakes only (test/helpers/), no network, strings through t() in both catalogs, user-visible change under CHANGELOG.… <!-- handoff:19 -->
- Passagem tl-plataforma → pessoa: Implement from docs/cycles/[redacted]/2_PLAN.md, in its order: config field mcpState with migration v23→v24; src/main/mcp-state/tools.ts and server.ts; the mcp-state main build entry; Settings opt-in with the copyable {mcpServers} entry and the person-confirmed merge write; CHANGELOG under Unreleased. Honor D6's revision of acceptance criterion 4 (a command awaiting approval is not visible in files; answer the pending question, and answer none for a command with the reason) and D7 (the procedures tool answers a constant refusal until #179 lands its store). Verify forum-core.ts and the activiti… <!-- handoff:42 -->
- Passagem revisor-plataforma → developer: Reviewed the #181 delivery against 1_SPEC.md and 2_PLAN.md. The design, the six read tools, the workspace resolution/refusals, the merge-not-clobber .mcp.json write, the desktop-only channel guard and the electron-freeness of the CLI's imports all check out against the spec and plan, and the tests written for them are real and well targeted. The gates are not green: npx tsc --noEmit fails with five errors (wrong import paths in mcp-state/module.ts, an implicit any, a missing t() binding in McpStateSection, a narrowing error in entry.ts), the full vitest run fails the existing schema-version pi… <!-- handoff:107 -->
- Passagem developer → revisor-plataforma: Re-review: the six blockers are fixed and the gates re-run (tsc 0 errors; full vitest green except the four browser suites this environment already failed at r1 for lack of the @playwright/mcp module; i18n:lint, theme-audit and public-audit green). Check only the blockers; note that fixing the policy blocker also filled the deny chain in webPolicy.ts with MCO_STATE_ADMIN applied — now MCP_STATE_ADMIN — which r1's read had not flagged. All that r1 accepted stands. <!-- handoff:126 -->
