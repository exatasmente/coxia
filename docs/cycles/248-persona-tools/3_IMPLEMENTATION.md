# Implementation notes: the persona's tools, origin, audit and stop

What was built against `2_PLAN.md`, commit by commit, and every place it differs from the plan. The plan stays as approved; this file is where the differences are recorded.

## Commit 1: a persona origin on the call wrapper and one helper that names the door

Built as planned: `Through` in `src/shared/auditoria.ts`; `callOrigin()` with three values and `viaOf()` in `src/main/rpc.ts`; `invokePersona`; `src/main/persona/act.ts` (the leaf module of the act scope); the six comparisons turned into `viaOf()` (`turnAsks.ts`, `runner/module.ts` twice, `memory/module.ts`, `persona/assist.ts` twice); `AnsweredThrough`, `TurnAnswerer`, `MemoryAuditInput.via`, `ChannelDeps.via` and `rpcContext` widened; `test/persona-origin.test.ts`; `test/runs-policy.test.ts` and `test/errorlog-rpc.test.ts` updated.

Deviations and decisions:

- **`Act` has no `basis` yet.** The plan's interface lists `basis: ActBasis`; the type for it (`AuditBasis`) is introduced by commit 2 with the audit, so the field is added there. Everything else of the interface is as written.
- **`invokePersona` refuses a call made outside an open act.** The plan only says it runs the handler under the persona origin. Because `callOrigin()` answers `persona` only while an act is open (rule 13), a call with no open act would have read as the window, the person's own door, which is the failure this whole issue exists to prevent; it throws instead. Tests drive it through a local helper that does what the door will do (open the act, call, close it when the promise settles).
- **`openAct()` is added next to `currentAct()` in `act.ts`** (the act, only while it is open), which is what `callOrigin()` and the audit stamp consult; `currentAct()` returns a closed act too, for a caller that needs to know the scope existed.
- **No file but `rpc.ts` may name `callOrigin`**, comments included (the scan is by word), so the comment of `act.ts` says "the call origin".
- **The `by` of the memory audit line** (`o.by ?? 'person'`, `memory/audit.ts`) is left for commit 2, with the rest of the audit, as the plan has it.
- **`persona/assist.ts` keeps `through()`** as a one-line alias of `viaOf()` typed `Through`; its scope check is `viaOf() === 'paired'`, so a persona is never held to a device's scope (unreachable today, since `invokePersona` refuses `persona:` channels, and pinned by a source scan).

## Commit 2: the audit says who, and records the person's own configuration, secret and plugin changes

Built as planned: `Through`-style fields on `AuditEntry` (`actor`, `door`, `id`, `said`, `basis`, `proposedBy`), `AuditBasis` and `BASIS_LIMITS`, the four kinds (`config`, `secret`, `plugin-decision`, `act`) in `AuditKind`; the stamp and the bound and mask of `basis` in `recordWrite` (`src/main/auditoria.ts`); `Act.basis`; `src/main/configAudit.ts`; the config, secret and plugin lines in `configModule.ts` and `plugins/module.ts`; the memory audit's `by`; the Audit screen's Who filter, badge, door, reason, folded basis, "approved its own proposal" and scroll to an act (`Auditoria.tsx`, `auditModel.ts`, `Screen` member `auditoria` with `id`), both catalogs, the CHANGELOG line; `test/persona-audit.test.ts`, `test/audit-model.test.ts`.

Deviations and decisions:

- **`decisionAudit.ts` holds the secret and plugin-decision entries.** The plan puts the lines in the channel lambdas; the pure builders (`secretAuditEntry`, `pluginDecisionEntry`) are in their own file beside `configAudit.ts`, and the lambdas call them through `recordedSecret` (configModule) and `decided` (plugins). A field value that is not a reference or a plain word is dropped, so a path, a command or a value has no field to arrive in.
- **The `config` line walks lists of identified objects by id.** `changedPaths` (the phone's scope check) treats an array as one path, so every change of the team would read `agents.team`. `configAudit.ts` has its own walk that goes into an array whose elements all carry a distinct string `id` and names the element as `agents.team[me].shell` (the grammar of the settings tool of commit 6); any other array is one path. The scope check and `changedPaths` are untouched; `same` is exported from `configScope.ts`.
- **The line's fields are the paths themselves.** `fields` is `{ changed: "<count>", raised?: "<names>", "<path>": "<old> → <new>" ... }` for the first twenty paths, which the existing Audit screen draws as `key = value` lines with nothing new to learn. A value is shown only for a boolean, a number or a lowercase word of at most 24 characters whose path does not end in a name that holds text (`instructions`, `job`, `name`, `userName`, `text`, `body`, `description`, `title`, `prompt`, `command(s)`, `args`, `note`, `message`); anything else is `len=<n>`.
- **`raised` is the plan's Q2 default**: the four checks plus the workspace autonomy block going on (`runner.autonomy.<field>`) and a new entry in an agent's `allowedCommands`. It is written for the person's own saves too, since it is a function of the diff. The phone's refusal is unchanged (`configScope.ts` still refuses by the original four).
- **A save that changes nothing writes no line**, as one the validation refused writes none.
- **A handler cannot claim the stamp's fields.** While an act is open `recordWrite` drops `actor`, `door`, `id`, `said` and `basis` from the entry before it applies the act's own; outside an act they pass through as written (nobody writes them there).
- **The act's mask applies to the whole line**, not only to `said` and `basis`: `target`, every field and `result` pass through the exact-value mask, then the app's redaction (`redact`), then the log's `scrub`, while an act is open. The person's lines are untouched.
- **The `act` kind and `proposedBy` have no writer yet.** The door that writes `act` is commit 4; `audited()` filling `proposedBy` is commit 5. The type, the screen's label and the "approved its own proposal" sentence are here.
- **Plugin lines are written after the decision** (and as `ok: false` with the reason `refused` when the service threw), with the plugin, need and action read before it, since an answered request is gone afterwards.
- **`config:import-apply` writes its line only when it applied to the running workspace**, comparing the configuration before with the one it reloaded.
- **Not seen:** the Audit screen's layout (the select next to the issue box, the folded basis, the highlighted entry); it compiles and its decisions are tested as plain functions.
