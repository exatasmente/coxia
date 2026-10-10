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
