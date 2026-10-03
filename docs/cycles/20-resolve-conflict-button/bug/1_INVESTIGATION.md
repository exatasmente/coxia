# #20 "Resolve conflict" never shows for cards from a code-host integration — investigation

## Root cause

The renderer decides "this MR conflicts" by matching the **text** of a blocker, and that text only exists in the wording of one card source.

- `src/renderer/src/dashboard.ts:131` `const MR_CONFLICT = /^(.+): MR com conflitos$/;` — a Portuguese sentence, anchored at both ends.
- `conflictMrs(card)` (`dashboard.ts:133-137`) keeps the `mrPaths` whose ref appears in a blocker matching that pattern.
- The Today needs list (`dashboard.ts:214`) attaches `conflictCard` only when `MR_CONFLICT.test(c.blockers[0])` and `conflictMrs(c).length`.

The integration never writes that sentence:

- `src/main/vcs/cards.ts:88` `if (m.hasConflicts) out.push(t('vcs.card.conflicts'))` — "Conflito com a branch de destino" / "Conflicts with the target branch" (`src/shared/i18n/pt-BR.json:11`, `en.json:11`).
- `src/main/cards.ts:61` prefixes it with the MR ref: `web!303: Conflito com a branch de destino`. It does not match the pattern, so `conflictMrs` is empty and every consumer hides the button. In English the sentence is different again, so the pattern could never have matched there either.

The sentence "MR com conflitos" is the wording of the external card-source command the app was first built around; the integration, added later, kept the structured flag on the MR item but not the consumer.

## Where the structured flag is lost

| Step | File:line | What happens to the conflict |
|---|---|---|
| Provider reads the MR | `src/main/vcs/gitlab.ts:174`, `github.ts:172`, `bitbucket.ts:150` | `VcsMr.hasConflicts: boolean \| null` (`vcs/types.ts:85`); Bitbucket always `null` (no field) |
| Card report built | `src/main/vcs/cards.ts:197` | `CardItem.has_conflicts: boolean` on the `mr` item; also the localized blocker (`:88`) |
| Report read | `src/main/report.ts:8-23` | `ReportItem` has **no** `has_conflicts`; `providerReport()` is cast `as Report` (`report.ts:57`), so the field is carried at runtime but not typed or read |
| Card built | `src/main/cards.ts:58-62` | `mrPaths` copies only `ref`, `project`, `iid`; blockers are the text `"<ref>: <b>"` — **lost here** |
| Renderer | `src/renderer/src/dashboard.ts:131-137` | has only the text |

## Consumers of the conflict decision

All go through `conflictMrs` (one definition, `dashboard.ts:134`) except the needs-list guard:

1. `dashboard.ts:214` — Today needs list: sets `NeedItem.conflictCard` (guard `MR_CONFLICT.test(blockers[0])` + `conflictMrs`).
2. `src/renderer/src/screens/TodayParts.tsx:110-112` — renders `ResolveConflict` for `conflictCard`, and picks the MR by `n.title.startsWith(`${m.ref}:`)` (a title built from the blocker text again).
3. `src/renderer/src/screens/Deep.tsx:233` — the conflict panel of the unblock screen (`conflictMrs(card).length > 0`).
4. `src/renderer/src/screens/ResolveConflict.tsx:24` — the buttons themselves (`conflictMrs(card).filter(...)`); returns nothing when empty.

Nothing else reads the text: `watchers.ts`, `radar.ts`, `retro.ts` and `sameDay.ts` use blockers as opaque strings or the `conflicts` change field. `test/cycle-watchers.test.ts:54` uses "MR com conflitos" only as an arbitrary blocker string.

`mrPaths` is also serialized into agent and job prompts (`qa.ts:61`, `feedback.ts:302`, `efeitos.ts:126`) and into the selected `cardFields` of the agent; adding a field to its entries would change those payloads.

## The command-based card source

`src/main/report.ts:55-61`: with a `cardSource` command the report is the command's JSON, parsed as `Report`; with none it is `providerReport()`. The `ReportItem` shape is documented only by that interface — no `has_conflicts` is promised to the command, and its conflict signal is the blocker text "MR com conflitos" (the existing tests, `test/dashboard.test.ts:183-195`, `test/same-day.test.ts`, `test/helpers/promptCapture.ts:108`, use it). A command may or may not also emit `has_conflicts`. So the text must keep working as a fallback, and the structured flag must be accepted when present.

## Findings that shape the fix

- The needs row shows only `blockers[0]`. With the integration, the conflict is often not first (`mrBlockers` puts "pipeline failed" before it, `vcs/cards.ts:86-88`), so the row guard on `blockers[0]` would hide the button even with the right data. The guard must be "the card has a conflicting MR", not "the first blocker says so".
- `has_conflicts` can be `false`/absent on a conflicting MR for hosts with no flag (Bitbucket) and `null` while GitHub is still computing mergeability (`github.ts:172`); there the button stays hidden. That is a host limit, not part of this bug, and `conflictFromMr` re-checks with a local merge anyway (`test/conflict-from-mr.test.ts:147`).

## Not verified

Run only against fakes; no real host. The integration's conflict flag was not read from a live GitHub or GitLab response.
