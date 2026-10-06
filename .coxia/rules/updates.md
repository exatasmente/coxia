---
checked-commit: 1a0858c59ed1d4c43e03feb3e709bbefd8441336
checked-date: 2026-10-06
evidence: [docs/updates.md:1-80, src/shared/updates.ts, src/main/updates-core.ts, src/main/update-core.ts, test/updates-policy.test.ts, test/updates-core.test.ts]
summary: How an installed app updates itself, the channels, the feed and who may run an update
stages: [development]
roles: [developer]
---

# Updates

An installed app updates itself in one of two ways, depending on **how it was installed**. The
app detects the mode itself (Settings › Updates shows the mode and the reason) and the person
can force one of the two.

| Mode | When | How it updates |
|---|---|---|
| Published version (`release`) | An AppImage downloaded from a release (or Windows/macOS installed from a release) | `electron-updater`: checks, downloads in the background and restarts into the new version |
| Source (`source`) | Installed by `scripts/install-local.sh` from a source tree that still exists | The app only says `main` has new commits; the button runs `scripts/update.sh` (rebuilds) |
| `.deb` package | Installed with `dpkg`/`apt` | **Does not update itself**: the package manager does |
| Development | `npx electron .`, `npm run dev` | Nothing; run `scripts/update.sh` in a terminal |

## The release mode

- **States:** `idle` → `checking` → `available` → `downloading` → `downloaded` → `installing`,
  or `error`. The state machine is pure (`src/shared/updates.ts`, `reduceRelease`) and tested:
  a later check never throws away a downloaded update, and neither does an error.
- **When it checks:** 30 s after the app opens and every N hours (default 6, 1 to 168), if
  "Check for updates automatically" is on. "Check now" always works.
- **Channels:** `stable` reads `latest-linux.yml` and ignores pre-releases; `beta` reads
  `beta-linux.yml` (and, on GitHub, pre-releases too). Switching channels **never** moves the
  app to an older version: the app turns `allowDowngrade` back off. The only way back is the
  explicit "Back to the stable version" button, shown on a beta with the stable channel.
- **Download:** the AppImage carries its block map, so only the changed blocks are downloaded.
- **Apply:** the "Version X ready to install" notice offers **Restart to update**. On confirm,
  the app asks the window to save the day's ceremony, swaps the AppImage, stops the processes
  it opened and quits; a separate helper waits for the process to go, closes the inherited
  files and opens the new AppImage.
- **Never mid-something:** with a call, speech or an agent run in progress, the notice goes,
  "Restart" asks for confirmation, and quitting does **not** install.
- **Errors** go to the app's error log (source `update:release`, visible in Health) and to the
  section, with no dialog.

## The source mode

The check runs `git rev-list --count` and `git log` on the registered tree (read-only; nothing
is changed). It shows the notice on the Today bar and, in Settings, how many commits and their
list. "Fetch from the remote on check" is optional and off by default.

## Configuration

`<data>/updates.json`, per machine: `auto` (default `true`), `channel` (`stable`), `intervalHours`
(6), `mode` (`auto`, `release` or `source`), `fetchSource` (`false`).

## Policy

The update channels (`update:status`, `update:check`, `update:settings-save`, `update:install`,
`update:busy`, and the earlier `update:info`, `update:run`, `update:seen`, `update:flushed`) are
in `DESKTOP_ONLY` in `src/main/webPolicy.ts`: a paired browser cannot reach them, even with
"external effects" on. `test/updates-policy.test.ts` fails if a new `update:*` channel is left
out of the list, and `test/web-server.test.ts` checks the exact list.

## Security

The feed is HTTPS only, the downloaded AppImage's sha512 is checked, there is no downgrade, and
the install happens only on the person's decision. On Linux the AppImage is not code-signed:
trust follows the repository's release process (`rules/releasing.md`).
