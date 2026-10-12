# 281 Let the runner hand a task to a Claude Code session and read its result

- Endereço: https://github.com/exatasmente/coxia/issues/281
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

Coxia's runner and agents cannot hand a task to a Claude Code session on the machine and read its result.

## What should happen

- Coxia's runner and agents can hand a task to a Claude Code session and read its result, through one channel the app owns. The candidates are the Agent Client Protocol (ACP) adapter for Claude Code and the Agent SDK the app already ships (which has `listSessions`, `resume`, `forkSession`, `canUseTool`); the plan picks one and says why.
- A task handed this way follows the same rules as any agent of the run: its permission requests come to the person, and its writes stay inside the run's worktree.
- The `coxia-state` MCP server is not the way in: this channel goes from Coxia to Claude Code, not the other way round.

## Boundaries

- Off by default, desktop only; denied to the paired phone and to the persona.
- A workspace with `test: true` refuses it.
- Nothing from `~/.claude` goes into tests or fixtures.

## Acceptance

- A stage configured to hand its task to a Claude Code session gets the session's result back in the run.
- A permission request from that session reaches the person as a pending item; the stage waits for it.
- A write outside the run's worktree is refused.
- With the option off, no stage reaches a Claude Code session.

Split from #262 (delivery 3). Depends on the sessions issue (deliveries 1 and 2).

## Comentários

(sem comentários)
