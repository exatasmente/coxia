# Implementation: the live activity as a tree

Commits follow the order of `2_PLAN.md`. Each section below is written in the commit it describes.

## Commit 1: the reasoning switch in the configuration

Schema 28, `v27ToV28`, `runner.showReasoning` (types, defaults, schema in one commit), `runner.showReasoning` in `WEB_EDITABLE`, the toggle in the runner section, the two texts
of `ui.runner.*`, `docs/configuration.md` in both languages, and the tests that pin the number or the neutral runner. Nothing reads the switch yet except the settings screen.

Deviations from the plan:

- `reasoningOn` (planned in commit 2 beside the new activity constants) is added to `src/shared/activity.ts` here, alone, because the runner draft (`runnerEdit.ts`) needs it
  to read an absent field as on. The rest of the shared activity changes stay in commit 2.
- The v26 helper of `test/config-migrations.test.ts` also deletes `showReasoning`, and the test that compares a v26 file with its migrated result overrides `showReasoning` on both
  sides like it does `sharedMemory`; the `:486`, `:527` and `:651` cases needed no edit (their `before` comes from `neutralConfig()`, which carries `true`, and the chain writes `true`).

## Commit 2: nodes, a ring per node and the new kinds in the activity log

`ActivityEntry` gains `parent` and `node` (every line of a node) and the kinds `thought` and `answer`; the main log keeps a ring per node, evicts by tree, answers a run id with
its subtree and a job id with no overall cut, keeps the newest status line when a ring turns over, and makes `thought`, `answer`, `child` and `lend`. `withActivityParent`,
`currentActivity`, `beginActivity`'s `node` and the joining `withActivityContext` carry the parent. The thoughts gate is wired in `src/main/index.ts`. The renderer store caps per
run, drops finished trees past 240 runs and keeps new children in `backfillLive`. Nothing emits a thought, an answer or a child yet.

Deviations from the plan:

- `stepText` lives in `src/renderer/src/activity.ts` (the existing DOM-free module), not in `activityTree.ts`, which is created in commit 6: the flat list needs it now, so that a
  thought can never print as a label. Commit 6 re-exports it from the tree module. The flat timeline (`ActivityTimeline`), the dock's `Steps`, `AgentActivity`'s `act-now` and the
  thread's `CallLine` all word the newest line through it.
- `getConfig` was not imported in `src/main/index.ts` (the plan said it was); it is added to the `./workspaceConfig` import next to `onConfigChange`.
- `beginCallActivity` takes the optional `node` here already (the signature is the log's, not the wiring of path A, which stays in commit 4).
- The pinned status line is not counted in the ring in the renderer's cap or in the main log's: a ring holds `ring` lines plus the newest status line when that one is older than
  all of them (`ring + 1` at most), as the plan says; the renderer mirrors this per run.
- Added `test/activity-policy.test.ts` here (the plan lists it with the phone's tests, no commit given), and the stub `RunActivity` of `test/mentions-call-line.test.ts` gained the
  new members.
- `activity.kind.thought`, `activity.kind.answer` and `activity.thought` are the only catalog keys added; the others of the plan's list (`activity.node.*`, `activity.callRefused.*`,
  the entry titles) come with the commits that use them, so no key sits unused.
