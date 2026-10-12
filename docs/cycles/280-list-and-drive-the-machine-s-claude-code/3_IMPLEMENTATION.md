# Sondagem do SDK feita; implementação ainda por fazer

## Estado desta tentativa

Só o **passo 0** do plano (a sondagem) foi feito. Os passos 1 a 7 (configuração, fronteira, emissor só da janela, núcleo, auditoria, tela e documentação) **não foram implementados**. Nenhum arquivo do repositório mudou, nem typecheck nem testes rodaram, porque não houve código novo.

## O que foi rodado

- `npm ci --no-audit --no-fund --ignore-scripts` no worktree: saiu com código 0 e 689 pacotes. `node_modules/` está no `.gitignore`.
- Leitura de `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.
- Sondagem de `~/.claude/sessions` e `~/.claude/daemon`: foram listados só os nomes dos arquivos e impressos só os nomes de campo e os valores de enum. Nenhum `.key`, `control.key` nem `.credentials.json` foi aberto.
- `grep` no binário do CLI empacotado para achar os valores de `kind`.

## Resultado da sondagem

| Plano supunha | Encontrado no SDK instalado |
|---|---|
| `listSessions` | `listSessions({dir?, limit?, offset?, includeWorktrees?, includeProgrammatic?})`, que devolve `SDKSessionInfo {sessionId, summary, lastModified, customTitle?, firstPrompt?, gitBranch?, cwd?, createdAt?, tag?}` |
| leitura de mensagens | `getSessionMessages(id, {dir?, limit?, offset?, includeSystemMessages?})`, que devolve `SessionMessage {type, uuid, session_id, message: unknown, parent_tool_use_id}` |
| bifurcação | `forkSession(id, {dir?, upToMessageId?, title?})`, que devolve `{sessionId}`; existe também a opção `forkSession` de `query` junto com `resume` |
| gancho de permissão | `Options.canUseTool(toolName, input, {signal, decisionReason?, blockedPath?, ...})`, que devolve `{behavior:'allow'}` ou `{behavior:'deny', message}` |
| interromper | `Query.interrupt()` |

Fonte das sessões em execução e em segundo plano, sem tocar nas chaves:
- Cada processo grava `~/.claude/sessions/<pid>.json` com os campos `pid, sessionId, cwd, startedAt, kind, status, entrypoint, name, updatedAt` (e outros). O arquivo `<pid>.<x>.key` ao lado é proibido.
- Valores de `kind`: `interactive` e `background`, as únicas duas strings achadas no CLI. Valores de `status`: `idle` e `busy`.
- Para saber se o processo está vivo basta `process.kill(pid, 0)`.
- `~/.claude/daemon/roster.json` tem só `proto, supervisorPid, updatedAt, workers` e não é necessário.

Consequência: a **decisão 8 do plano vale inteira**, sem a versão reduzida. O `guardedRead` lê só `sessions/<digits>.json` e devolve só `pid, sessionId, cwd, kind, status, updatedAt`. A **decisão 10** (bifurcação) pode marcar como presa por outro processo a sessão cujo `sessionId` aparece num `<pid>.json` vivo que não está em `owned`.

## O que falta (passos 1 a 7 do plano, nenhum começado)

Todos seguem como descritos em 2_PLAN.md, com os testes da tabela de testes. Os portões do AGENTS.md não foram rodados.
