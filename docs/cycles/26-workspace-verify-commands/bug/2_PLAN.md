# #26 Conflict verification commands belong to the workspace — plan

Scope: all of [`0_BUG_REPORT.md`](0_BUG_REPORT.md). Evidence is the code of release 0.3.0, in [`1_INVESTIGATION.md`](1_INVESTIGATION.md).

## The fix in one paragraph

The commands move into the workspace configuration as `projects.verifyCommands` (schema 5). The screen lists the workspace's repositories, its release mirrors and the projects that already have a command here. The conflict flow reads the active workspace's map. At startup, once, a main-process step copies each command of the old global file into the workspace(s) that own its project and renames the file to a backup; what no workspace owns is kept and shown in the section.

## What gets built

| # | Piece | Where it lands |
|---|---|---|
| 1 | The field, its schema, default, validation and migration v4 to v5 | `src/shared/config/{types,schema,defaults,validate,migrations}.ts` |
| 2 | One shared definition of "a project of this workspace" and of a valid key | new `src/shared/verifyCommands.ts` |
| 3 | The commands read and written through the workspace config; the listing | `src/main/conflictVerify.ts`, new `src/main/verifyProjects.ts` (mirror listing, Electron-free) |
| 4 | The one-time move of the global file | new `src/main/verify-move.ts`, called from `src/main/workspaceConfig.ts` |
| 5 | Export and import | `collectCommands` in `src/shared/config/transfer.ts` |
| 6 | Screen, texts, Help | `src/renderer/src/screens/ConflictVerifySection.tsx`, `conflictApi.ts`, `ui-settings.*.json`, `ui-gate.*.json` |
| 7 | Docs and changelog | `docs/verify-commands.md`, `docs/configuration.md` (both languages), `CHANGELOG.md` |

## Config

```ts
interface ProjectsConfig {
  // ...as before
  /** Shell command that checks a conflict resolution, by project ("group/name", the key the conflict flow uses). Absent or blank: none. */
  verifyCommands: Record<string, string>;   // default {}
}
```

- **Schema**: an object whose values are strings of at most 2000 characters with no NUL (the limits `validateVerify` already enforced). The JSON Schema subset has no key patterns, so a key is checked in `semantic()`: it must match `^[\w.-]+(\/[\w.-]+)+$` and not contain `..` (the old `PROJECT` rule). A bad key is an **error** (the screen could never show it and `findClone` would never match it).
- **Default** `{}` in `neutralConfig()`; `withConfigDefaults` already merges key by key.
- **Migration v4 to v5** (`v4ToV5`, pure): writes `projects.verifyCommands = {}` when absent (a value already there is kept: idempotent), sets `schemaVersion: 5`, touches nothing else, and a document with no `projects` just gets the version. It never reads the disk. The bump is needed because `projects` is strict and an older app would reset the whole block (investigation, "Why the schema must be bumped").
- A bad stored value is repaired by the existing `repair()`: the path of a bad key or value is not in the neutral base, so it walks up to `projects.verifyCommands` and resets that map only, not `projects`.

### The identity: `src/shared/verifyCommands.ts`

```ts
VERIFY_PROJECT: RegExp; VERIFY_COMMAND_MAX = 2000;
isVerifyProject(key): boolean
repoProjectPath(repo): string | null        // projectPath, else parseRemote(remoteUrl)?.projectPath, kept only if it passes isVerifyProject
ownVerifyProjects(config, mirrors: string[]): string[]  // repos' keys + mirrors, de-duplicated, sorted
```

The screen, the move and the tests use the same function, so "listed" and "claimed" cannot disagree.

## The listing

`verifyConfig()` returns `{ commands, projects, unclaimed }`:

- `commands`: `projects.verifyCommands` of the active workspace (blank values dropped);
- `projects`: `ownVerifyProjects(config, mirrored) + keys of commands`, sorted. The keys of the workspace's own commands stay visible even when the repo was removed or renamed, so a command is never hidden and never lost by a save (the setter replaces the whole map);
- `unclaimed`: see below.

