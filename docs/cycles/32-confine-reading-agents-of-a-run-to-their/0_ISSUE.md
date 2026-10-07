# 32 Confine reading agents of a run to their worktree on the Claude Agent SDK engine

- Endereço: https://github.com/exatasmente/coxia/issues/32
- Estado: open
- Rótulos: bug, coxia, priority:high
- Autor: exatasmente

## Descrição

## Scope (updated 2026-10-06)

Give a reading agent of a run (a stage, a mention, a question chain) on the Claude Agent SDK engine the read guard writers already have: `Read`, `Grep` and `Glob` confined to the worktree and the cycle folder, with the refusal said in the thread and the activity.

- A field of its own (for example `readRoot`), not `confine`: `confine` also opens Edit/Write and the shell.
- Decide the documentation folders listed outside the worktree (`extraDirs`): out, or an explicit allow list.
- Tests: a link out, `..`, `~`, `.git`, an absolute path.
- Do not loosen the secret and broad-search guards.

---

## The problem

An agent with `permission: read` that runs on the Claude Agent SDK engine is not confined to its run's worktree: its `Read`, `Grep` and `Glob` can reach files outside it (only secret-looking names are refused). The worktree guard (`src/main/engine/guard.ts`) confines the agents that write; the readers rely on the SDK's own working directory, which is not a boundary.

Found while writing the threat model of #30 (T9): a symbolic link planted in a worktree adds nothing for such a reader, because it can already read outside.

## What we want

A reader on either engine reads only inside its run's worktree (and the cycle folder in it), with the same rules the guard applies to writers: no absolute path outside, no `..`, no `~`, no link that leads out, nothing under `.git`, no secret files. A refused read goes to the run's thread and the live activity as "blocked", like the other refusals.

## Notes

- The ceremonies' agents (daily, unblock, retro) read the projects folder on purpose and are out of scope; this is about the runner's team agents.
- @mention and question-chain calls are readers too and get the same confinement.

## Comentários

### exatasmente, 2026-10-06T19:02:18Z

Escopo afinado: a sandbox só cobre o `Shell`; `Read`, `Grep` e `Glob` de um agente leitor no motor SDK não passam pelo `readGuard`, que hoje só é montado para quem escreve (`src/main/runner/executor.ts`, `confine: writes ? … : undefined`). Prioridade alta mantida.
