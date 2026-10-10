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

## Commit 2: the notes of a conversation's agents as files

`src/shared/memory.ts` (contract: kinds, caps, ids, `NoteState`/`FolderState`, `NoteSummary`, `visibleToAgents`), `src/main/memory/note.ts` (format, parse, the checks the header
and text can be seen to fail), `state.ts` (the per-folder state file), `store.ts` (folders, atomic writes, ownership from the state, the person's edit, review and removal),
`checkProse` in `src/main/procedures/record.ts`. Nothing calls them yet except the tests.

Deviations and additions:

- **The store is synchronous and takes no lock.** The plan says the state is "serialised per folder in the process"; every store call is a synchronous read-compare-write, which
  cannot be interleaved inside one process, so the serialisation is by construction (as in the procedures store). The test with twelve calls of one agent "at once" holds it.
- **The person's side is already in the store** (`edit`, `review`, `removeNote`, `removeFolder`, `removeConversation`, `list`, `read(.., 'person')`, `locate`), so commit 4 only adds
  the channels. `read` masks the text with `redact`; the exact-value mask of a call is applied by the caller (commit 6).
- **`checkProse` is an option of the existing `text()`** (`TextRule.prose`), not a second function: line breaks and tabs are allowed, a URL with a query and the 20-character mixed
  string are not judged by their own rule, and a lone carriage return is refused (a CRLF is read as a line break). The procedures' tests pass unchanged.
- **The review of a foreign note makes it the person's** (`person: true`, `reviewed: true`, the hash of the file as it is), and the review of a note edited on disk does too; the
  review of a note that only waited keeps it the agent's. The plan says "marks as reviewed, text unchanged" without saying whose the note is afterwards.
- **A replace without a hand-off releases the review wait** of a note that waited: the new text was not written after a hand-off. A replace in a call with one makes it wait again.
- **A file past 40,000 bytes is not read**: it is a note by name, `unsafe` and `foreign`-or-not by its state, with an empty title; the person can remove it or rewrite it by
  naming every field. The plan says "size at most 8,000 characters" and does not say what a multi-megabyte file does to a listing.
- **`test/memory-secret-path.test.ts` covers here** the store with ids that hold the filter's words, `secretPath`, and the SDK's `noSecrets` hook; the tools and channels half of the
  plan's list is added with commits 4 and 6.
- **Risk 3 of the plan is real, and is not relaxed.** The prose validator refuses a full 40-character commit hash (the `redact` net masks an opaque 32+ character string with a digit
  and a letter, so it counts as a credential), and a URL with a query string. A short hash (`a1b2c3d`), a path and a plain URL pass. `test/memory-note.test.ts` pins this. The
  plan's fallback (exempt a plain hex token of 7 to 40 characters in the prose pass) is a maintainer decision; it was not taken.

## Commit 3: the app's memory folder out of reach of the file tools

`CheckOptions.keep` in `src/main/engine/guard.ts`; `ConfineOptions.keep` in `src/main/runner/hooks.ts` (default `<workspace>/memory`, from `ATAS`); `ToolContext.writeKeep`,
`OpenRunParams.writeKeep`, `BridgeArgs.writeKeep` for the open engine, set from `agents.ts` (`runOpenEngine`) for every call that has a `confine`. Nothing else calls the folder.

Deviations and additions:

- **A new denial code, `kept`, not `reserved`.** The plan reuses `reserved` and says its wording fits, but the catalog text behind `reserved` is "Only AGENTS.md may be written in a
  documentation run" (`main.engine.text.write.denied.reserved`, `prompt.sdd.runner.denied.reserved`), which would tell a stage agent that tried the memory folder something false.
  `kept` is added to `DENIAL_CODES` with three keys in both catalogs (`main.engine.text.write.denied.kept`, `prompt.sdd.runner.denied.kept`, `main.runner.denied.kept`); the
  check, the layers and the order of the checks are the plan's. Decision log 22 ("a new denial code and catalog keys" rejected) is reversed for this reason only.
- **The check runs on `place` and on `abs`, and the kept folder is resolved too** (its closest existing ancestor, so a data folder reached through a link counts), compared in lower
  case as `reserved` is. It runs after `reserved` and before the secret rule, so a note under an id that holds the filter's words is told "kept", not "secret".
- **Only the current workspace's `memory/` is kept.** `ATAS` is the workspace the app started in (switching workspace relaunches it); another workspace's `memory/` under the same
  data folder is not named, as it was not before. The plan speaks of "the workspace's `memory/`".
- **`confinedHooks` callers are untouched**: the default `keep` lives in `hooks.ts`, so the stage (`executor.ts`) and the called agent (`conversation.ts`) get it without a change. A
  mention in a run's thread and the question chain use `readConfinedHooks`, which writes nothing and is not changed.
- The test of the sub-agent runs a scripted `edit` sub-agent that tries `Write` into the folder (`test/memory-guard.test.ts`); the sub-agent runs on the principal's parameters, so it inherits the guard.