Mirrors are listed as today, only while the release tool is on (`rc().releaseSync`), from `<mirrorsDir>/<ns>/<repo>.git`. The listing helper lives in `verifyProjects.ts` and takes the folder, so the move can use it without the app's runtime.

## The conflict flow

`verifyCommandFor(project)` reads `getConfig().projects.verifyCommands[project]`, trimmed, blank is none. `actions.ts` is untouched: it already calls `verifyCommandFor(projectOf(u))`. `conflicts:verify-get` stays open to a paired browser (it only reads), `conflicts:verify-set` stays in `DESKTOP_ONLY`; it now runs `updateConfig`, so it validates like `config:save` and notifies `onConfigChange`. A test workspace is handled exactly as before: no gate, because the command runs on this machine and nothing leaves it.

## The startup move: `moveVerifyCommands`

`src/main/verify-move.ts`, Electron-free, with its dependencies injected (`root`, `home`, `log`, a mirror lister, `now`). Called once from `workspaceConfig.ts:load()` right after `bootstrapConfigs` (so every config is already at schema 5) and before the active config is read.

1. No `<root>/conflict-verify.json`: nothing to do (this is what makes a second run a no-op).
2. Read it. An error **reading** it (I/O) is `deferred`: the file stays and the next start retries. Not JSON or not an object: rename it to the backup, log, stop (the bytes are kept, nothing read it anyway). Entries are the string values that are not blank; a value the schema refuses (over 2000 characters, or with a NUL) is never copied, it goes to the unclaimed ones, because a stored value the schema refuses would make the config invalid and `repair()` would reset the whole map on load.
3. For every workspace of the registry (an unreadable registry stops the move with the file untouched):
   - read its `config.json` and validate it. **Missing file**: nothing to claim, not a blocker (a workspace folder with no config yet). **Invalid or unreadable**: the workspace is `deferred`; it is not touched.
   - claimed here = entries whose key is in `ownVerifyProjects(config, mirrors)`.
   - copy those into `projects.verifyCommands` (the merged config is validated first; if it would be invalid the workspace is `deferred` and not written) **without replacing a key the workspace already has** (what a person set in the workspace wins), and write the config only when something was added (atomic write, the same one `bootstrapConfigs` uses).
4. An entry claimed by two workspaces is copied into both (each workspace owns its copy from then on).
5. **No workspace deferred**: rename the file to `conflict-verify.json.migrated` (if that name exists, `.migrated-<timestamp>`; nothing is overwritten), write the entries no workspace claimed to `conflict-verify.unclaimed.json` (merged into an existing sidecar, never removed by the move; an entry already there is kept as it is and a differing later one is logged), and log one line per workspace and one for the unclaimed projects (names, never commands). **Some workspace deferred**: leave the file where it is and log why; the next start tries again. Running again is safe because step 3 never replaces a key; the one cost is that a command a person deleted from a healthy workspace could come back while another workspace stays invalid, and that is recorded here as accepted.
6. A failure writing one config is logged and counts as `deferred` for that workspace; it never throws out of the move (the app must start).

The move never deletes a command: the original bytes are in the `.migrated` file, copies are in the configs, orphans are in the sidecar.

### Unclaimed commands (decision D7)

A command whose project no workspace lists (a repo that is gone, a path typed by hand, a project of a workspace that was deleted) cannot be copied anywhere honestly. It stays in three places: the `.migrated` backup (everything, as it was), the sidecar `conflict-verify.unclaimed.json` (`{ "group/project": "command" }`) and the log (`migration.log` of the workspaces folder and the console: project names only). The section shows them in a note, "Commands of the earlier shared file that no workspace listed", with a "Use here" button per project that puts the command in the field (saved with the usual "Save commands"). A project disappears from the note as soon as the active workspace has a command for it. An entry that no workspace ever adopts stays in the note: a way to dismiss it is a follow-up (F3). The sidecar is a global file (not part of any workspace), and the note names no project of a workspace, only projects nobody owns, so it leaks nothing across workspaces.

