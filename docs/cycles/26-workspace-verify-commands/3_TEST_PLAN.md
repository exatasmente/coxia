# #26 Conflict verification commands belong to the workspace — test plan

How a person checks, in the app, each item of [`bug/0_BUG_REPORT.md`](bug/0_BUG_REPORT.md). The "Automated" lines say what the suite already proves with temporary folders and fakes; the suite never started the app, so the screen itself (the list, the note, the buttons) is only checked by these steps.

## Setup

Use a throwaway data folder and two throwaway git folders; nothing here needs a model or a code host account.

```bash
export CERIMONIAS_DATA_DIR=$(mktemp -d)
export CERIMONIAS_SPECS_DIR=$(mktemp -d)
for p in web api; do
  git init -q /tmp/verify-check/$p
  git -C /tmp/verify-check/$p remote add origin git@example.com:acme/$p.git
done
npm run dev
```

1. Finish the setup wizard (skip what can be skipped). In the projects step add `/tmp/verify-check/web` as a repository. Leave the other one out for now.
2. Close the app. Put the old shared file in the data folder, as an installation from before this change would have it:

   ```bash
   cat > "$CERIMONIAS_DATA_DIR/conflict-verify.json" <<'JSON'
   { "acme/web": "echo checking web", "acme/api": "echo checking api", "acme/gone": "echo checking gone" }
   JSON
   ```

## Acceptance items

### Existing commands move to the workspace that owns the project

1. Start the app (same environment variables) and open Settings › Conflict verification.
2. The list has **one** project, `acme/web`, with `echo checking web` in its field. `acme/api` is not listed (this workspace does not have it) and neither is `acme/gone`.
3. Under the list a note "Commands from the earlier shared list" shows `acme/api` and `acme/gone`, each with a "Use here" button.
4. In the data folder: `conflict-verify.json` is gone, `conflict-verify.json.migrated` holds the three original lines, `conflict-verify.unclaimed.json` holds `acme/api` and `acme/gone`, and `workspaces/principal/config.json` has `"verifyCommands": { "acme/web": "echo checking web" }` and `"schemaVersion": 5`. `workspaces/migration.log` names `acme/api` and `acme/gone` and does not contain their commands.
5. Press "Use here" on `acme/api`: it appears in the list with its command and leaves the note. Save commands. Reopen the screen: `acme/api` is in the list and not in the note.

Automated: `test/verify-move.test.ts` (right workspace only, two owners, mirrors, existing value wins, orphans kept, backup bytes, twice), `test/verify-move-startup.test.ts` (the first config read at startup does the move), `test/conflict-verify.test.ts` ("unclaimed" minus what the workspace has).

### The second run changes nothing

1. Quit and start the app again. The screen is the same, no `.migrated-<timestamp>` file appeared, `config.json` of the workspace is byte for byte what it was.

Automated: `test/verify-move.test.ts` ("is safe to run twice").

### Another workspace sees only its own

1. Settings › Workspaces: create "Other" with **empty** settings (not a copy) and switch to it (the app restarts).
2. Conflict verification lists nothing and says the workspace lists no repository with a remote yet. Nothing from `acme/web` is shown.
3. Type `acme/web` in the "group/project" field, Add, give it `echo other workspace`, Save.
4. Switch back to "Principal": `acme/web` still has `echo checking web`. Switch to "Other" again: `echo other workspace`.

Automated: `test/conflict-verify.test.ts` ("is not changed by the old shared file or by another workspace", "does not list a project another workspace has a command for").

### The conflict flow runs the active workspace's command

Uses a conflicting pull request as in the test plan of [`20-resolve-conflict-button`](../20-resolve-conflict-button/3_TEST_PLAN.md) (a GitHub repository you own, a pull request that conflicts with `main`), with the repository's `project` in the config being that repository's `owner/name`.

1. In the workspace of that repository set the command of the project to `echo verified in "$WORKTREE_DIR"; exit 0`, Save.
2. Resolve the conflict up to "Apply". The verification passes and its output contains `verified in` and the worktree path.
3. Replace the command with `exit 3`, Save, reopen the resolution: Apply reports the verification finished with code 3 and asks you to judge it (the commit waits).
4. Clear the command: Apply asks for "go without tests" (no command for the project).
5. Switch to a workspace that has the same project with a different command: it runs that one.

Automated: `test/conflict-resolve.test.ts` (the whole flow through `saveVerifyCommands`, now stored in the workspace config), `test/conflict-verify.test.ts` (lookup).

### Export and import

1. In the workspace with commands, Settings › Settings and workspaces › Export. Open the file: `config.projects.verifyCommands` has the commands.
2. Import it into a **new** workspace. The preview lists, among the programs the file would run, `echo checking web` (and the others) next to `projects.verifyCommands[acme/web]`.
3. Apply the import and switch to the new workspace: the screen lists the commands for the repositories of that workspace (the repos come from the file, so the list shows the ones it names).

Automated: `test/verify-commands.test.ts` (preview list, round trip, a v4 export migrates, a bad key is refused).

### Writing is desktop-only

1. Pair a phone or open the web access from a browser, and open Settings › Conflict verification there. The list and the commands are readable, the fields are disabled, and there is no save.
2. From the browser's developer tools call the `conflicts:verify-set` channel: the app answers that only the app window may do it.

Automated: `test/conflict-policy.test.ts`, `test/web-server.test.ts` (the desktop-only set), `test/conflict-verify.test.ts`.

### A workspace with an invalid config does not lose its claim

1. Quit. Edit `workspaces/other/config.json` and set `"language": "fr"` (invalid). Put back a shared file with a command for a project of that workspace (`echo late`), and start the app.
2. The app starts. `conflict-verify.json` is **still there**, the other workspace's config is byte for byte as you left it, and `workspaces/migration.log` says that workspace could not be read and the next start will try again.
3. Quit, set `"language"` back to a valid value, start again: the file is renamed (the backup keeps the earlier `.migrated`, the new one has a timestamp in its name) and the command is in that workspace.

Automated: `test/verify-move.test.ts` ("leaves a workspace with an invalid config untouched, keeps the file, and finishes at the next start", "treats a config.json that is not JSON as invalid", "does not overwrite a backup that exists").

### The suggestion button and the Help

1. On the screen, "Suggestion (Node)" next to a project fills the Node command; Save keeps it. Unchanged from before.
2. Help › data: the line about what applies to all workspaces lists browser access, paired devices and the glossary, and says the verification commands belong to each workspace.

Automated: `test/verifyDefaults.test.ts`, `test/gitlab-catalogs-unchanged.test.ts` (the one intended difference), `test/i18n.test.ts`.

## Not verified here

- The suite and these steps were run against fakes and throwaway folders: the move was never run on a real installation's data, and a conflict was never resolved against a real code host for this change.
- The screen (the list, the empty message, the "Use here" note, the light and dark themes of the note) was not opened in a running app by the author: the renderer was typechecked and built, and the logic it shows is tested in the main process.
- A command of a workspace is copied, not shared: if two workspaces owned the same project they each keep their own copy afterwards.
