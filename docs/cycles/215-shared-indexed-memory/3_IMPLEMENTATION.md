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

## Commit 4: the person and the paired phone view, edit and remove the memory

`src/main/memory/` gains `channels.ts`, `module.ts`, `audit.ts` and `instance.ts` (the one store of the running workspace and its change listeners); `src/shared/memoryView.ts`
(the shapes the view reads); `webPolicy.ts` (`MEMORY_CHANNELS`, `MEMORY_UNLISTED`); `AuditKind` `'memory'`; `src/renderer/src/screens/memory/` (the screen, the note panel, the model, the api
and the stylesheet); `ui-memory.*.json`; the nav in `App.tsx`, `Today.tsx`, `BottomNav.tsx`, `dashboard.ts`; `deleteAgentThread` and its three callers in `agentAssist.ts`; the comment and the
audit of `runs:activitySave` and `runs:memory` in `runner/module.ts`; the first `CHANGELOG.md` line.

Deviations and additions:

- **The channels take the note `id`, not a file name.** The plan says `file` against `NOTE_FILE`; the id is the same string without `.md`, the screen has it, and the check is
  `NOTE_ID`. Nothing else about the argument checks changed: the conversation against the thread id, the agent against the agent id, before any path is built.
- **The store announces its changes** (`MemoryStoreDeps.onChange`, also when a folder is first made), and `instance.ts` turns that into the `memory-changed` event, so a note written by an
  agent in commit 6 reaches an open screen without a new piece. Not in the plan's file list; the plan's `MEMORY_EVENT` is in `src/shared/memoryView.ts`.
- **`memory:remove-folder` takes an optional agent**: with it, that agent's folder; without it, the whole conversation's (the plan said both and gave one channel).
- **The audit of `runs:memory` and `runs:activitySave`** records `memory:cycle-memory-edit` and `memory:activity-correct` with the door and the run id or the activity reference, only when the
  correction took effect, and never the text. The plan only named the activity correction; the cycle memory edit is the other open channel of divergence 4 and is audited the same way.
- **The screen is the same on the computer and on the phone**, with no `isWeb()` branch: the plan's decision (the phone has the desktop's capabilities). The desktop nav button sits in the
  header beside Procedures, and the phone's More sheet has a row.
- **`CHANGELOG.md` gets its first lines here** (an Added entry for the screen and the switch, a Changed entry for the folder guard of commit 3), as the rules ask for the line in the commit that
  makes the change visible; commit 10 completes it.
