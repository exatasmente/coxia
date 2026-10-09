# Memória do ciclo

## Decisões

- Pedido de funcionalidade (enhancement), não bug nem duplicada; priority:medium sugerido; squad Plataforma.
- **Refinement (1_SPEC.md):** servidor é um **processo stdio separado** reutilizando o código de leitura e mascaramento do app (funciona com o app fechado); **um workspace por instância**, nomeado pela entrada de configuração; sessão de terminal escolhe pela entrada no .mcp.json (mesma forma {mcpServers} que o app lê, src/main/engine/open/tools/mcp.ts); Settings mostra a entrada copiável e oferece escrevê-la; conjunto de leitura confirmado: ciclos, runs (stage/status/pergunta pendente), conversa de um run sem ruído de sistema, evidências, procedure memory do #179, activities memory. Read-only; escrita em issues separadas.
- **Plano (2_PLAN.md), decisões D1–D10:** a) nova entrada de build `mcp-state` em electron.vite.config.ts → out/main/mcp-state.js, rodada por `node`, sem Electron nem pacote npm (o SDK não pode ser redistributed); b) workspace nomeado pelo **id** (env `CERIMONIAS_MCP_WORKSPACE`), resolvido pelo registry (workspaces-core) com DATA_ROOT de env.ts e override `CERIMONIAS_DATA_DIR` — nada de caminho absoluto no .mcp.json; env ausente/id inválido → erro em toda resposta; c) servidor `coxia_state`, ferramentas `coxia_state_*`; d) módulos `mcp-state/server.ts` (JSON-RPC espelhando McpClient) e `mcp-state/tools.ts` (leituras puras); e) só código electron-free importado (runs-core, board-core, forum-core, evidence/store, errorlog-core, shared/i18n); f) **critério de aceite 4 revisto:** comando pendente nunca é salvo no run (src/shared/runs/types.ts) — a leitura responde à pergunta e "none" com motivo para comando; g) `coxia_state_procedures` é recusa constante até o #179 entregar o store; h) escrita do .mcp.json é ação da pessoa na Settings, merge sem sobrescrever entrada estrangeira; i) caminhos máquina-só, `shrinkHome` no que aparece em tela; j) mascaramento por superfície (redact em prosa, redactDoc no board).
- **Plano — ordem e testes:** config (types.ts, defaults.ts, schema.ts, migrations v23→v24 com `mcpState: { enabled: false }`, CONFIG_SCHEMA_VERSION = 24) → tools → server → entrada de build → Settings + CHANGELOG. Testes: mcp-state-server, mcp-state-tools, mcp-state-redact, config-mcp-state, settings-mcp-state, mcp-state-build (sem import de electron), com fakes e streams em memória.

## Restrições

- Somente leitura nesta fase; escritas ficam para issues separadas.
- Respostas atravessam redact (src/main/errorlog-core.ts); nunca arquivos crus.
- Stdio apenas, sem listener de rede, opt-in explícito por workspace na Settings.
- Testes só com fakes (test/helpers/); sem modelo real, host real, rede.

## Tentado e descartado

- Ler a pasta de dados diretamente (brittleness, sem redação) — a issue descarta.
- API de web access (para pessoa no telefone, não agente) — descartada.
- Servidor dentro do app — rejeitado no refinement.
- Caminho da pasta de dados no env da entrada de configuração — descartado no plano: vazaria pastas da máquina num arquivo que pode ser commitado; o id do workspace resolve pelo registry.

## Perguntas abertas

- Leituras dependem de código electron-free confirmado na implementação (forum-core.ts e render de atividades ainda não conferidos como electron-free).
- Entrada dentro de asar (install empacotado: o node não alcança) → oferta escondida em Settings com motivo; comportamento em Windows não planejado.
- Procedures: esperam o store do #179 (em andamento).

## Onde o trabalho está

- 0_TRIAGE.md, 1_SPEC.md e 2_PLAN.md prontos; nenhum código alterado (etapas de palavras; nenhum gate rodado). Próxima etapa: implementação na ordem do plano.
- Passagem product-owner → implementação: construir o servidor stdio conforme 1_SPEC.md e 2_PLAN.md: processo separado reutilizando leitura e mascaramento; um workspace por instância via entrada de configuração; toggle por workspace na Settings com entrada copiável e oferta de escrita no projeto; primeiro as leituras independentes — ciclos, runs, conversas, activities, evidências — com mascaramento; procedures espera o store do #179. Testes com fakes, strings por t() nos dois catálogos, mudança no CHANGELOG. <!-- handoff:19 -->
- Passagem tl-plataforma (plano) → implementação: seguir 2_PLAN.md na ordem dada; honrar a revisão do critério 4 (D6) e a recusa constante de procedures (D7); conferir electron-freeness de forum-core/atividades ao ligá-las; rodar os cinco gates antes de fechar. Não verificado: pickup real por uma sessão externa (verificação da pessoa), asar e Windows.
- Passagem support → product-owner: Refinement: decide whether the stdio MCP server runs inside the app or as a separate process reading through the app's store code; decide which workspace it serves and how the terminal session picks it; confirm the read set (runs, conversation, evidence, #179 procedures, activities); coordinate with #179 so its store is shaped for outside reads. Product refinement may look at how a Claude Code session picks up a stdio server in its settings. <!-- handoff:7 -->
