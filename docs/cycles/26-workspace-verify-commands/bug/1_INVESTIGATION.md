# #26 Conflict verification commands belong to the workspace — investigation

## Root cause

The commands are stored in one file of the **data root**, which every workspace shares, and the screen is built from that file, not from the workspace.

- `src/main/conflictVerify.ts:9` `const FILE = join(DATA_ROOT, 'conflict-verify.json');`: `DATA_ROOT` is the folder above `workspaces/<id>/`, so the file belongs to no workspace.
- `src/main/workspaces-core.ts:28` lists `conflict-verify.json` in `GLOBAL_ENTRIES` (with the browser access, the paired devices and the glossary): that is the "what applies to all workspaces" the Help says, and `test/workspaces-core.test.ts:61,73` pins it.
- `verifyConfig()` (`conflictVerify.ts:64-67`) returns `projects = keys of the global file + mirrored()`. `mirrored()` (`:52-62`) reads the active workspace's `rc().releaseSync.mirrorsDir`, so mirrors are already per workspace; the keys are not. The workspace's own repositories (`projects.repos`) are never consulted, which is why a repository without a command is not on the screen.
- `verifyCommandFor(project)` (`:29-31`), what the conflict flow calls, reads the same global map.

So the wrong set is shown (every workspace's keys, none of the workspace's repos), and two workspaces cannot differ.

## Every reader and writer of `conflict-verify.json`

| Where | What | Kind |
|---|---|---|
| `src/main/conflictVerify.ts:19-27` `verifyCommands()` | reads the file; drops non-strings and blanks; any failure is `{}` | reader |
| `conflictVerify.ts:44-50` `saveVerifyCommands()` | validates (`validateVerify` `:33-42`) and writes `<file>.tmp` then renames | writer |
| `conflictVerify.ts:64-67, 70-76` | `conflicts:verify-get` and `conflicts:verify-set` IPC handlers; the setter returns the fresh `verifyConfig()` | the two doors |
| `src/main/actions.ts:29, 661-663` | `verifyCommandFor(projectOf(u))` in `writeAndVerify`; no command and no "go without tests" is the `main.actions.noVerify` error | reader (conflict flow) |
| `src/renderer/src/screens/ConflictResolver.tsx:166` | `conflictApi.verifyConfig()` then `c.commands[project]`, to show whether the project has a command | reader (UI) |
| `src/renderer/src/screens/ConflictVerifySection.tsx:21-28, 33-44` | reads `projects` and `commands`, writes the whole map back | reader and writer (UI) |
| `src/main/workspaces-core.ts:28` | the file is a global entry: never moved into a workspace by the flat-layout migration | classification |
| `src/main/webPolicy.ts:11` | `conflicts:verify-set` is `DESKTOP_ONLY`; `conflicts:verify-get` is open to a paired browser | policy |
| `test/conflict-policy.test.ts`, `verifyDefaults.test.ts`, `conflict-resolve.test.ts`, `web-server.test.ts:333`, `workspaces-core.test.ts` | validation, the suggestion, the flow with `saveVerifyCommands(...)`, the desktop-only set, the layout | tests |

Nothing else touches the file (no export, no import, no backup): a workspace export has never carried the commands.

## The project key

The conflict flow names a project by one string, `group/project` (any depth of groups), and every consumer uses it unchanged:

- `src/main/actions.ts:488-492` `projectOf(u)`: `u.project_path` when the unit has one, else the repo path relative to the mirrors folder (`repo.slice(mirrors.length + 1)` minus `.git`). A conflict started from an MR (`conflictFromMr`, `actions.ts:~505-535`) sets `project_path` to the project of the MR reference (`resolveMr`, `src/main/conflictFromMr.ts:22-27`): the host's path, not a folder.
- `conflictPrepare` (`actions.ts:556`) finds the local clone by it: `findClone(project, cloneRoots, host)` (`src/main/conflictGit.ts:63`) compares it with the `origin` URL through `remoteMatches` (`:41-60`): the URL path minus `.git` must equal it.
- The mirrors listing (`mirrored()`) produces `<namespace>/<repo>` from `<mirrorsDir>/<ns>/<repo>.git`, the same shape.

A configured repository has the same identity in `projects.repos[]`: `RepoConfig.projectPath` ("group/name" on the host, `src/shared/config/types.ts:102`), else the path of `remoteUrl`. `parseRemote` (`src/shared/wizard.ts:257`) already derives it from the three URL shapes git uses (scp-like, `ssh://`, `https://`), strips `.git` and requires at least one `/`; the wizard's scan fills `projectPath` with it (`src/main/wizard-core.ts:118-120`). So **the key of a repo is `projectPath ?? parseRemote(remoteUrl)?.projectPath`**, the string `remoteMatches` compares. A repo without a remote has none (a local-only folder cannot be a conflict's project) and is not listed.

## How the config treats a command (for the export and import)

- `collectCommands` (`src/shared/config/transfer.ts:~134-147`) lists every program a config would run; `previewImport` shows that list (`config-transfer.ts`, `ImportPreview.commands`: "a config file can make the app execute things"). The external tools, the terminal and the CLI of each integration are in it. A verification command is a shell command run by `bash -lc` on this machine, so it belongs in that list: no new warning is needed, the existing one covers it, and it is the one place an importer reads before accepting.
- A command is not a secret (`findSecretValues` looks for `apiKey`, `token`... keys, not for command text), so export carries it as is, like `externalTools.*.command`.
- `config:save` and the import are `CONFIG_ADMIN` (desktop only) in `webPolicy.ts`; the verify setter stays on its own desktop-only channel.

## Why the schema must be bumped

`projects` is a strict object (`additionalProperties: false`, `schema.ts:234`). An older app that reads a file with an unknown `projects.verifyCommands` fails validation, and `repair()` (`src/shared/config/migrations.ts`) walks the path up to the first one the neutral base has: `projects`, i.e. it resets the **whole** `projects` block (roots, repos, issue project) and the app may save that. The version refusal ("written by a newer app") is the established protection (v2 to v3 and v3 to v4 did the same), so the field comes with schema 5.

## Why the migration cannot be in the config step

`migrateConfig` is pure and "never reads the disk" (the header of `migrations.ts`); the global file is outside the document and the workspace folder. The v4 to v5 step can only add the empty field. Moving the existing commands needs the root, the registry, every workspace's repos and, for the mirrors, a directory listing: a startup step in the main process, next to `bootstrapConfigs` (`src/main/config-bootstrap.ts`, called once from `workspaceConfig.ts:load()` before any config is read).

## What else was checked

- `ui.help.data.shared.text` (`ui-gate.*.json:193`) is the only Help text that says the commands are shared; `ui.workspaces.hint` does not mention them.
- `test/gitlab-catalogs-unchanged.test.ts` renders every key of `main` for a GitLab workspace on SDD and compares it with the snapshot: changing an existing text needs an entry in its `INTENDED` list (today pt-BR only, for the gender fix), so that list must learn about a change in both languages.
- A test workspace (`isTestWorkspace`) only refuses writes that leave the machine (`externalRefusal`); a verification command runs locally and has no such gate today, and gets none here ("behaves as before").
- `VERIFY_SUGGESTION` (`src/renderer/src/conflictVerifyDefaults.ts`) is pure UI data and stays.