- Tests: `memory-channels`, `memory-policy`, `memory-ui`, `memory-retention` (new), `runs-policy`, `forum-store`, `agent-assist-draft` and `memory-store` (extended). The audit kind's two
  catalog keys are covered by `memory-ui`; there is no test that renders the screen (the project has no React renderer test, and the view's logic is in `memoryModel.ts`).

## Commit 5: the index of notes, activities, documents, version and roadmap

`src/main/memory/index.ts` (entries, the ranking key, search, the lines and caps, `open` for one entry as a bounded excerpt), `documents.ts` (the headings of the cycle documents,
sections and excerpts), `facts.ts` (version, roadmap); in `src/main/runner/activities.ts` the single run snapshot (`read` and `claimFront` take the runs the caller listed),
`ActivityQuery.onlyNamed`, `thumbnailsOf`; tests `memory-index`, `memory-facts` and the three new cases of `activityIndex`. Nothing calls the index yet.

Deviations and additions:

- **`MemoryIndex` is a small object, not loose functions**: `build` (ranked entries), `list` (the lines within the prompt's or the tool's caps) and `open` (the excerpt of one entry). The
  plan puts `open` in the tool handlers (commit 6); the part that knows how to slice a note, a front, a document, the roadmap and the version detail lives here, so the handler only
  words it (standing sentence, fence, mask of the call).
- **The facts are asynchronous**, because the tags come from git, and so is `build`. `cacheOnly` and `warm()` are here already (the plan builds the ceremonies' cache-only read in commit 8): a
  cold repository reads `Version: not read yet` and a refresh starts behind the call, one at a time per repository. A stale cache is still an answer.
- **The roadmap file may not be a symbolic link** (the plan says "`lstat`" and leaves the link open): it reads as "could not be read". The person points at the real file. `secretPath`
  is given to `createFacts` as `secret(path)`, not imported, so the module has no dependency on `agents.ts` and the commit-6 port passes the real one.
- **An activity entry's title is its compact line without the leading reference** (`act:app#101 Add the thing · Spec · developer`): the pointer already carries the reference.
- **`0_ISSUE.md` is not indexed.** It is the tracker's text the agents already receive, not a document a stage produced. `MEMORY.md` is (Q7), by its sections.
- **`Built.held`** counts the notes held back from every agent (waiting for review, foreign, unsafe), for the log line of commit 7.
- **`onlyNamed` does both divergences at once**: the section holds nothing when nothing was named (divergences 1 and 2) and renders only the named agents' thumbnails (divergence 7). Without
  the flag nothing changes, byte for byte (`test/activityIndex.test.ts`); the call sites pass it in commit 7.
- **Measured** (risk 2 of the plan), on a temporary workspace of 500 notes in 10 conversations and 200 runs with 5 documents each (the 30 newest are read): the first list of a process takes
  about 160 ms, the following ones 33 to 37 ms, with the cycle documents cached by path, modification time and size. The run files are listed once per call (a test counts it).

## Commit 6: the memory tools in both engines

`src/main/memory/tools.ts` (names, descriptions, schemas, `MemoryTools`), `session.ts` (the four handlers and the list a call carries), `engineTool.ts` (`memoryToolImpls`,
`memoryMcpServer`, `memorySubagentGuard`), `port.ts` (`createMemoryPort`, `MemoryOpenContext`); `AgentCall.memoryTools` and the plumbing in `agents.ts` (`runAgent`, `wrapUpAnswer`,
`runOpenEngine`, `runClaudeSdk`), `EngineRequest.memoryTools`, `ToolImpl.principalOnly` and the sub-agent filter in `open/loop.ts`; `MemorySurface` in `shared/memory.ts`; the audit entry
learns an agent's save, replace and remove; the catalog key `main.forum.code.runner.sharedMemory.toolsMissing`. Tests: `memory-tools`, `memory-port`, `memory-engine`, the tools half of
`memory-secret-path`, the hash case of `memory-note`, and the `test/helpers/memory.ts` world they share. No call site yet.

Deviations and additions:

- **`MemoryPort.open` is asynchronous** (`Promise<MemorySession | null>`): the list is built by the index, whose version fact reads git. The call sites of commit 7 are all in async code
  already. A voice path uses `cacheOnly`, which never waits (commit 8).
- **The refusal of a full commit hash says what to write** (maintainer's decision after commit 4): in a note, the credential refusal that comes from the `redact` net and finds a hex run of
  32 or more characters adds "a full commit hash counts as one, so write its short form (7 to 12 characters)" (`record.ts`, prose only; the procedures' refusals are unchanged), and the
  description of `memory_save` tells the agent to name a commit by its short hash. A query string keeps the plain reason. Masking is as it was.
- **The audit entry of an agent's write** reuses `memoryAuditEntry` with `by` = the agent, `via` = the surface the call ran in and the run's `issue`; ops `save` and `replace` were added
  beside the person's. A refusal records the code and the field names, never a value or a title. A refusal by `activity` (not a known reference) or `typed` is audited the same way.
- **`memory_list` answers inside the fence with the standing sentence**, like `memory_read` (the plan only fenced the read): the lines are titles an agent or a person wrote, which is outside
  text too. The closing line of a list that did not fit names `memory_list` and `memory_read`.
- **`MemoryIndex.knows(ref)`** is new: `memory_save` checks the `activity` the agent names against the activities record before the store sees it. A note with no `activity` of its own takes
  the call's (`ref`), as the plan says.
- **A session whose conversation is not a valid thread id, or whose folder cannot be made, is a reader**: no folder, no write tools, no refusal for the person to see. The plan's `open` only said
  it makes the folder.
- **The sub-agent hook is added only when the memory server was built and the session writes**; its matcher is the two prefixed names. Its callback is `memorySubagentGuard` in `engineTool.ts`
  so a test calls it directly. Whether the SDK fires it for an in-process call from its built-in sub-agent stays unverified, as the plan says.
- **The `withPool` retry** is covered by running two calls over the same tools with a server that cannot be built (one thread line), not by forcing a busy refusal through the pool; both go through
  the same `unavailable()` that the retry would call.
- **Not done here, by the plan's order:** the singleton `memoryPort()` over the running workspace (commit 7, with the first call site) and `setCeremonyMemory` with the `runOnce` seam (commit 8).

## Commit 7: the memory read in stages, mentions and called agents

`src/main/memory/runtime.ts` (the running workspace's `memoryFacts()`, `memoryIndex()` and `memoryPort()`, kept apart from `instance.ts` so the screens' channels do not load the agents'
side); the prompt keys in both catalogs (`runner.rules.sharedMemory`, `runner.rules.sharedMemoryWrite`, `runner.section.sharedIndex`, `runner.section.sharedOne`,
`runner.section.sharedMovedMemory`); `StageInput.index`/`indexWrite` and `MentionInput.index`/`indexWrite` with the rules and sections in `systemText`, `stagePrompt` and `mentionCall`;
the three call sites (`executor.ts` for the stage, `mentions/answer.ts` for a mention and an agent called by another, `conversation.ts` for the agent a stage called) and the wiring
through `service.ts`, `runner/module.ts` and `mentions/module.ts`; divergences 1, 2, 5 and 7; a `CHANGELOG.md` line. Tests: `memory-surfaces`, `memory-prompts`, three cases of
`activityIndex` (commit 5) and the existing goldens as the proof.

Deviations and additions:

- **A fifth prompt key, `runner.section.sharedOne`.** The old activities section says "It is the record of every activity, not only the one you are in"; with the memory on the section
  holds one activity and the others are in the index, so that sentence would be false. A call with a session gets the new wording, a call without keeps the old one. The plan listed four
  keys for the commit.
- **`narrow` decides the activities cut, not the switch.** The plan reads "the memory on" for divergences 1, 2 and 7; the executor and the mentions pass `narrow` = "this call got a memory session"
  (`ExecutorDeps.sharedMemory(run, narrow)`, `MentionDeps.memory(place, message, narrow)`), so a call whose memory could not be opened (or whose switch is off) keeps the section it always had,
  whole, with its old wording, instead of losing the other activities with nothing to replace them. `sharedTextOf` takes the flag.
- **The sentence of divergence 5 follows the switch** (`memoryOn(config)`), as the working agent's session is not known where the message is posted (`service.ts`): with the memory on, the
  inbox gets `sharedMovedMemory`; off, the old sentence, byte for byte.
- **A named agent's ranking**: the stage ranks by its run (conversation `run-<id>`, activity, repository); a mention ranks with the agents the message named and, outside a run, the activity
  references it wrote (`MentionDeps.named`, set by the runner and by the mentions module). The runner passes no references for a run's thread (its own activity is the call's `ref`).
- **The ceremony place is untouched**: `answerMentions` opens a memory session only outside a ceremony, as it does for procedures; commit 8 gives the ceremony its read-only one.
- **`pscreen` is hoisted** in the stage and in `answerMentions` (one `procedureScreen` adapter used by both the procedures and the memory session), a refactor with no change of behaviour.
- **The conversation a called agent writes in** is the thread it was called in: the run's own for `place: 'run'`, the `run-<id>-talk-<agent>-<time>` thread for a new one. An id past 64 characters
  (a long agent id) makes the session a reader, as for any invalid conversation id (commit 6).
- **Goldens**: none regenerated. `test/prompts-screen.test.ts`, `test/cycle-prompts.test.ts` and `test/golden/*` ran unchanged with this commit.

## Commit 8: the question chain, squad requests and ceremonies read the memory

`src/main/memory/ceremony.ts` (the door a ceremony asks, `setCeremonyMemory`, `openCeremonyMemory`, `ceremonyAddition`), the seam in `runOnce` (`agents.ts`), `mentions/ceremony.ts`,
`ChainInput`/`RequestInput` with `index` and `shared` (`chain.ts`, `request.ts`) and their two call sites in `service.ts`, the registration and the warm-up in `memory/module.ts`, the key
`runner.section.sharedIndexList`, a longer `CHANGELOG.md` line. Tests: `memory-ceremony`, the chain and request cases of `memory-surfaces`; the goldens ran unchanged.

Deviations and additions:

- **The door lives in `memory/ceremony.ts` and `agents.ts` re-exports `setCeremonyMemory`**, so the dependency from `agents.ts` goes one way (into the memory) as for the tools. The plan put the
  function in `agents.ts`.
- **The ceremonies' system text gets the rules; their prompt gets the list at its end.** For a role with tools (`turn`, `reply`, `deep`, `fix`) the system text carries
  `runner.rules.sharedMemory` and the prompt `runner.section.sharedIndex`; for `teams` only `runner.section.sharedIndexList`, which says the entry cannot be opened and that the agent should say
  where a line came from and say it does not know when it does not say. The plan listed the key for `teams` and implied the rest.
- **The wrap-up resume and the pool**: the session is opened once before `withPool` and skipped when `extra.resume` is set; the tests run a busy refusal that moves to the second model
  (one open, the same list on both calls) and an `error_max_turns` that resumes (the resume has no section, no server).
- **The chain reads its run's documents whole, so the list leaves them out; the request does not exclude them** (the receiving liaison reads another repository and never the asker's cycle
  folder), and both get the run's own activity whole in the `sharedOne` section, which closes divergence 3.
- **A chain or request that cannot open the memory** is the call it was: no section, no rule, no tool, and no failure.
- **The facts are warmed when the memory module starts, when the switch is on at that moment.** A workspace that turns the switch on later reads "not read yet" on its first ceremony turn, and
  the background refresh that turn started answers the next ones. The module registers the door whatever the switch says; the port answers null while it is off.
- **`askBare` is untouched** (decision log 11); it never reaches `runOnce`.
- Not done, and not in the plan for this commit: `docs/memory.md`, `docs/runner.md`, the README index and the final `CHANGELOG.md` pass (commit 10), and the notice (commit 9).

## Fix after commit 8: warm the version when the switch is turned on

`src/main/memory/module.ts` also warms the facts when the configuration changes from off to on (`onConfigChange`, remembering the last state), not only when the module starts with the
switch on; commit 8 left that as a known gap ("a workspace that turns the switch on later reads `not read yet` on its first ceremony turn"). Turning it off, or saving with the switch
unchanged, warms nothing. Test: the `warms the version …` case of `test/memory-ceremony.test.ts`, on freshly imported modules so the listeners of the other tests do not count. No user-visible
change, so no `CHANGELOG.md` line.

## Fix after commit 8: point a working agent to the memory only when its session opened

Divergence 5 (commit 7) chose the sentence of a message to the working agent by `memoryOn(config)`. A switch that is on does not mean the stage's session opened (the port answers null when
the folder or the index cannot be made), and then the sentence would name tools the agent does not have. `StageInbox` gains `memory` (set by `openInbox` from the stage's session, `sharedIdx !== null`
in `executor.ts`), and `service.ts` picks `sharedMovedMemory` only when `inbox.memory` is true; the `memoryOn` import left `service.ts`. The only place that sentence is posted is the working
stage's inbox, so a mention has nothing to follow: it is answered by its own call with its own session. Test: the case of `test/memory-surfaces.test.ts` now has three worlds (on and opened, off, on and
not opened); the second and third keep the old sentence byte for byte. No user-visible line for the `CHANGELOG.md`.
