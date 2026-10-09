# Memória do ciclo

## Decisões

- Pedido de funcionalidade (enhancement), não bug nem duplicada; entendível como está.
- Sugerido (não decidido pela pessoa): priority:medium; squad Plataforma (trabalho do runtime, um toggle de opt-in na Settings).
- **Refinement (1_SPEC.md):**
  - Servidor é um **processo stdio separado** reutilizando o código de leitura e mascaramento do app — funciona com o app fechado; alternativa dentro do app rejeitada (morre com o app).
  - **Um workspace por instância**, nomeado por variável de ambiente na entrada de configuração; sem leitura cruzada de workspaces; variável ausente/inválida → erro, nunca chute.
  - **Sessão de terminal escolhe pela entrada no .mcp.json do projeto** — mesma forma {mcpServers} que o app já lê (verificado em src/main/engine/open/tools/mcp.ts). Settings mostra a entrada copiável e oferece escrevê-la.
  - **Conjunto de leitura confirmado:** lista de ciclos, runs (stage/status/pergunta ou comando pendente), conversa de um run sem ruído de sistema, lista de evidências de um run, procedure memory do #179, activities memory. Read-only; toda escrita é issue separada, atrás da aprovação que o app já usa.

## Restrições

- Somente leitura nesta fase; escritas ficam para issues separadas.
- Respostas atravessam redact (src/main/errorlog-core.ts: formas de credencial, tokens em headers, URLs com senha, emails, cookies, home folder), nunca arquivos crus.
- Stdio apenas, sem listener de rede, opt-in explícito por workspace na Settings.
- Testes só com fakes (test/helpers/); sem modelo real, host real, rede.

## Tentado e descartado

- Ler a pasta de dados diretamente: o que existe hoje; brittleness, sem redação, acoplado ao formato — a issue já descarta.
- API de web access (browser pareado): feita para pessoa no telefone, não agente.
- Servidor dentro do app: rejeitado no refinement (precisaria do app aberto; frustra o cenário de depuração pelo terminal).

## Perguntas abertas

- A leitura de procedures depende do #179 entregar um store moldado para leituras externas; #179 segue em andamento. As outras leituras são independentes e não bloqueadas.

## Onde o trabalho está

- Triagem (0_TRIAGE.md) e refinement de produto (1_SPEC.md) prontos; sem código alterado nesta rodada (só documento, nenhum gate rodado). Próxima etapa: implementação conforme o handoff de 1_SPEC.md.
- Passagem support → product-owner: Refinement: decide whether the stdio MCP server runs inside the app or as a separate process reading through the app's store code; decide which workspace it serves and how the terminal session picks it; confirm the read set (runs, conversation, evidence, #179 procedures, activities); coordinate with #179 so its store is shaped for outside reads. Product refinement may look at how a Claude Code session picks up a stdio server in its settings. <!-- handoff:7 -->
