# Memória do ciclo

## Decisões

- Pedido de funcionalidade; **1_SPEC.md:** servidor é processo stdio separado reutilizando a leitura e o mascaramento do app; um workspace por instância; sessão escolhe pela entrada de projeto em .mcp.json (mesma forma {mcpServers} que o app lê); conjunto de leitura confirmado.
- **2_PLAN.md (D1–D10):** entrada de build mcp-state rodada por node sem Electron nem SDK; workspace nomeado por id via env CERIMONIAS_MCP_WORKSPACE resolvido pelo registry com DATA_ROOT de env; servidor coxia_state, ferramentas coxia_state_*; módulos server.ts/tools.ts/entry.ts; só código electron-free; pergunta pendente respondida, comando nunca visível (D6); escrita do .mcp.json confirmada pela pessoa, merge sem sobrescrever estrangeira (D8); caminhos máquina-só com shrinkHome em tela (D9); mascaramento por superfície (D10).
- **Implementação (3_IMPLEMENTATION.md):** tudo acima construído. Desvios honrados pelo próprio plano: (a) o store de procedimentos do #129/#179 já aterrissou electron-free (src/main/procedures/store.ts, "a read-only wrapper can be added later"), então coxia_state_procedures é leitura real (lista sem passos; id opcional), não a recusa constante do D7; (b) o caminho do arquivo do servidor na entrada copiável/escrita fica absoluto real — um args com `~` não expandiria no spawn; o shrinkHome apareceu só na linha de exibição do caminho. Canais mcpstate:* desktop-only no webPolicy.

## Restrições

- Só leitura nesta fase; escritas em issues separadas; respostas redigidas (errorlog-core), stdio apenas, opt-in explícito por workspace; testes só com fakes.

## Tentado e descartado

- Ler a pasta de dados diretamente; API de web access; servidor dentro do app; caminho absoluto da pasta de dados no .mcp.json.

## Perguntas abertas

- A confirmação real de pickup por uma sessão Claude Code (pessoa), asar e Windows: segue não verificado.
- Gates não confirmados nesta tentativa: tsc limpo final, vitest completo, theme-audit, i18n:lint, public-audit (targeted vitest verde; ver 3_IMPLEMENTATION.md).

## Onde o trabalho está

- Código e testes na worktree, na ordem do plano (config → tools → server/entry → build entry → módulo + Settings → CHANGELOG). Pendências imediatas: rodar os cinco gates, os testes escritos-não-checados (mcp-state-redact, config-mcp-state, mcp-state-entry, mcp-state-build) e a verificação da pessoa da entrada numa sessão real.
<!-- handoff:19 -->
<!-- handoff:42 -->
<!-- handoff:52 -->
- Passagem developer → próxima etapa: implementação feita conforme 2_PLAN.md (idades/desvios: procedures é leitura real, caminho absoluto na entrada; canais mcpstate desktop-only). Rodar os gates que faltam antes da revisão.

Para etapa pausando em pergunta, string vazia; aqui
- Passagem support → product-owner: Refinement: decide whether the stdio MCP server runs inside the app or as a separate process reading through the app's store code; decide which workspace it serves and how the terminal session picks it; confirm the read set (runs, conversation, evidence, #179 procedures, activities); coordinate with #179 so its store is shaped for outside reads. Product refinement may look at how a Claude Code session picks up a stdio server in its settings. <!-- handoff:7 -->
