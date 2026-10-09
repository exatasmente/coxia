# Local read-only state server for terminal sessions

## What changes for the user

Today an agent outside the app — a Claude Code session in the terminal, or a cycle role run by hand — has no door into the app's state. It can only read the data folder's JSON files directly, with no guarantee of what is current and no masking of secrets. This change gives it a real door: a local, read-only server of the app, over standard input and output, that a terminal session adds once and then uses to see the runs, conversations, evidence and memories of a workspace — with secrets masked, exactly as the app's own agents see them.

The issue asks for this, quoted:

> **A local MCP server of the app**, over stdio, that a terminal session can add. It is read-only at first:
> - the runs of a workspace, with their stage, status and pending question or command;
> - a run's conversation, without system noise;
> - the evidence list of a run;
> - the procedure memory (#179);
> - the activities memory.

> **The same reads the app's own tools give**: the answers go through the app's code, with secrets masked, and never as raw files.

> **Local only, bound to this computer's user:** no network listener, and an explicit opt-in in Settings.

## Decisions made by this refinement

**1. The server runs as a separate process, not inside the app.**
It is a stdio process that reuses the app's read and masking code, so a terminal session can read state even with the app closed. That matches the scenario the issue names — debugging a run from the terminal — where the app may not be open. The alternative, a server inside the app, would see live state but would go away with the app and could not serve a session while it is closed.

**2. One workspace per server instance; the session picks a workspace through the setup entry it adds.**
Each workspace that enables the opt-in gets its own server configuration, and that configuration names that workspace's data folder through an environment variable. A session in a workspace's project folder picks up that workspace's entry; a person who wants two workspaces in one session adds two entries with distinct names. The server answers only about the workspace it was configured for — it never reads other workspaces.

**3. The terminal session picks the server up the way Claude Code sessions already pick servers up: a project `.mcp.json` entry (or the equivalent add command).**
The Settings panel, as part of the opt-in, shows the exact entry to add, and offers to write it into the workspace's project folder. This was checked against how the app itself reads server entries: a `{"mcpServers": { ... }}` file, remote (http/sse) entries skipped, local stdio entries spawned on demand. The entries the app shows follow that same shape.

**4. The read set is confirmed as the issue lists it**: the workspace's cycles; the runs of a workspace, with stage, status and pending question or command; a run's conversation without system noise; the evidence list of a run; the procedure memory of #179; the activities memory. Nothing more is read in this phase.

## Rules

1. Every answer the server gives passes through the app's own read code and its secret masking. No tool ever returns a raw file path or a raw stored file.
2. The masking covers the shapes the app already masks for its own tools: credentials by their shape, tokens in headers, addresses with passwords, emails, cookie names, and the computer's home folder.
3. Each read answers the state as the app's files declare it at the moment of the call — refreshed per call, never a stale snapshot from the server's start.
4. Fully read-only. Answering a pending question, posting to a conversation, saving a procedure, and any other write come later as separate issues (the issue itself parks them there), each behind the same approval the app already uses.
5. The server talks over standard input and output only. No network port is opened and no address is bound. It runs as the computer's user and can read only that user's data folder for its one workspace.
6. The server is off unless the person explicitly opted in for the workspace in Settings. Turning the opt-in off stops new server sessions from working.
7. The workspace is known only from the environment variable of the server's setup entry. With the variable missing or invalid, every tool answers an error naming the problem, never a guess and never data from another workspace.

## Acceptance criteria (each verifiable by someone testing)

1. With the opt-in on for a workspace, Settings shows a copyable server entry for that workspace and offers to write it into the project folder's server settings file; with the opt-in off, it shows none and offers nothing.
2. A Claude Code session in that workspace's project folder, started after the entry exists, lists the read tools below among its available tools; a session started without the entry (or with the opt-in off) lists none. Checkable through the session's own server display.
3. The cycles read answers the same cycle list the app itself shows for the workspace, and nothing of any other workspace configured on the machine.
4. The run read for a run that is waiting answers its stage, its status, and — when one is pending — the exact question the app asked the person, or the command the stage is waiting to have approved.
5. The conversation read for a run answers its conversation as the run saw it, without system lines; a known secret shape planted as text comes back masked.
6. The evidence read for a run answers the recordings that stage saved (names, paths, what they capture), the same list the run's stage shows.
7. The activities read answers the run's activity records, the same ones the run's memory shows at the end of a stage.
8. With the app closed, every read still answers, with the state as the files declare it and refreshed per call.
9. No tool can write: trying to answer a pending question or post a note finds no such tool, and nothing in the app's files changes as a result of any read.

## Out of scope

- Every write: answering a pending question, posting to a conversation, saving a procedure, and any other mutation. Each comes later as a separate issue, behind the approval the app already uses.
- Anything beyond the confirmed read set: cycle templates, agent configs, code-host reads, remote (http/sse) serving, cross-workspace reads.
- The paired-browser API as an access path; the issue discards it (made for a person on a phone, not for an agent).
- Building the #179 store beyond what this server needs to read it: that issue is its own and is in progress; its store becoming reachable and shaped for outside reads is a prerequisite this issue depends on, not one it builds.

## Blocking questions

- The procedure read depends on #179 landing a store shaped for outside reads. It blocks that one read; the other reads are independent and unblocked.

No other blocking questions: the form (separate process), the workspace pick (one per instance, via the setup entry) and the pickup path (project settings file) are settled above.

## Verification statement

Verified here by reading, not executing: the issue as written (with its comments, none); the triage as written; the app's own reading of server entries from `{"mcpServers": ...}` files, remote skipped, stdio spawned on demand; the app's masking helper and the shapes it covers; the `coxia_*` naming of the app's own agent toolsets and the procedures toolset of #179. Not verified: what a real Claude Code session does with the new entry, the acceptance criteria themselves, and the cost of the implementation — later steps of this cycle.
