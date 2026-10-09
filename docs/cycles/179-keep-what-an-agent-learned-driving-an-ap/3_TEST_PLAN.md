# Learned procedures: test plan and what was verified

Review pass over acceptance criteria 1 to 27 of `1_SPEC.md`, made at the end of phase E on the branch of the implementation. For each criterion: the test files that cover it (all under `test/`, all with fake engines, fake logs and neutral hosts, in a temporary data directory), or "by hand". One gap was found and closed in this pass (criterion 20, the used line is a system line); nothing else needed a fix.

## Acceptance criteria

| # | Covered by |
|---|---|
| 1 | `procedures-draft` ("one step per action, in order…", label cut, address cleaned and `:id`, measured waits, failed action as a pitfall candidate, undone step dropped); `procedures-screen` (the steps are those since the call began) |
| 2 | `procedures-draft` ("never carries a typed value", hand-off is one step with no content); `procedures-gui` ("what the person typed in a hand-off": plain, URL-encoded and JSON-escaped forms refused in any field of any kind, nothing written, log has the field and no value); `procedures-screen` (the masker's hits); `procedures-gui-calls` (conversation and stage) |
| 3 | `procedures-gui` (save needs a draft; recorded steps kept; dropped and reworded steps marked `edited`; a step the app did not record refused; a record from a hand-off call waits for review); `procedures-ui` (the waiting notice) |
| 4 | `procedures-gui` (key from the pages visited, sandbox and computer; shell-only work leaves no `gui` record, other kinds still written); `procedures-screen` (visited hosts, none for shell work); `procedures-draft` (nothing to draft for shell work) |
| 5 | `procedures-gui` ("replacing a gui procedure the call followed": existing id, comparison, revision up, `previous` kept, no second record); `procedures-draft` (offer with comparison) |
| 6 | `procedures-record` (quote over 40, query and fragment, digit run, reason never echoes the value); `procedures-gui` (step, note or wait refused by field) |
| 7 | **By hand.** A real model driving a real site through the app's browser, then a second run showing "Used: …" and fewer tokens on the stage card |
| 8 | `procedures-record` (shape, every cap, title characters, key form per kind, newer `v` not read as invalid); `procedures-store` (a record of a newer app is not listed, read or overwritten) |
| 9 | `procedures-store` ("atomic and checked": a failing write leaves the old file; two saves on one revision give one success and one "changed since you read it") |
| 10 | `procedures-store` ("where records live": never in a worktree or a cycle folder; a file an agent writes is not a record) |
| 11 | `procedures-store` ("the caps": 10 per kind and key, 300 per workspace, near-duplicate title, nothing evicted) |
| 12 | `procedures-store` (replacement keeps one `previous`; stale sets `failing`, `lastFailed`, step; replacement returns to `unverified`; a read with no failure sets `ok` and `lastVerified`; a 90-day-old record is still listed and old); `procedures-record` (old after 90 days) |
| 13 | `procedures-engine` (open engine and SDK server over the same handlers; offered to a reading agent; server not built when the SDK cannot load, and the thread says so once); `procedures-tools` (refusals come back as text, a failing store never throws) |
| 14 | `procedures-select` (contexts, order, 25 entries and 2,000 characters with "N more", small window shrinks the list, titles with brackets or breaks never reach the prompt, no body in a line); `procedures-surfaces` (user side, fenced, rules in the system text); `procedures-tools` (body only from `procedures_get`) |
| 15 | `procedures-surfaces` (stage, direct conversation, squad channel, forum thread, agent in a run's thread, called agent get them; a ceremony does not; "ignore your rules" adds no tool, host or permission) |
| 16 | `procedures-record` (credential in a command refused, not masked); `procedures-tools` (credential refused, nothing written); `procedures-channels` (the person's edit refused as the agent's, every field at once) |
| 17 | `procedures-policy` (three reads open, the rest and a made-up channel denied, with or without the external-effects switch; none in a set by name; every registered channel classified; no channel for the agents' tools) |
| 18 | `procedures-retention` (a sweep over very old records neither lists nor removes them; the activities memory and the procedures never touch each other's files) |
| 19 | `config-schema`, `config-migrations` (21 to 22: off for a migrated workspace, on for a new one), `runner-config`, `team-runner-edit`, `config-web-scope` (a paired browser cannot raise or lower it); `procedures-surfaces` (switch off offers no tool, no list, no rules); `procedures-channels` (the view lists, edits and deletes with the switch off) |
| 20 | `procedures-surfaces` (the thread marks the use; the line is `kind: system`, which the prompt builders leave out); `procedures-run` (id, revision and outcome on the stage record, run format 5); `procedures-chip` (the chip, both languages) |
| 21 | `procedures-surfaces` ("a conversation answer that read a procedure records its use and usage; one that read none records nothing") |
| 22 | `procedures-usage` (baseline, last 20, no saving under 3 uses or when not below, "approximate", cost only where reported and as an estimate where the usage says so); `procedures-store` (last 20 kept, baseline once); `procedures-ui` (the comparison in words) |
| 23 | **By hand** on a throwaway data directory. The render of the figures is covered by `procedures-ui` |
| 24 | **By hand** for the screen. The behaviour behind it: `procedures-channels` (filters, edit, review, restore, delete, id not reused, an agent holding the id is told); `procedures-edit` (the controls on the computer, the form, the words for a refusal) |
| 25 | **By hand** for the screen in a paired browser. Behind it: `procedures-edit` ("draw nothing in a paired browser"), `procedures-policy`, `config-web-scope`, `procedures-ui` (read only body) |
| 26 | `procedures-tools` (a save, a stale report: a thread line and an audit entry with agent, id, revision and title, never a step); `procedures-channels` (the person's entry: no issue, no thread, no step) |
| 27 | `npm run i18n:lint` (5,294 keys in both languages), `procedures-ui`, `procedures-chip` and `procedures-edit` (both catalogs, same placeholders), `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs` |

## Deliberate differences from the spec

- Criterion 26 asks for a thread line for each delete. The plan (D8) audits the person's writes (edit, review, restore, delete) with no thread line, because a workspace-level action has no thread; the agent cannot delete. A save or a stale report by an agent leaves both.

## Gates (phase E, branch of the implementation)

`npx tsc --noEmit` clean; `npx vitest run` 384 files, 6,312 tests passed; `node scripts/theme-audit.mjs` exit 0; `npm run i18n:lint` exit 0; `node scripts/public-audit.mjs` clean; `npx electron-vite build` built.

## What was not verified, and is left to be checked by hand

On a throwaway data directory (`CERIMONIAS_DATA_DIR` and `CERIMONIAS_SPECS_DIR` on empty folders), never the real workspace:

1. **Criterion 7.** A real model drives a real site through the app's browser, calls `procedures_draft`, saves; a second run of the same task shows the title in the prompt ("Used: …" in the thread) and fewer model tokens than the baseline on the stage card.
2. **Criterion 23.** After a repository procedure is used three times, the view shows the baseline, the three uses and the approximate saving with its label.
3. **Criteria 24 and 25.** The Procedures screen on the computer (filters, record panel, Edit, Mark as reviewed, Restore the previous, Delete with its confirmation) and in a paired browser (the list and a record open, no control to change anything, a direct call of a write channel refused).
4. **The SDK engine with a fourth in-process server** beside the evidence, runner and shell ones: the tests build the object, not the SDK's own run.
5. **A hand-off against a real viewer**, to see that what a person typed is refused in a save. The test feeds the masker the values; the feed from a real viewer is the other change's.
6. **The prompt rules in a real model**: whether it saves too much, too little or under the wrong key is judged in the view and by the comparison, not by a test.
