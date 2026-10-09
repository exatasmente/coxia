# Triage of the local read-only MCP server request

## Type

Feature request (enhancement). Not a bug, not a question, and not a duplicate of an open issue.

## Is it understandable as written?

Yes. The issue was read as written, and the code it cites was checked (read, not executed):

- The in-process MCP servers the issue names exist: the app wires servers such as `runner`, `coxia_evidence`, `coxia_attachment`, `coxia_sandbox` and the VCS read server (engine tool modules under `src/main/`; tests such as `test/browser-agent-screen.test.ts` list `coxia_browser` and `coxia_screen`). An outside agent has none of these; it would read the data folder's JSON directly, which is what the issue describes.
- The masking the issue asks for already exists inside the app: a `redact` helper (main-process secret redaction) is applied along the paths that bring model or tool output to the screen. The request is to route the new server's answers through the same code, which matches how the app already works.
- The dependency on #179 is real: that cycle (procedure memory) is in progress; its store is not yet read here because the design is not settled. What #179 must leave behind for this issue is a store that is reachable and shaped for outside reads — that constraint can be noted at refinement.

How it was checked: issue, catalogs and the cited code directories were read; nothing was executed this round. The stated reproduction (debugging a stage without a live screen meant reading run and thread files from disk) is consistent with how outside access works today, but reproducing it was not attempted.

## What is missing

Nothing that blocks triage. The issue itself already parks the two open design questions at their right stages:

- whether the server runs inside the app or as a separate process — left for refinement;
- writes, deferred to a later, separate issue.

One thing the issue does not pin down and refinement should decide: which workspace(s) the server serves when several are configured, and how the terminal session picks one. This is a design decision, not information only the reporter can give.

## Related issues

- #179 (procedure memory): related, not a duplicate. This issue lists it explicitly and can be held to the shape of that store; #179 is in progress.

## Suggested priority (suggestion only)

`priority:medium`: a developer-facing capability that improves debugging and lets terminal sessions share the app's read path, but nothing breaks without it.

## Suggested squad (suggestion only)

Plataforma: the work is on the runtime side — a stdio server serving the runs store behind the app's existing read and redaction code — with only an opt-in toggle in Settings touching the experience side.
