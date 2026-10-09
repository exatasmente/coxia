# Memória do ciclo

## Decisões

- Pedido de funcionalidade; **1_SPEC.md:** servidor é processo stdio separado reutilizando a leitura e o mascaramento do app; um workspace por instância; sessão escolhe pela entrada de projeto em .mcp.json (mesma forma {mcpServers} que o app lê); conjunto de leitura confirmado.
- **2_PLAN.md (D1–D10):** entrada de build mcp-state rodada por node sem Electron nem SDK; workspace nomeado por id via env CERIMONIAS_MCP_WORKSPACE resolvido pelo registry com DATA_ROOT de env; servidor coxia_state, ferramentas coxia_state_*; módulos server.ts/tools.ts/entry.ts; só código electron-free; comando pendente nunca visível (D6); merge sem sobrescrever estrangeira (D8); caminhos máquina-só com shrinkHome em tela (D9); mascaramento por superfície (D10).
- **Implementação (3_IMPLEMENTATION.md):** construído; desvios honrados pelo plano: procedures é leitura real da loja #179 (sem passos; id opcional) e o caminho do arquivo na entrada é absoluto real (shrink só na linha de exibição).
- **Revisão (4_REVIEW.md):** design, isolamento, mascaramento, merge-never-clobber, refusais e guarda desktop-only conferidos e aprovados; testes reais e bem mirados; i18n:lint e public-audit verdes; **veredicato: changes** por seis bloqueantes (abaixo).

## Restrições

- Só leitura; escritas futuras em issues separadas; testes só com fakes; repositório público.
- Gates = tsc, vitest, theme-audit, i18n:lint, public-audit; node do .nvmrc.

## Tentado e descartado

- Ler a pasta de dados diretamente; API de web access; servidor dentro do app; caminho de dados absoluto no .mcp.json.

## Perguntas abertas

## Onde o trabalho está

- Branch da issue com 3691c441+#6 e docs de ciclo nas linhas [redacted].
- Requisito desta revisão: corrigir os 6 bloqueantes e rodar bípede de gates (tsc, vitest completo, theme-audit, i18n:lint, public-audit) e construir o entry antes da re-revisão (r2 confere só bloqueantes).
- Passagem support → product-owner: Refinement: decide whether the stdio MCP server runs inside the app or as a separate process reading through the app's store code; decide which workspace it serves and how the terminal session picks it; confirm the read set (runs, conversation, evidence, #179 procedures, activities); coordinate with #179 so its store is shaped for outside reads. Product refinement may look at how a Claude Code session picks up a stdio server in its settings. <!-- handoff:7 -->
- Passagem product-owner → pessoa: Build the read-only stdio server per 1_SPEC.md: a separate process reusing the app's read and masking code; one workspace per instance via an environment variable in its setup entry; opt-in toggle per workspace in Settings that shows a copyable {mcpServers} entry and offers to write it into the project folder; first steps are the independent reads — cycles, runs, conversations, activities, evidence — plus masking along answers; the procedure read waits for #179's store. Tests with fakes only (test/helpers/), no network, strings through t() in both catalogs, user-visible change under CHANGELOG.… <!-- handoff:19 -->
- Passagem tl-plataforma → pessoa: Implement from docs/cycles/[redacted]/2_PLAN.md, in its order: config field mcpState with migration v23→v24; src/main/mcp-state/tools.ts and server.ts; the mcp-state main build entry; Settings opt-in with the copyable {mcpServers} entry and the person-confirmed merge write; CHANGELOG under Unreleased. Honor D6's revision of acceptance criterion 4 (a command awaiting approval is not visible in files; answer the pending question, and answer none for a command with the reason) and D7 (the procedures tool answers a constant refusal until #179 lands its store). Verify forum-core.ts and the activiti… <!-- handoff:42 -->
