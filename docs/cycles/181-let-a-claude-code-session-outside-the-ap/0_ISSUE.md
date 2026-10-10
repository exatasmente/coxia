# 181 Let a Claude Code session outside the app read the app's state through a local MCP server

- Endereço: https://github.com/exatasmente/coxia/issues/181
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

The app's own agents reach its state through app-owned tools (in-process MCP servers: `runner`, `coxia_evidence`, `coxia_attachment`, `coxia_sandbox`, `coxia_vcs`). An agent outside the app has no such door: a Claude Code session in the terminal, or the cycle roles run by hand. It can only read the app's JSON files from the data folder, with no schema guarantee, no masking and no notion of what is current. Debugging why a stage showed no live screen meant reading the run and thread files from disk.

## What you would like to happen

- **A local MCP server of the app**, over stdio, that a terminal session can add. It is read-only at first:
  - the runs of a workspace, with their stage, status and pending question or command;
  - a run's conversation, without system noise;
  - the evidence list of a run;
  - the procedure memory (#179);
  - the activities memory.
- **The same reads the app's own tools give**: the answers go through the app's code, with secrets masked, and never as raw files.
- **Local only, bound to this computer's user:** no network listener, and an explicit opt-in in Settings.
- **Writes later and separately**, each one behind the same approval the app already uses: answering a pending question, posting to a conversation, saving a procedure.

## Alternatives you considered

- **Reading the data folder directly.** This is what happens today. It is brittle, unmasked, and couples outside tools to the file format.
- **The web access (paired browser) API.** It is made for a person on a phone, with pairing and cookies, not for an agent.

## Notes

- Related to #179, whose store should be shaped so this server can read it.
- Whether the server runs inside the app (needs the app open) or as a separate process reading through the app's store code (works with the app closed) is for the refinement.

## Comentários

(sem comentários)
