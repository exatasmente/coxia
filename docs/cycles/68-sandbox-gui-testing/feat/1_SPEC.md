# #68 Let agents test graphical interfaces from inside the sandbox — functional spec

Issue: https://github.com/exatasmente/coxia/issues/68

This document is written to be reviewed by a person **before any code**. Section 6 is the security section; section 9 lists what the maintainer has to decide (each with a recommended answer). Nothing here widens what an agent can do for an existing workspace: every new reach is something a person switches on, on the computer, and sees. Where this spec departs from the issue's wording it says so (section 4.3).

## 1. The rule

An agent with `shell: sandbox` can test an interface (a web page, this app's own window, the web UI a paired phone uses) **without leaving the sandbox**, and can **look at what it made** (a screenshot). It gets there only when the person has offered the pieces on the computer: a folder of browsers and, separately, a virtual display. What is offered is told to the agent, and what is missing is told to the person.

Four things stay as they are: the sandbox has no network by default, no home folder, no credentials, and the app never runs a browser or a display on the person's own screen.

## 2. Where things stand today

Audit of the tree at the 0.6.0 release (`e17cde3`); every `file:line` was read again for this spec. Paths are relative to the repository root.

| Piece | Today | Where |
|---|---|---|
| Environment inside | Built from nothing: `PATH`, a fresh empty `HOME` (`/home/sandbox`), `TMPDIR`, `LANG=C.UTF-8`, git and npm safety variables, the limits for the supervisor. No browser variable, no `DISPLAY`. `SandboxSpec` has no field for either | `src/main/sandbox/policy.ts:39-76` (`sandboxEnv`), `:12`, `:43`, `:17-34` (`SandboxSpec`) |
| What is bound | `/usr` and `/etc` read-only, the `/bin`, `/lib*` links, a private `/proc`, `/dev`, `/dev/shm` and `/tmp` as size-capped memory filesystems (512 MiB each), the stage folder, the worktree, then the read-only binds; the network is unshared | `policy.ts:85-102` (`bwrapArgs`; `:92` tmpfs, `:95` and `:98` read-only binds, `:99` `--setenv`); `src/main/sandbox/system.ts:14`; `src/main/sandbox/index.ts:204` (`tmpMb: 512`) |
| Extra read-only folders | `runner.sandbox.readOnlyPaths`: `~/` expanded, real path, refused when it is the home folder, a parent of it, the app's data, or looks like a secret place or a system place; bound at its own real path and put on `PATH` (`bin` and the folder). The name `.cache` is **not** on the refused list | `index.ts:97-114` (`readOnlyFolders`), `:193` (bind), `:201` (`pathDirs`); `src/shared/sandboxPaths.ts:5-6`, `:14-25`; `index.ts:120-153` (`assertBindsSafe`) |
| Start of a stage's sandbox | One `bwrap` per stage runs the supervisor script. It has one precedent for a helper started before it says `ready`: the registry forwarder, with a ready file and an error token. The session accepts only the tokens `ready`, `no-node`, `no-forwarder`; anything else becomes a start failure | `policy.ts:108-129` (`SUPERVISOR_SH`, forwarder at `:109-116`), `src/main/sandbox/session.ts:109` (spawn), `:183-203` (tokens at `:186`, errors at `:200-202`) |
| End of a stage's sandbox | `close()` asks the supervisor to quit, kills the process group, waits up to 3 s, removes the stage folder. Everything in the sandbox's process namespace dies with it (`--unshare-pid`, `--die-with-parent`); a background process dying with the stage is pinned by a real-bwrap test. The runner closes the session before it reads or commits anything of the worktree | `session.ts:144-180`, `policy.ts:87`, `test/sandbox-bwrap.test.ts:85-105`, `src/main/runner/executor.ts:327`, `:452` |
| Who opens a sandbox | Runner stages and ceremony `@mention` calls, both through `open()` | `executor.ts:275`, `src/main/mentions/answer.ts:217`; `OpenOptions` at `index.ts:33-51` |
| The tool the agent uses | `Shell`, one string, on both engines: a `ToolImpl` for the open engine and an in-process MCP server for the Claude Agent SDK | `src/main/sandbox/tool.ts`, `src/main/sandbox/engineTool.ts`, `src/main/agents.ts:469` (open), `:518` and `:532` (SDK) |
| What the stage prompt says | Two sandbox rules (`shell`, `shell.registry`; `shellReader` for a reader), picked from `StageInput.sandbox = { network, reader, host? }`; QA's output rules ask for `scenarios` with `evidence` | `src/main/runner/prompt.ts:40`, `:99-100`; `src/shared/i18n/main.en.json:850`, `:1223-1228`; filled at `executor.ts:409` |
| What QA is told it is | The QA agent of both shipped teams reads (`permission: read`) and is set to `shell: sandbox`; its name, job and instructions are catalog keys stored with the team (an existing team keeps what it stored) | `src/shared/cycles/templates/agentFlow.ts:21`, `:34`, `:60-70`; `src/shared/config/team.ts:154`; `src/shared/i18n/en.json:626-628`; `src/shared/cycles/apply.ts:58-70` |
| Where a screenshot would land | A reader (QA) works in a **throwaway copy** of the worktree mounted at the worktree's path; `/tmp` and `/dev/shm` are memory filesystems **inside** the sandbox that the host cannot open; `/coxia/out` is the stage's output folder on the host. None of these is a place the agent's file-reading tools reach: the open engine's `Read` is confined to the real worktree, `additionalDirectories` and the documentation and skill folders, and it refuses binary files; the Claude Agent SDK engine's own `Read` also starts from the real worktree and its roots were **not verified** | `index.ts:181-184`, `policy.ts:96`, `policy.ts:10-11`; `src/main/engine/open/loop.ts:264`; `src/main/engine/open/tools/read.ts:17-37` (`confine`), `:82`; `agents.ts:413` |
| Safe host-side read of a file the sandbox wrote | `readTailNoFollow`: no link followed, no pipe waited on, checked on the descriptor, capped | `session.ts:75-95`; pinned by `test/sandbox-hardening.test.ts` |
| Is a sandbox available | `probeSandbox` runs a real `bwrap` with the flags of a stage and a harmless check, cached for 5 minutes; `SandboxStatus` is `{ available, backend, version, reason, detail }`; `sandbox:status` is open to a paired browser, `sandbox:probe` is desktop only | `src/main/sandbox/probe.ts:45-77`, `src/shared/sandbox.ts:4-15`, `src/main/runner/module.ts:119-120`, `src/main/webPolicy.ts:12` |
| Where the status is shown | Settings (Runner › Sandbox block), the team editor, the recommended-permissions panel | `src/renderer/src/screens/team/RunnerSection.tsx:196` (`SandboxBlock`), `TeamSection.tsx:238`, `Recommended.tsx:16`, `sandboxStatus.ts`; strings `ui.runner.sandbox.*` and `ui.sandbox.reason.*` (`src/shared/i18n/ui-team.en.json`), `main.sandbox.reason.*` (`main.en.json:1186`) |
| Config of the sandbox | `RunnerSandbox` = `network`, `registryHosts`, `readOnlyPaths`, `limits` (default 2048 MiB of data memory per process, 256 processes, 256 MiB files, 5 min a command, 30 min a stage). Schema version 12. `runner.release` and `runner.linkDependencies` are the precedent for a field added **without** a migration step | `src/shared/config/types.ts:692-715`, `:718-726`, `:757-759`, `:5`; `schema.ts:437-455`; `defaults.ts:20-30`, `:79-105`; `validate.ts:154-172`; `migrations.ts:253-263` |
| Who may change it | `runner.sandbox` is **not** in `WEB_EDITABLE`, so a paired browser cannot touch it. An import lists `readOnlyPaths` among the paths it would give access to | `src/main/configScope.ts:11-26`, `test/config-web-scope.test.ts:199-203`, `src/shared/config/transfer.ts:177` |

## 3. What the experiment showed

The sandbox was rebuilt by hand with the same options `bwrapArgs` produces (no network, an empty home, read-only `/usr` and `/etc`, the default limits) on 2026-10-05. The app's own supervisor and the reader's copy were not part of it. The Playwright package came from a dependency folder mounted read-only, the way the runner shares a clone's `node_modules`; the browsers were an existing cache of Playwright 1.62's Chromium builds; the display server came from the distribution's `xvfb` package, unpacked into a read-only folder (nothing was installed on the system).

| Test | Result |
|---|---|
| Headless Chromium with nothing else set | Fails: Playwright looks in the sandbox's empty `~/.cache` |
| Browsers folder bound read-only and `PLAYWRIGHT_BROWSERS_PATH` set | Works: a page served on the sandbox's own loopback, clicks, a console error captured, a screenshot, in about 2 s; full Chromium about 1 s; a 390 px wide page renders with system fonts |
| 1 GiB of data memory per process | Works for Chromium and for Chromium's headless shell |
| 512 MiB of data memory | Fails, and it is Node itself that fails, before the browser |
| Electron 44 without a display | Fails: "Missing X server or $DISPLAY" |
| Electron 44 with `--ozone-platform=headless` | Crashes, outside the sandbox too: there is no usable headless mode |
| A virtual display (Xvfb, `-nolisten tcp`) started inside the sandbox, its socket in the sandbox's own `/tmp`, then a minimal Electron app | Works: a window, a click, a page capture |
| This app's own build, opened through Playwright's Electron launcher with `--no-sandbox` and an empty data folder | Works: the setup wizard renders in about 3.6 s; its text and buttons were read and a capture taken |
| The web UI a paired phone uses (web server on loopback in the same main process, a headless Chromium at 390 px in the same sandbox, pairing code from the app's own IPC) | Works: sign-in succeeds and the "finish setup on the computer" screen shows. The page came out in English because the browser inherits `LANG=C.UTF-8`; to look at another language the test must pass a locale |
| A screenshot read back by the model | Seen on the Claude Agent SDK engine; refused on the open engine (its `Read` refuses binary files) |

The default limits were enough. One variant (an HTTP server inside Electron's main process, window loading from it) hung once and was not investigated; the app's own build, which has such a server, did not.

## 4. What this delivers

Five items, each with what is visible. A to D are the sandbox and the agent; E is what the person is told.

### 4.1 A. Browsers inside the sandbox

- A new optional setting, **Browsers folder** (`runner.sandbox.browsersPath`), in the sandbox block of Settings, desktop only. It takes one folder, absolute or starting with `~/`, normally the folder Playwright keeps its browsers in.
- When it is set, **every** sandbox of the workspace (a run's stage, a mention call) gets that folder bound **read-only at its own real path** and `PLAYWRIGHT_BROWSERS_PATH` set to it. The agent sets nothing. It is not put on `PATH`: it holds browsers, not tools.
- The folder goes through **the same guards as `readOnlyPaths`**: it must exist, is resolved to its real path, and is refused when it is the home folder or holds it, the app's data (whole or in part), a link where a folder is expected, or a place that looks like keys or settings or belongs to the system. A refusal fails the stage with the message the read-only folders already give, naming the setting.
- The person is told what the folder should be: the browsers folder itself, not its parent (`~/.cache` would also share every other cache in it). The app does not enforce the name.
- Playwright **itself** is not provided. It comes from the repository's dependencies (the runner already shares the clone's `node_modules` read-only) or from a folder listed in the read-only folders. A repository without it makes the scenario `not-run`, with the reason.
- Nothing changes for a workspace that leaves the setting empty.

### 4.2 B. A virtual display for a stage

- A new optional setting, **Virtual display** (`runner.sandbox.display`), a switch, off by default, desktop only.
- When it is on, the **stage of a QA agent that has `shell: sandbox`** gets a display: the supervisor starts the display server (`Xvfb`, screen 1280x800 at 24 bits, no TCP listener) **inside the sandbox**, waits for its socket, and only then says `ready`; every command of the stage has `DISPLAY` set. The socket lives in the sandbox's own `/tmp`; the host's display and the host's X socket are never bound or reachable.
- The display ends with the stage: it is a process of the sandbox's own process namespace, which dies when the stage's sandbox does, before the runner reads or commits anything.
- It is **opt-in per stage**, not for the sandbox in general: `open()` takes an explicit request, so a ceremony `@mention` call and a stage that does not need a window do not start a display server and do not pay for it. What "a stage that needs it" means is open question 2; the recommendation is the stage that produces the QA output (stage `kind` `qa`) when the agent runs in a sandbox.
- The display server is found on the sandbox's own `PATH`: `/usr/bin` (the system) or the `bin` folder of a folder in `readOnlyPaths`. No new setting for it. The app does not install it.
- The display server obeys the **same data-memory, process and file-size limits** as a command. It is not subject to the command timeout (it runs for the stage); the stage's limits are what end it.

### 4.3 C. The agent can look at what it made

The audit found a blocker: a reader's screenshot is not reachable by the tools the agent reads files with (section 2, "Where a screenshot would land"), and a screenshot in `/tmp` is not on the host at all.

- A new tool, called `ViewImage` here (the plan settles the name), offered **only** to a stage that has a sandbox with browsers or a display on. It takes one string, `path`, and returns **the image** to the model.
- It reads **only from the stage's output folder** (`/coxia/out` inside the sandbox, the stage folder's `out` on the host). Any other path is refused with a sentence that says where to save the file. The agent is told to save screenshots there; for a reader or a writer alike.
- The host opens a file that a hostile process controls, so the tool reads it like the app reads the sandbox's other output: not following a link, not waiting on a pipe, checked on the descriptor, a regular file only, a size cap, and the **content** must be a PNG, JPEG, GIF or WebP (checked by the file's first bytes, not by its name). A file that fails any check is refused with a sentence that names the check.
- **Claude Agent SDK engine:** the tool is an in-process MCP tool next to `Shell` and returns an image content block. Whether the SDK passes an image from an in-process tool result to the model is to be confirmed in the plan (section 9, assumptions).
- **Open engine:** `ViewImage` is **not offered** until the open engine can carry an image to the model (issue #69). Until then the stage prompt tells the agent plainly that it **cannot look at images in this run** and what to do instead: check the page through the DOM, the accessibility tree, text, console errors and sizes; never describe how something "looks" it did not see; mark a scenario that is only decidable by sight `not-run` and say so in its detail. When #69 lands, offering the tool there is a small follow-up of that issue, not a rewrite of this one.
- The person is not shown the screenshots by this issue: they appear to the agent, and what it concludes appears in its scenarios (see section 8, out of scope).

*Deviation from the issue's wording.* The issue says screenshots are "saved in the worktree and read back". They are saved in the stage's output folder instead. A writer's worktree is committed by the app, so a screenshot saved there would be committed; a reader's worktree is a copy that is thrown away, and the host does not open it; `/tmp` is not on the host. One place works for both.

### 4.4 D. What the QA agent is told

- The stage prompt gets a rule block chosen **by what is on**, not by the agent's name, so it also reaches a custom QA agent and an existing team (whose stored instructions are not rewritten). It appears only when browsers or a display are on for the stage; **a stage with neither on gets byte-for-byte the prompt it gets today.**
- The block says, in short: start the dev server **in the background** and test against `127.0.0.1` (the sandbox's own loopback; it ends with the stage); drive the page with Playwright from the repository's dependencies; the browsers are in place and `PLAYWRIGHT_BROWSERS_PATH` is set; there is no network, so never open an external address; start Chromium and Electron with `--no-sandbox` (the sandbox you are in is the boundary; Chromium's own cannot nest) and with a fresh profile in `/tmp`; with `DISPLAY` set an Electron or other window app can be started, without it only the headless browser can; save screenshots in `/coxia/out`, **never in the working folder** (a writer's would be committed, a reader's is deleted); look at them with `ViewImage` when you have it, and say so when you do not; the browser follows the sandbox's `LANG` (English), so pass a locale to check another language; report each interface check as a **scenario** in the usual format, and mark `executed` only when a command you ran shows it.
- When the person switched on a display or a browsers folder and it is **not available** at the stage (section 4.5), the block says exactly that instead, and tells the agent to mark the scenarios that depend on it `not-run` with the reason.
- The QA agent of **new** teams gets one sentence more in its job and instructions (test the interface when the spec asks for it and the sandbox offers it). Existing teams keep what they stored; they get the rule block.
- Catalog keys in both languages; the text is in English or Portuguese by the workspace's language like the other runner rules.

### 4.5 E. The app says what is missing

- **Sandbox status** (`sandbox:status`, shown in Settings and in the team editor) gains two separate answers next to the existing one: **browsers** (not set / ready / missing: the folder does not exist, is refused by the guards, or has no browser build in it) and **display** (can be made / cannot, with the reason: no display program on the sandbox's path, or it did not start). Each is a line of its own with a reason the person can act on.
- **A missing display or missing browsers never make the sandbox unavailable.** `available` keeps meaning "a sandbox can run commands"; a workspace without Xvfb keeps every sandbox it has today.
- The display answer is a real check, like the sandbox's own: a sandbox built like a stage's starts the display server and waits for its socket, and ends. It is asked again with the existing "check again" button (desktop only), and cached with the rest of the status. The browsers answer is checked on the host against the saved setting, so it changes after the setting is saved and the check is asked again.
- A paired browser sees both answers (read-only, like the rest of the status) and, in the sandbox block, the two settings read-only like the other sandbox settings.
- **In the run's thread**, at the start of a stage that has a sandbox and should have browsers or a display and does not (the person set the folder or the switch, and the folder is gone or the display server is missing or did not start), one app message says which piece is missing and what the agent was told. The stage **goes on** (open question 8); it does not fail in the middle. A workspace that set neither gets no message.
- A warning in the sandbox block when browsers or the display are on and the data-memory limit is under 1024 MiB (Chromium and Electron need about that; at 512 MiB Node itself fails).

## 5. Configuration

Two optional fields, in the order they are read:

| Field | Meaning | Default |
|---|---|---|
| `runner.sandbox.browsersPath` | One folder, bound read-only, `PLAYWRIGHT_BROWSERS_PATH` points at it. Absolute or `~/`. | absent or `null`: none |
| `runner.sandbox.display` | A QA stage's sandbox starts a virtual display. | absent or `false`: off |

- Both are **desktop only**: `runner.sandbox` is not in `WEB_EDITABLE` (`src/main/configScope.ts:11-26`), so a paired browser cannot change them, and a test line next to `test/config-web-scope.test.ts:199-203` pins it.
- **No migration step**, following `runner.release` and `runner.linkDependencies`: the fields are optional, a stored file without them reads as "none" and "off", `withConfigDefaults` fills them for a file written before (`defaults.ts:105`), and the types, the JSON schema and `neutralSandbox()` carry them in the same change (the drift test `test/config-schema.test.ts` guards it). Whether to bump the schema instead is open question 5.
- An older app opening a file with these fields treats the extra keys as invalid. By reading `repair` (`migrations.ts:277-288`), the whole `runner.sandbox` block falls back to its neutral value with a note: **narrower, never wider**. This was read, not run.
- Validation: `browsersPath` runs through `readOnlyPathProblem` and the same messages as `readOnlyPaths` (`validate.ts:154-172`); the machine's facts (the home folder, the app's data) are checked again where the sandbox is built, as for the other folders.
- An imported configuration lists `browsersPath` among the paths it would give access to (next to `readOnlyPaths`, `transfer.ts:177`) and shows `display` as a setting it would switch on.
- Docs: the sandbox sections of `docs/runner.md` (both languages) and the `runner` rows of `docs/configuration.md` change; the sentence "no home folder" gets its exception (section 6).

## 6. Security: what the sandbox still guarantees and what changes

**Still true.** No network by default and only the registry proxy when the person allows it; an environment built from nothing; no credential, no agent socket, no code host route; `.git` read-only; the worktree the only place a writer can write; limits per command and per stage; everything dies with the stage's namespace and before the app commits.

**What changes, said plainly.**

- "No home folder" becomes **"no home folder, except the read-only browsers folder the person named."** It can sit under the person's home (that is where Playwright keeps its cache), is read-only, and holds public program files. The docs and the settings say so.
- A browser and a window server now run inside the sandbox. Their code is the person's own packages; the boundary is the same bubblewrap as before.

| # | Threat | Mitigation | Kind | Residual |
|---|---|---|---|---|
| G1 | The browsers path is a way to mount something else (a link, the home folder, the app's data, a secret place) | The same guards as `readOnlyPaths`: real path, refused parents and secrets, `assertBindsSafe` before the sandbox is built, read-only bind | enforced | A person who points it at a folder that holds more than browsers (the whole cache) shares that folder; the settings say what to name |
| G2 | Chromium and Electron run with `--no-sandbox` (their own sandbox cannot nest inside the sandbox, which disables user namespaces) | The outer sandbox is the only boundary and is unchanged: no network by default, no credential, no home, killed with the stage. A fresh profile in `/tmp`; the prompt forbids external addresses | enforced (outer), promised (the prompt) | A page the agent opens can run script. With the registry switch on, the proxy's host list is the reachable surface. A kernel or user-namespace bug defeats it, as for any command (T12 of the #30 threat model) |
| G3 | The display exposes the host (the host's X server, a TCP listener) | The display server is started **inside** the sandbox with no TCP listener; the sandbox has its own network, IPC and process namespaces, so neither a socket on the host nor the host's abstract socket is reachable; no X socket or host `DISPLAY` is ever bound or passed | enforced | To be pinned by the real-bwrap test (section 10) |
| G4 | The display server or a browser eats memory, processes or `/tmp` and `/dev/shm` (512 MiB each) | The same per-process limits as a command (memory, processes, file size); the stage's time limits end the rest. A full `/tmp` fails the command that fills it | enforced (per process) | No cap on the sum of memory; a screenshot-heavy run can fill its own `/tmp` |
| G5 | The tool that returns an image opens a file a hostile process controls (a link to a file of the person's, a pipe, a huge file, a file that is not an image) | Only the stage's output folder; no link followed, no pipe waited on, regular files only, size cap, type by content, as `readTailNoFollow` does | enforced | Pixels cannot be masked: **a screenshot of a page that shows a secret goes to the model's provider as is**, where text output goes through `redact`. The repository's source already goes there; the sandbox holds no credential to show |
| G6 | A writer commits a screenshot or a trace | The prompt says never to save them in the working folder; the folder to use is `/coxia/out`, which the app does not commit | promised | A writer that ignores it adds files to the diff the person reads before any push |
| G7 | Another stage or a ceremony `@mention` call starts a display it did not ask for | The display is an explicit request of the stage; the browsers folder is bound for a mention call too (it costs a read-only bind and a variable) but starts nothing | enforced | None known |
| G8 | A paired browser or an imported file switches the display or the folder on | Desktop only (not in `WEB_EDITABLE`); an import lists the folder among its paths and shows the switch | enforced | A file the person approves on the computer is theirs |

**Limits.** The per-command limit of 5 minutes and the stage's 30 stay; a dev server started by a command that times out dies with it. The default 2048 MiB of data memory was enough; below 1024 MiB Chromium and Electron are not expected to work.

## 7. Rules

1. Nothing changes for a workspace that sets neither field: the same binds, the same environment, the same prompt, no new tool.
2. `browsersPath` is bound like a read-only folder (section 4.1), for every sandbox of the workspace, and nothing else is put on the agent's `PATH` for it.
3. A display is started only when the workspace switch is on **and** the stage asked for it, inside the sandbox, ended with it. The host's display is never used.
4. `available` of the sandbox status does not depend on browsers or a display.
5. `ViewImage` reads only the stage's output folder, never follows a link, caps the size and checks the type by content.
6. A stage whose browsers or display are missing says so in the thread and in the prompt and goes on; it never fails for that reason alone.
7. Both settings are desktop only.
8. Images in the open engine are not part of this issue (#69).

## 8. Out of scope

- Images in the open engine's `Read` tool, and offering `ViewImage` to that engine: issue #69. Until then the agent is told it cannot look.
- Building visual artifacts (prototypes) in a stage, and showing screenshots to the person in the run screen or the thread.
- `shell: host`, or testing on the person's own display: it already works with one approval per command.
- Installing Xvfb, Playwright or browsers for the person, or finding them: the app only reports what is missing.
- A browser or Electron's own sandbox working inside ours.
- A new per-command limit for long GUI suites (open question 7).
- Per-stage choice of the display for a stage other than the QA one (open question 2).
- A configurable screen size.

## 9. Open questions for the maintainer

Each has the options and the answer this spec recommends, so approving is quick. Until answered, the text above follows the recommendation.

1. **The browsers folder: a dedicated field, or inferred from `readOnlyPaths`?**
   - *Dedicated `runner.sandbox.browsersPath`* (recommended). Explicit; the status can say "the browsers folder is missing"; the variable is set from a value the app owns; the guards run on it.
   - *Inferred*: a listed folder with a recognisable name or content gets the variable. Implicit and fragile (which folder? by what name?), and a toolchain folder becomes magic.
2. **Who gets the display: per workspace, per agent or per stage; may writers have it?**
   - *A workspace switch, used only by the stage that produces the QA output when its agent runs in a sandbox* (recommended). Smallest widening: no new agent permission, nothing for a template or a phone to raise, writers keep not having it (they commit what is in their tree).
   - *Per agent* (a field on the agent): more precise (a developer who writes interface tests could have it), but `agents.team` is editable from a paired browser, so it needs a "can only be lowered" rule like `shell` and a migration of the field.
   - *Per stage* (a field on the stage): the flow editor grows another control.
   - Writers: not in this issue; a follow-up can add it once the screenshot rule (G6) has been seen in use.
3. **Where may the display program come from?**
   - *The sandbox's `PATH`: the system's `/usr` and the `bin` of a listed read-only folder* (recommended). No new setting; matches the issue; a person without Xvfb installed can unpack one into a folder and list it, as the experiment did.
   - *`/usr` only*: simpler to explain, but excludes a person who cannot install system packages. Noted: a display program run from a listed folder needs its keyboard data reachable; the experiment had it in `/usr`. To be confirmed in the plan.
4. **How does the model get the screenshot?**
   - *A dedicated tool that reads only the stage's output folder* (recommended). One place to guard; it works for a reader and a writer; it does not change what `Read` may reach.
   - *Widen the roots of `Read`* to the stage's output folder and the reader's copy: two engines with different `Read` implementations (the SDK's roots are unverified), and it gives every stage that folder as a reading place.
   - *Both*: more surface for little gain.
5. **Schema bump, or follow `runner.release`?**
   - *No bump* (recommended). Absent already means "none" and "off"; a bump with an empty step changes nothing in a stored file, and the failure mode of an older app is a narrower sandbox block with a note, not a wider one.
   - *Bump to 13 with an identity step*: an older app refuses the file cleanly ("written by a newer app") instead of resetting `runner.sandbox`, at the price of a step that does nothing and a file no older release can read after a person tries the setting.
6. **Does QA use GUI testing by default when it is available, or only when the agent is switched on for it?**
   - *By default when the workspace has the pieces on* (recommended): the person already chose twice (the folder, the switch); the prompt says to start an interface only when the spec's criteria involve one; an agent set to `shell: none` or `allowlist` never has it.
   - *A per-agent switch as well*: another control for a capability that is already off unless the workspace turned it on.
7. **A separate per-command time limit for GUI suites?**
   - *No new value* (recommended). `runner.sandbox.limits.commandMs` already goes from 5 seconds to an hour and applies to a workspace that wants to run long Electron suites; the experiment's runs took seconds. The docs say so.
   - *A second limit for commands that use the display*: a second knob and a rule for which command "uses" it.
8. **A stage that needs a display or browsers and does not have them: go on, or fail?**
   - *Go on, say so in the thread and in the prompt* (recommended): the stage's other scenarios are still worth running, and the interface ones become visibly `not-run` with the reason. The sandbox's own failure stays fail-closed because it is a security matter; this is a capability.
   - *Fail the stage with a message*, as a missing sandbox does: a clearer stop, but a whole QA pass is lost for a missing optional tool.
9. **Fixed screen size?**
   - *Fixed 1280x800 at 24 bits* (recommended): the experiment's size; Playwright sets a page size itself, and a window app is a window inside it.
   - *A setting*: one more field for a number nobody asked to change.

Assumptions the plan must verify before relying on them (they are risks, not decisions): the Claude Agent SDK passes an image returned by an in-process tool to the model; an Xvfb run from a listed folder finds its keyboard data; the display server behaves under the per-command limits when started by the supervisor; the host's abstract X socket is unreachable from the sandbox; the Claude Agent SDK engine's own `Read` roots.

## 10. Acceptance

Verifiable on screen or by test. No test reaches a model, a host or the network, and none needs a real browser.

1. With the browsers folder set to an existing folder, a stage's command sees the folder read-only at the same path and `PLAYWRIGHT_BROWSERS_PATH` set to it; a write into it fails. With the setting empty, nothing about the sandbox changes (the binds, the environment and the stage prompt are equal to today's).
2. A browsers folder that is the home folder, a parent of it, the app's data, a link, a secret-looking place, or missing is refused by the setting's check and by the stage, with the existing folder messages.
3. With the display switch on and a display program available, a QA stage's commands see `DISPLAY` set and a display server running inside the sandbox; its socket is in the sandbox's `/tmp` and nowhere on the host; after the stage the process is gone and the stage folder is removed. A mention call and a stage of another kind get no display even with the switch on.
4. A real-bwrap test of the above starts the display server, checks the variable, the socket and that the process ends with the session, and **is skipped when `bwrap` or the display program is missing**, like the existing real-sandbox tests. A policy test pins the arguments and the variables; a session test pins the new ready token and that it ends the stage cleanly.
5. In Settings and the team editor the sandbox status shows browsers and display as their own lines. With no display program the display line says why, the sandbox stays available, and `shell: sandbox` is still offered. After the folder setting is saved and "check again" is pressed, the browsers line follows it. A paired browser sees both lines and cannot change either setting (pinned in the web-scope test).
6. A stage that has the switch on and no display program gets one message in the run's thread naming the missing piece, goes on, and its prompt says the display is not available and to mark the scenarios that need it `not-run`.
7. The QA stage prompt with browsers or a display on contains the block of section 4.4; with neither on it is identical to today's. Both catalogs carry the keys.
8. On the Claude Agent SDK engine, `ViewImage` returns a PNG from the output folder as an image and refuses: a path outside the output folder, a link, a pipe, a directory, a file over the cap, and a file whose bytes are not an image with a `.png` name. On the open engine the tool is not offered and the prompt says the agent cannot look at images.
9. A configuration without the new fields loads, equals the defaults (`null` and off), and passes the drift test between the types, the schema and the defaults; one with them round-trips; an import lists the folder among its paths.
10. The sandbox sections of `docs/runner.md` (both languages) and the `runner` rows of `docs/configuration.md` describe the two settings and the exception to "no home folder"; the changelog's unreleased section lists the change. Typecheck, the whole test suite, the theme audit, the i18n lint and the public audit pass.
