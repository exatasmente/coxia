# Implementation: turn limits as a setting, and a question instead of a stop

Commits follow the order of `2_PLAN.md`. Each section below is written in the commit it describes.

## Commit 1: the turns of each kind of sub-agent are a setting

Schema 29, `v28ToV29`, the five keys `runner.turns.explore|edit|shell|screen|plain` (types, defaults, schema in one commit), the draft and the section of Settings › Runner, the
catalogs (without the corrected hint of the stage's turns, which belongs to commit 4), `docs/configuration.md` in both languages, the loop reading `subTurns` when a sub-agent
starts, and the pinned tests. At a limit nothing asks yet: the sub-agent ends as before, with the configured number in the text.

Deviations from the plan:

- `subTurnsOf(read, kind)` (in `subagent.ts`, beside `DEFAULT_SUB_TURNS` and the `SubTurns` type) is the one place that turns the setting into the number a sub-agent gets, and
  it falls back to the default of the kind when the setting is not a whole number of at least 1. The plan had the loop index `subTurns()` directly.
- The step writes the five defaults as literals (12, 30, 20, 30, 12) and not from `neutralRunner()`, so a later change of the neutral defaults cannot change what the step
  wrote for a workspace that existed.
- `OpenRunParams.subTurns` is typed `Partial<Record<SubKind | 'plain', number>>`, so a harness or the app may hand it the whole `runner.turns` (which also carries `read`
  and `write`) without a copy.
- The plain sub-agent's failure text stays the raw `agent ended with error_max_turns` (the plan only gives the effective number to the sub-agent of a kind, as today).
- The CHANGELOG line of the setting is in this commit; the line about the question goes in the commit where it lands.

## Commit 2: the store of questions at a turn limit and its door

`shared/turnLimit.ts` (the record, the two decisions, the answerer, the event), `turnAsks-core.ts` (the store: no timer, one entry per question, abort ends as `finish` by `abort`,
one `answer` door), `turnAsks.ts` (the process store, the audit writer, the notification, the module with `turnAsks:list` and `turnAsks:answer`), `modules.ts`, the audit kind
`turn-limit` and its entry in the audit screen, and the two channels named in the web policy with their test. Nothing calls `ask` yet, so nothing is visible to the person: no
CHANGELOG line in this commit.

Deviations from the plan:

- `TurnAskInput` (the record without `id` and `since`) is exported from `shared/turnLimit.ts`, because the engine-side asker of commit 4 files it.
- `answer` returns `{ ok: false, reason: 'decision' }` for a decision that is not one, or `continue` where `canContinue` is false, and throws `TurnAskGone` only for a missing
  id; the channel checks the decision first (a bad decision to a gone id answers `decision`, as `runs:screenAnswer` does) and turns `TurnAskGone` into `gone`.
- A listener that throws (`changed`, `asked`, `audit`) is logged and ignored by the store, so it can neither decide an answer nor leave a question waiting.
- The notification bodies take `{used}`, `{round}` and `{task}` (the task clipped to 120 characters); the kind of a sub-agent is on the card of commit 5, not in the notice.
- The policy test reads `src/main/engine` to pin that the engine has no `turnAsks:` channel (the agent answerer is not built here).
