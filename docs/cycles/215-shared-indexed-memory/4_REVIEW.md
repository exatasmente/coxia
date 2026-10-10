# Review of the shared, indexed memory

Reviewed in a session separate from the one that wrote the code, against the approved spec and plan, the repository's rules and the domain rules. Base: `release/0.9.0` at `0.9.0-beta.14`.

## Verdict

Merge. No blocker and no major. The delivery covers rules 1 to 15 and acceptance criteria 1 to 13 of the spec. With the switch off, the behaviour is the old one, and no prompt golden moved.

## Gates at review time

`npx tsc --noEmit`, `npx vitest run` (452 files, 7629 tests passed, 3 skipped), `node scripts/theme-audit.mjs`, `npm run i18n:lint` (5738 keys in both languages) and `node scripts/public-audit.mjs`: all green.

## What was checked

- **Notes of others.** An agent cannot write, forge or remove another agent's note or a note the person edited. Ownership, the person's edit, the review wait and the revision live in the app's state file; the note header decides nothing.
- **File tools.** The memory folder is out of reach of the file tools in both engines, with `runner.unconfined` on, through links and from a sub-agent.
- **Agent-written text.** It is validated and masked on write, masked and fenced as data on read, and never a source of tools, hosts or permissions.
- **Paired phone.** The phone's channels are named on purpose, and their origin is audited.
- **Migration.** The v26→v27 step raises no permission.
- **Read-only places.** Notices carry pointers only and are never repeated. Ceremonies, the question chain and squad requests only read.

## Findings

Fixed before merge (see `3_IMPLEMENTATION.md`):

1. A note the person edits (on the screen or on disk) skipped the check for invisible and direction-changing characters, the one the procedures validator refuses.
2. A test pinned the wording of a source comment instead of the policy.
3. The version line of the index was not clipped and could crowd the list out.
4. The version was read repository by repository in sequence.
5. Saving a note from a channel without a revision skipped the stale check.

Left as follow-ups:

- **Direct reads.** Where a reader agent is not confined by path (a mention outside a run), it can read the memory folder directly. The review wait and the fence then bind only the tool path. The spec accepts this (rule 4); a read deny like the browser profiles' would close it.
- **Notices across runs.** The "written by the agent that works the run" notice rule fires across concurrent runs, because agent ids are team-wide. It is capped and merged, but may be noisy with more than one run.
- **Utility calls.** The list also reaches the utility calls behind `askAgent` (effects, diagram fix, agent preparation, suggestions, feedback).
- **Ceremony turns.** A ceremony turn builds the index on the main thread: about 160 ms cold, about 35 ms warm.
- **Smaller points:** a notice re-seeded after a restart reads at most 2000 messages; the refusal text on the screen comes from the main process, for codes the screen does not map; the exact-value mask is not applied to the prompt list; a 32-bit id collision across folders resolves to the first match.

## Not verified

- **The Claude SDK's built-in sub-agent.** Whether it reaches the memory tools, and whether the write-refusal hook fires for it.
- **Notice timing.** A notice handed over in the last step of a stage, in either engine.
- **The running app.** The Memory screen and a real paired browser.
- **A real model** reading a note and changing course.
- **Cost.** The token cost of the list at scale.
- **Concurrency.** Two app instances on one data folder.
