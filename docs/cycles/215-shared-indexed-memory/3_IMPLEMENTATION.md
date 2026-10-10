# Implementation: a shared, indexed memory of the whole app

What was built from `2_PLAN.md`, commit by commit, and where the code differs from the plan. Each commit extends this file.

## Commit 1: the switch and the roadmap pointer in the configuration

Built as planned: schema 27, step `v26ToV27` (writes `runner.sharedMemory = false` into an existing document, only bumps one whose `runner` is not an object, raises nothing),
`runner.sharedMemory?` and `docs.roadmapFile?` in `types.ts`, `schema.ts` and `defaults.ts` (`sharedMemory: true` in `neutralRunner()`, the pointer absent), `'runner.sharedMemory'`
in `WEB_EDITABLE` with the comment saying why, the toggle in both modes of `RunnerSection.tsx` (and `runnerOfWeb` does not restore it), the roadmap input in `DocsSection.tsx`
saved through `withRoadmapFile`, and `docs/configuration.md` (the two version lines, the two schema tables, the `v27` history entry and the `runner` and `docs` rows, in both languages).

Deviations and additions:

- `src/shared/memory.ts` is created here with `memoryOn` alone (the plan creates it in commit 2): the runner draft needs the reader of the switch now, as it needs `proceduresOn`.
  Commit 2 adds the types, caps and ids to the same file.
- `collectPaths` (`src/shared/config/transfer.ts`) names `docs.roadmapFile`, so an imported configuration whose roadmap file is missing on this machine is reported like `docs.specsDir`.
  Not in the plan; one line, and nothing reads the pointer yet.
- Tests the plan did not list but that moved with the number or the new key: `test/config-schema.test.ts` (the key list of `docs`, and the check that a schema key absent from the
  defaults is optional now exempts `docs.roadmapFile`), `test/config-migrations.test.ts` (the 8 to 9, 16 to 17, 18 to 19, 20 to 21 and 21 to 22 comparisons also carry
  `sharedMemory: false`; the tests of the 25 to 26 block that stand at "the current version" now use `CONFIG_SCHEMA_VERSION` instead of the literal 26), `test/docs-sources.test.ts`
  (`withRoadmapFile`).
- No `CHANGELOG.md` line here: the switch and the input are in Settings but nothing reads them yet (the Memory view is commit 4, the tools commit 6); the line goes with commit 4,
  the first visible behaviour, and the plan's commit 10 completes it.
