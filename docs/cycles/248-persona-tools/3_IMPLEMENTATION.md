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
