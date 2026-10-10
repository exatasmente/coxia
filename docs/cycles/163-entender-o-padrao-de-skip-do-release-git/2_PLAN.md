# Plan to examine why each release step was skipped

## Purpose

A plan to execute the exam specified in `1_SPEC.md`: list every step marked skipped in the releases of issues 75, 151 and 115, say who skipped it and why, classify each skip, name repeated patterns, and finish with a short conclusion before the next beta cut. This delivery changes no code: it plans the reading, where the records live, and how each acceptance criterion will be met.

## Where the data lives

Verified in this tree:

- One run per cycle is persisted as a JSON file in the workspace data folder: `<workspace>/runs/<id>.json` (see the header of `src/main/runs.ts`). Each run file carries the stages, their statuses (`running`, `waiting`, `done`, `skipped`, `rejected`, `failed`, `cancelled` — `STAGE_STATUSES` in `src/shared/runs/types.ts`) and the history entries of the run.
- Skip decisions leave typed history entries: `gate-skipped` and `wait-skipped` in `HISTORY_TYPES` (`src/shared/runs/types.ts`). Both are logged with the reason text and author (`log(out, at, 'gate-skipped', …)` inside `gateSkip` at `src/shared/runs/transitions.ts:361-369`; `wait-skipped` at `src/shared/runs/transitions.ts:858`).
- The same decisions are published as public forum messages with codes `gate.skipped` and `wait.skipped` (`src/shared/runs/transitions.ts:369` and `:859`), rendered with the catalog strings `main.forum.code.gate.skipped` / `main.forum.code.wait.skipped`. Forum threads are read through the forum store (`src/main/forum.ts`), also under the workspace data folder.
- Release actions carry `state: 'skipped'` (`ActionState` in `src/shared/types.ts:419`) and are part of the run file; release steps are grouped per stage (`r:<stage>:<n>`, `src/shared/release.ts`) and a redo creates a new group, which is what tends to leave stale pending steps that get skipped.

Not verified and checked first during execution: that the run files and forum threads of the three named runs still exist and hold history entries intact. If a record is missing, criterion 3 (count matches) is reported with the gap, and the "no trace" classification covers what cannot be classified.

## Work order

1. **Locate and open the three run files.** Find the run ids of the cycles behind issues 75, 151 and 115 (each run file and its forum thread carry the issue link the cycle works on). Open each with a script or the Read tool; no workspace other than the maintainer's real one is modified, and nothing is written anywhere but the cycle folder.
2. **Extract the raw skip lists.** For each release, walk the run file and collect:
   - stages with `status: 'skipped'` and the history entries `gate-skipped` / `wait-skipped` that ended them (stage label, author, reason text, timestamp);
   - release-git actions with `state: 'skipped'` (action label, stage, group id `r:<stage>:<n>`, whether a redo superseded the group);
   - any other occurrence of the literal state `skipped` that touches release work only (the exam does not extend to wizard steps, conflict verifies or suggestion cards, which are out of the spec's scope).
3. **Cross-check with the forum thread.** For each decision found in the history, find the matching public forum message (`gate.skipped` / `wait.skipped`) and record where the information came from — run history, forum decision, or both (criterion 6).
4. **Classify each skip**, exactly one type per skip:
   - `gate decision` — ended by `gate-skipped` with the person as author and a registered reason;
   - `wait decision` — ended by `wait-skipped` with the person as author and a registered reason;
   - `redo leftover` — a release-git action in a superseded group (a newer group exists for the same stage) that ended skipped as part of moving on;
   - `other` — anything that fits neither, with a one-line description of what the record shows;
   - `no trace` — no reason text and no surrounding record enough to classify (spec rule 7).
   Classification rules verified in code to keep this mechanical: a gate or wait skip only ever happens with a non-empty reason written by the person (`gateSkip` rejects an empty reason; the skip path logs `person` as author), so an empty reason on a release action strongly indicates a redo leftover — checked by looking for a newer group of the same stage before falling back to `other`/`no trace`.
5. **Tally and name patterns.** Per release: total skips, count per stage, count per type; a pattern is the same stage and the same type appearing more than once (criterion 5). Quote every reason exactly as recorded (no translation, no summary — rule 6).
6. **Write the report.** One section per release (75, 151, 115), with the individual list, the tally, the named patterns, the source for each entry, and a closing short conclusion: what the pattern suggests changing, or "nothing to change" (criterion 7).

## Acceptance-to-method map

| Criterion | How the plan meets it |
|---|---|
| 1, 2 — every skipped step listed, per release, with stage, who, reason (or "no trace") | The extraction walks the whole run file; a stage reached `done` is not listed, only `skipped` |
| 3 — the listed count matches the visible skipped count | The count is derived from the same file in one pass: every occurrence of the skip state is either listed or explicitly excluded with a reason, and the sum is stated |
| 4 — exactly one type per skip | The classifier is a decision table, not judgment: history type + author + reason presence + group supersession decide uniquely |
| 5 — repeated patterns named | Tally step produces them mechanically from the list |
| 6 — source per entry recorded | The forum cross-check step records the source for every row |
| 7 — short conclusion | Written last, from the named patterns only |
| 8 — before the next beta cut | The exam stage runs before the release stage picks the next cut |

## Risks and how they are avoided

- **Records missing or thin.** The exam's first step verifies existence and completeness of the three run files and their forum threads; the `no trace` classification and the per-release count-with-gaps report absorb the shortfall without inventing reasons.
- **Count disagreements.** The visible skipped count in a run is taken from the same run file used for the list, so criterion 3 is a self-check rather than a reconciliation against a second source; if the summary screen counts differently, that discrepancy is itself reported as a finding.
- **Drowning in the dozens of skips of run 75.** The extraction is mechanical (one walk, one decision table), so the volume is handled the same way as the small ones; patterns emerge from the tally, not from reading each row by eye.
- **Classification drift.** The decision table is fixed in this plan before any record is read; a skip that does not fit the table lands in `other` with its raw record, never forced into a comfortable type.
- **Scope creep into flow changes.** Out of scope per the spec: no rule, text or data changes; the conclusion only *suggests*, and any change becomes its own request after the findings.

## Decisions

- **Inspect run files directly rather than only through the app screens.** The screens render the same records the files hold, but the files carry author, reason text, group ids and timestamps together; a single automated walk gives exact counts for criterion 3. The screens are still examined where a count mismatch needs explaining.
- **Fixed decision table for classification** (history type → author → reason → group supersession). It keeps criterion 4 mechanical and repeatable, and it makes `no trace` a real measured datum instead of a judgement call.
- **No code change, no commit in this plan** — and none in the exam either; the plan's only artifacts are the report and any temporary extraction script, which must not stay in the worktree (it goes to the output folder and is discarded).
- **Forum cross-check kept, not dropped.** The history entry and the forum decision are written from the same transition, but matching them by hand confirms the records the next readers will consult, and it is what criterion 6 asks for.

## Not covered by this plan and said aloud

- Whether the three run files actually survive with their history: not verifiable from this tree, verified as the exam's first step (risk 1 above).
- Any fix to the flow mechanics pointed at by the conclusion (for example redo groups leaving stale skip candidates): deliberately out of scope; it must arrive as its own request.