Not chosen: showing them in Saúde (that screen reports the health of jobs and dependencies, a one-time data note does not fit it), or dropping them after a delay (a command is a person's work).

## Export and import

`collectCommands` adds `projects.verifyCommands[<project>]` for every non-blank value, so the import preview lists them with the other programs the file would run. No new warning: that list is the warning. Export needs nothing (the command is in the config; it is not a secret). Tests: a round trip, the preview list, and `findSecretValues` not refusing a command whose text contains the word `token`.

## Texts

- Existing keys: `ui.help.data.shared.text` (both languages) no longer lists the verification commands. That is an intended difference for `test/gitlab-catalogs-unchanged.test.ts`, whose `INTENDED` list only allowed pt-BR: it gets an optional `languages` field (default pt-BR) and the entry for this key in both languages, with the replacement and the reason.
- `ui.verify.hint` stays. New keys (both catalogs, same placeholders, no host word): `ui.verify.scope` (what the list shows: this workspace's repositories and release mirrors, the commands belong to it), `ui.verify.empty`, `ui.verify.unclaimed.title`, `ui.verify.unclaimed.hint`, `ui.verify.unclaimed.use`.
- `ui.verify.webNote` stays.

## Tests (no network, no model, temp dirs only)

| File | What it proves |
|---|---|
| `test/verify-commands.test.ts` (new) | `isVerifyProject`; `repoProjectPath` for each URL shape, for an explicit `projectPath` and for a repo with no remote; `ownVerifyProjects` merges and de-duplicates |
| `test/config-schema.test.ts`, `config-migrations.test.ts`, `config-transfer.test.ts`, others that pin the version | the field, the default, v4 to v5 (adds `{}`, keeps a map already there, idempotent, v1 to v3 end at 5), a bad key or value is refused and repaired without touching `repos`; every version assertion says 5 (the "newer app" ones 6) |
| `test/verify-move.test.ts` (new) | with `CERIMONIAS_DATA_DIR`-style temp roots: copies to the right workspace and only there; copies to two workspaces; mirror projects claimed; an existing key wins; an unclaimed command lands in the sidecar and the log; the backup holds the original bytes; a second run changes nothing; an invalid workspace config is untouched, defers the rename and a later run finishes; a corrupt global file is renamed and nothing breaks; a pre-existing `.migrated` is not overwritten; no registry |
| `test/conflict-verify.test.ts` (new) | `verifyCommandFor` reads the active workspace; two workspaces' configs differ; the listing is repos + mirrors + own keys and no other workspace's project; the setter validates, replaces the whole map, is on the desktop-only list; `unclaimed` drops what the workspace has |
| `test/conflict-resolve.test.ts`, `conflict-policy.test.ts`, `verifyDefaults.test.ts` | keep working through the new storage (`saveVerifyCommands` writes the workspace config) |
| `test/config-transfer.test.ts` | the verification commands appear in the import preview's `commands`, and survive export then import |
| `test/workspaces-core.test.ts` | the layout test keeps `conflict-verify.json` as a root file the flat-layout migration does not move |
| existing golden and host tests | unchanged: `test/golden` untouched, `host-terms-leak`, `gitlab-catalogs-unchanged` (with the one intended entry), `i18n` parity |

## Risks

| Risk | Handling |
|---|---|
| A command lands in a workspace that should not have it (same project path in two workspaces) | it is copied to each owner by design: they had it before. Each can change its own now |
| The move claims a mirror project because the mirrors folder is a path shared by two workspaces | same: both own it |
| An old app opens a v5 file | refuses it (schema bump), the same protection as v4 |
| Crash between the config writes and the rename | the next start repeats the move; no key is replaced, so it converges |
| The user restores the old global file by hand | it is migrated again at next start; the `.migrated` name is never overwritten |
| A workspace config that the screen's save would invalidate | the setter validates through `saveConfig`; a message names the key |
| The setter replaces the whole map from the screen's snapshot | a command added meanwhile by an import or from another window is dropped by that save; the screen reloads the list after saving, and the window of the race is the time the screen stays open. Accepted: the same shape every settings section has |
| Mirrors are listed with synchronous reads | `readdirSync` of the mirrors folder, at startup (the move, once per workspace with the tool on) and on every `conflicts:verify-get`; a slow or huge folder would block the main process for that time. Accepted: it is what the screen did before, and the folder holds one entry per mirrored repo |

## Decision log

| # | Decision | Why |
|---|---|---|
| D1 | `projects.verifyCommands`, a map by project path, not a field on `RepoConfig` | mirrors have no repo entry; the key is the conflict flow's own identity; a repo whose remote changes does not orphan a field |
| D2 | Schema 4 to 5 with a step that writes `{}` | `projects` is strict: an older app would reset the whole block; the version refusal is the project's established protection |
| D3 | A malformed key is a validation error; the value limits live in the schema | the key rule needs a pattern the schema subset has no keyword for; the same rules as before, now at every entry point (save, import, migration) |
| D4 | The screen lists repos, mirrors and the workspace's own keys | the issue asks for repos and mirrors; a stored command whose repo is gone must stay visible or a save of the whole map would be a hidden delete |
| D5 | Claimed means a repo or a mirror of the workspace (the screen's own list) | a mirror-only project has a command today and is listed on the screen; claiming only repos would orphan it |
| D6 | Copy to every owner; an existing workspace value is never replaced | no owner loses what it had; idempotent; a person's edit wins |
| D7 | Unclaimed commands stay in the backup, a sidecar, the log and a note in the section, with "Use here" | never drop a command; shown where the person works, and the note leaks no other workspace's project |
| D8 | Rename the file only when every workspace could be read; otherwise retry at the next start | a workspace with a broken config would otherwise lose its claim for good |
| D9 | The import preview lists verification commands as programs the config runs; no extra warning | one existing, documented warning path; the command is not a secret |
| D10 | `conflicts:verify-set` stays desktop-only and goes through `updateConfig` | a browser must not choose what Apply executes; validation and change notification come for free |
| D11 | No test-workspace gate | the command runs locally and the issue says a test workspace behaves as before |
| D12 | `VERIFY_SUGGESTION` stays as is | it is the "Suggestion (Node)" button; the issue keeps it |
| D13 | `INTENDED` in the catalog test learns a `languages` field | the Help text changes in both languages; the test allowed pt-BR only, for the gender fix |
| D14 | The move copies only what the schema accepts and validates the merged config before writing | a refused value stored in a config makes `repair()` reset the whole map on load, losing unrelated commands; such a value goes to the unclaimed ones instead |
| D15 | A read error on the old file defers; only a parse error or a non-object is renamed aside | an I/O error is transient and must not move a good file out of the way |
| D16 | The sidecar is merged, never removed by the move, and an entry already there wins | a command put aside earlier is never replaced by a later file; the later one stays in its backup and the log says so |
| D17 | The port to the 0.5.0 line renumbered the migration to v10 to v11 (`v10ToV11`, `CONFIG_SCHEMA_VERSION` 11) | the plan was written and reviewed on 0.3.0, where the schema was 4 and the step was v4 to v5; the other releases took v5 to v10 in between. Everything else in this plan holds as written, with "schema 5" read as 11 |

## Follow-ups (not part of this change)

| # | Follow-up | Why it is left out |
|---|---|---|
| F1 | Detect the project type (Node, PHP, Go) to offer other suggestions | the issue asks for the existing suggestion only |
| F2 | Let the wizard's projects step edit the commands | the Settings section is where they are edited today |
| F3 | A way to dismiss an unclaimed entry from the note | today it leaves the note only when a workspace gets a command for the project |
