# #30 Agent permissions: code host read and sandboxed execution per agent — functional spec and threat model

Issue: https://github.com/exatasmente/coxia/issues/30

This document is written to be reviewed by a person **before any code**. Section 5 is the threat model; section 8 lists what the maintainer has to decide. Nothing here widens what an agent can do for an existing workspace: every widening is something a person switches on, on the computer, and sees.

## 1. What exists today (read from the code, not from memory)

| Capability | Agent that only reads (`permission: read`) | Agent that writes (`permission: worktree`) |
|---|---|---|
| Files | `Read`/`Grep`/`Glob` with the secret-file rule (`noSecrets`); on the Claude Agent SDK engine the tools are **not** confined to the worktree | the same, confined to the worktree by `src/main/engine/guard.ts`; `Edit`/`Write` inside it |
| Code host reads | what the ceremonies get, **workspace-wide**: the host CLI allow-list, the `VcsRead` app tool or the tracker MCP tools, gated by `agents.tools.vcsCli` / `agents.tools.trackerMcp` (`toolsOf`, `allowedFor`, `agentHooks`, `wantsVcsTool` in `src/main/agents.ts`; pinned by "gives a reader the tools of the ceremonies" in `test/runner-agent.test.ts`) | none |
| Shell | none (QA only reads the exit codes and output tails of the commands the **app** ran before it, `runner/commands.ts`, unsandboxed, environment scrubbed) | the commands of `runner.commands` character for character (`null`: the `test` and `typecheck` scripts of the repository), no shell, scrubbed environment; run by the engine's own Bash tool as a child of the app (on the Claude SDK, whose process holds the provider's key, each command is rewritten to `env -u NAME ...`) |
| Network, `git push`, MCP | none | none |
| `@mention` and question-chain calls | read only, whatever the agent's permission (`runner/mention.ts`, `runner/chain.ts`) | same |

Two things the issue's summary says differently from the code, and that this spec relies on: (a) a reader of a run **does** get the code host read today, but as a workspace-wide switch, not per agent; only an agent that writes gets none; (b) the app itself runs `npm test` and friends before QA **outside any sandbox**, and runs `git add -A`, `git status` and `git diff` in the worktree after every stage, also outside any sandbox. Both matter for the threat model.

## 2. What this delivers

Two permissions per agent, chosen in the team editor, with defaults per role, and a QA report that says what was executed.

### 2.1 Code host read: `tracker: none | read`

- `read`: the agent can read the issue, its comments, labels and milestone, the merge or pull requests linked to it, and a pull request's diff, review threads, comments and checks, in the projects of the workspace. **Never a write.** Writing to the host stays where it is: the door of Actions (`runner/door.ts`), under the agent's autonomy, audited.
- The read path is the one the workspace already has (the host CLI allow-list when the integration uses a CLI, the `VcsRead` app tool when it does not, the tracker MCP tools when configured), subject to the workspace switches in Settings that already exist (`agents.tools`): `tracker: read` does not turn a path on, it lets this agent use the one that is on. When no path is active the editor says so next to the field.
- An agent that **writes** (`worktree`) with `tracker: read` is given the `VcsRead` app tool and nothing else of the host: no CLI (it would need the person's CLI credentials inside a process that runs repository code) and no MCP server (a process with credentials of its own). The tool runs in the app, with the app's provider; the token never enters the agent's environment.
- `VcsRead` gains one operation, `issue_linked_mrs`, over `VcsProvider.linkedMrs` (it exists). Labels and milestone already come with `issue`. **Linked issues** (issue-to-issue links) are not covered: the provider interface has no such read, and this spec does not add one. It is said in the docs.
- Defaults: `read` for the Product Owner and the Tech Lead; `none` for everyone else.
- `@mention` and question-chain calls keep the agent's `tracker` (a read) and never get a shell, whatever `shell` says.

### 2.2 Execution: `shell: none | allowlist | sandbox`

- `none`: no shell. `allowlist`: the commands of `runner.commands`, exactly as today. **Both are what exist today**; `allowlist` is valid only with `permission: worktree` (a reader that ran repository commands in the real worktree could leave files that the app then commits; see T9 and 4.7).
- `sandbox`: the agent gets one more tool, `Shell`, that runs **any command** inside a sandbox the app builds for the stage:
  - the worktree is read-write, the rest of the system read-only, **nothing of the person's home outside the worktree**, `.git` read-only;
  - the environment is built from nothing (no variable of the app or of the person passes, so no credential, no provider key, no agent socket);
  - **network off** by default; a workspace switch lets the sandbox reach the package registry through a filtering proxy and nothing else (rule 6); "localhost" inside the sandbox is the sandbox's own, so a dev server works, and the machine's own services are not reachable;
  - limits per command (time) and per stage (cumulative time), and per process (memory, processes, file size);
  - **long-running processes are allowed** (a dev server started in one command answers the next) and are killed when the stage ends;
  - **never `git push` or a host write**: there is no credential and no route to the host, and the door of Actions is not reachable from inside;
  - every command, its exit code and the end of its output go to the run's thread, to the live activity and to the audit log.
- An agent that only **reads** (`permission: read`) with `shell: sandbox` works in a **throwaway copy** of the worktree mounted at the same path: it can install, build and run tests, and whatever it creates is deleted with the copy; the real worktree and branch are never changed by it (4.7). An agent that **writes** with `shell: sandbox` works in the real worktree.
- Defaults: `sandbox` for QA, the developer and the Tech Lead; `none` for the rest.
- `sandbox` is offered only where a sandbox works (section 3). The stage of an agent set to `sandbox` on a machine where it does not work **fails closed**: it never runs the commands unsandboxed, and the message says to choose `allowlist` or `none`.

### 2.3 QA's report says what was executed

- Each scenario of a QA pass carries `evidence`: `executed` (the agent ran something in its sandbox to check it) or `read` (it only looked at code, documents or results). An agent with `shell: sandbox` is asked to say which and to cite the commands that back an `executed` scenario (their numbers in the stage's command list); any other QA agent is not asked, and every scenario is recorded as `read`.
- The **app checks the claim**: `executed` stands only when it cites at least one command of this stage and at least one of them ended with exit code 0. Otherwise it is recorded as `read` and **labelled** "claimed as executed, nothing backs it" (`unbacked`). A pass without execution is therefore visible as one, in the run screen, in the thread, and in the QA comment (a section that says "3 of 5 scenarios were executed" and names the claims nothing backed).
- It is evidence that a command ran, not that the behaviour is right: a test script can print what it likes (T16). The label says "executed", never "verified".
- The commands the app runs before QA (`runner.commands`) stay as they are for a QA agent without a sandbox. For a QA agent with a sandbox they run **inside it** (same session), so the app stops running repository code unsandboxed on that path.

## 3. Where a sandbox is offered

| Platform | Offered | Why |
|---|---|---|
| Linux with bubblewrap and unprivileged user namespaces | `none`, `allowlist`, `sandbox` | the backend (below) |
| Linux without them (no `bwrap`, user namespaces refused by the distribution or a security module) | `none`, `allowlist` | the editor says why and what to install or allow |
| macOS, Windows | `none`, `allowlist` | no equivalent that an app can rely on (below) |

**Why bubblewrap.** It is unprivileged (user namespaces, no root, no daemon, no group that is root in disguise), starts in milliseconds, and lets the app describe the filesystem as an allow-list of binds, which is what "nothing of the home" needs. It is one small binary the distributions package. It is installed on the maintainer's machine and was exercised there (version 0.9.0).

**Why not Docker.** The daemon is root on the machine: membership of the `docker` group is root, so an app that drives it widens its own authority instead of narrowing the agent's. It needs an image (a toolchain per project), a pull (network) and a way to hand over the worktree, and each command costs a container start. It also is not on every machine. Docker stays a possible second backend behind the same interface (open decision D7); it is not built here.

**Why not on macOS and Windows.** macOS has `sandbox-exec` (Seatbelt), which is deprecated, undocumented and not something a public app should build a safety claim on; Windows has no unprivileged equivalent short of a VM. The honest answer is not to pretend: on those systems the editor offers `none` and `allowlist` and says "no sandbox on this system", and the docs say so.

**How the app knows.** `sandbox:status` runs a real, harmless sandbox with exactly the flags a stage uses (and the helper binaries it needs) and reports `available`, the version and a reason. It is cached for a few minutes and re-run on demand. A machine's answer is not stored in the configuration (a configuration travels between machines).

## 4. What the person sees and approves

### 4.1 The team editor

Two new fields next to **Permission**, both with the hint under the control:

- **Code host** (`none` / `read`): "Reads issues, comments and pull requests; never writes." A note when no read path is active.
- **Commands** (`none` / `allowlist` / `sandbox`): `allowlist` is shown only for an agent that writes; `sandbox` only when the status says it works (otherwise the option is not there, and a line says why). A hint per value, and under `sandbox` a one-line summary of what the sandbox can reach (network off / registry only; and the list of extra read-only folders when there are any).
- The list of agents shows both values.
- In a **paired browser** the two fields can be lowered (`sandbox` to `allowlist` or `none`, `read` to `none`) and never raised, and a new agent made from the phone has `none` for both (rule 9).

### 4.2 Recommended permissions (offered, never forced)

For a team the app can recognise (the agents of the agent cycle and of the engineering cycle, by id), the team editor shows a **Recommended permissions** panel listing each agent whose settings differ from the default of its role, with what would change, and one button that applies the recommendation. Nothing is applied by itself. The panel is not shown in a paired browser (the button raises permissions).

### 4.3 Runner settings: the sandbox block

Desktop only (the block is shown read-only in a paired browser, like the commands). It holds: the network switch (off, or "package registry only"), the registry hosts (default `registry.npmjs.org`, `registry.yarnpkg.com`), extra read-only folders (for a toolchain installed in the home, such as the Node version manager's folder; each must exist, be absolute or `~/`, and not look like a secret location; the person is told these folders become visible to every sandbox of the workspace) and the limits. A warning line under the network switch says what "registry only" means and does not mean (rule 6).

### 4.4 The run screens

In the thread, one app message per command with its exit code, duration and the end of its output (and one per request the registry proxy decided on); in the live activity, the command and then its exit code; in Settings → Audit log, one row per command (kind "Sandbox command", with the agent that ran it). A QA scenario in the review rounds shows its evidence (executed / only read / "claimed as executed, not backed"). There is no separate commands panel under a stage: the thread is where they are.

### 4.5 Existing workspaces (migration, schema 9 to 10)

The migration **never raises** what an agent can do:

| Agent today | After the migration |
|---|---|
| `permission: worktree` | `shell: allowlist`, or `none` when `runner.commands` is `[]` (today it can run nothing); `tracker: none` (it has none today) |
| `permission: read` | `shell: none` (it runs nothing today); `tracker: read` when `agents.tools.vcsCli` or `agents.tools.trackerMcp` is on (it has the host read today), else `none` |

`runner.sandbox` is added with `network: off`, the default hosts, no extra folders and the default limits. The migration notes say all of this. The recommendations of 4.2 are how a person moves to the new defaults.

*Deviation from the issue's wording:* the issue asks to migrate existing agents to `tracker: none`. For a reader that would **remove** a read it has today when the workspace switch is on, and widen nothing; the migration keeps it. Open decision D1 asks the maintainer to confirm.

### 4.6 New teams and templates

The agent cycle and the engineering cycle bring the defaults of 2.1 and 2.2. A template applied on a machine where the sandbox does not work brings `allowlist` (developer) or `none` (the others) instead of `sandbox`; a template applied to an existing team adds only the agents that are missing, as today (an agent that is there is never touched).

### 4.7 The reader's copy

A reader with a sandbox gets the tree copied (without `.git`) into a folder of the app's data (`sandbox/<run>-<stage>/tree`), mounted at the worktree's own path. The copy is refused above a size limit (default 2 GiB) with a message. It is deleted when the stage ends. The reader's documents still come out of its answer and are written by the app into the real cycle folder, as today.

## 5. Threat model

### 5.1 Assets

| # | Asset | Why it matters |
|---|---|---|
| A1 | The person's home folder and everything in it (keys, tokens, browser profiles, shell history, other projects) | the usual target |
| A2 | Secrets in the environment of the app: the model provider's key, host tokens, an SSH or GPG agent socket | live credentials |
| A3 | Code host credentials: the host CLI's own configuration, tokens inside a remote URL in `.git/config`, credential helpers | what would turn a prompt injection into a push or an issue edit |
| A4 | The network as seen from the machine: the internet, the LAN, services on `localhost` (including the app's own web port), cloud metadata addresses | exfiltration and lateral movement |
| A5 | The app's own data folder: configuration, secret references, runs, the forum, the audit log, the worktrees of other runs | integrity and confidentiality of the whole workspace |
| A6 | Other repositories on the machine, and the working tree of the clone a worktree was made from | confidential source |
| A7 | The machine's resources: CPU, memory, disk, processes | availability |
| A8 | The integrity of the run's worktree and branch: what the app later commits, shows to a reviewer and offers to push | what the person trusts when they approve a push |
| A9 | The code host (issues, comments, branches, pull requests) | writes are the person's |
| A10 | The repository's own source | an agent has it by design; it must not leave except through the model and the person's own push |

### 5.2 Adversaries

| # | Adversary | Capability |
|---|---|---|
| V1 | **Prompt injection** from text the agent reads: an issue, a comment, a review thread, a README, a file in the repository, a tool result | chooses the commands the agent runs, and what it writes |
| V2 | A **compromised dependency** installed by `npm install` (or a package's install script, or code a test loads) | arbitrary code in the sandbox, at install time and at test time |
| V3 | A **malicious test or repository script** (a contributor's, or one an earlier stage wrote) | arbitrary code, and files left in the worktree for the app to find |
| V4 | A **hostile model response** (a compromised or misbehaving provider) | the same as V1 |
| V5 | A **paired browser** session or an **imported configuration or template** | tries to raise what agents may do without the person at the computer |
| V6 | A **poisoned artifact of an earlier stage**: a file or link the sandbox left for the app or for a later agent to read | reaches outside the sandbox through the app's own reads |

### 5.3 Threats, mitigations, residual risks

"Enforced" means the mechanism stops it without trusting the model or the code inside; "promised" means it rests on a rule the app or the person keeps.

| # | Threat | Adv. | Mitigation | Kind | Residual risk |
|---|---|---|---|---|---|
| T1 | Read the home folder (keys, tokens, history, other projects) | V1 V2 V3 | The sandbox root is built from an allow-list of binds: `/usr`, the library and binary links, `/etc`, a private `/proc`, `/dev`, a `/tmp` of its own, the worktree and a few app folders. **`/home`, `/root`, `/run`, `/mnt`, `/media`, `/var` do not exist inside.** `HOME` is an empty folder made for the stage | enforced | What the person adds as extra read-only folders is visible to every sandbox (they are listed in the settings and validated against the secret-file rule and against `~`, `/`, the data folder and `.ssh`/`.gnupg`/`.aws`-like names). World-readable files in `/etc` can be read |
| T2 | Read secrets from the environment | V1 V2 V3 | The environment is **built**, not filtered: `--clearenv` and a short list (`PATH`, `HOME`, `TMPDIR`, `LANG`, `TERM`, `CI`, the registry proxy variables, and git's safety variables). Nothing is copied from the app's environment. The provider's key never leaves the main process | enforced | A secret that is **inside the repository** (a committed `.env`, a key file) is readable by a shell in the worktree, as it is by anyone who clones it. The output is masked by `redact` before it is shown or stored, and `Read`/`Grep`/`Glob` still refuse such files; a command that prints it to the model gets it masked, not blocked |
| T3 | Use or steal code host credentials | V1 V2 V3 | No CLI configuration, no helper and no agent socket exist inside; git's global and system configuration are switched off; the repository's own `.git/config` is replaced inside the sandbox by a copy without credentials in URLs and without `extraheader`, helper or token keys (`sanitizeGitConfig`). The host read is done by the app (`VcsRead`) with the token in the main process. A write to the host has no route (T4) and the only door, Actions, is not reachable | enforced | The sanitiser is a pattern list: a credential stored under a key it does not know would stay in the copy. The person's own `.git/config` is never changed |
| T4 | Exfiltrate the repository, outputs or anything else over the network | V1 V2 V3 V4 | Default: a **new network namespace with only its own loopback**. There is no interface, no route, no resolver. With the registry switch: still no interface; the only way out is a **filtering proxy in the app**, reached through a socket in the stage's folder: `CONNECT` to port 443 of the listed hosts only, names resolved by the app and refused when they resolve to a loopback, private, link-local or metadata address, with a cap on connections and bytes, every attempt logged. A program that ignores the proxy variables simply has no network | enforced | **Registry mode is a covert channel to the listed hosts** (a request to a registry carries what the URL says; a registry operator could read it). The proxy cannot see inside TLS. Nothing secret is meant to be inside the sandbox, but the repository's source is. The window is the person's choice and the default is closed |
| T5 | Reach the machine's own services (a database, the app's web port, a metadata endpoint) | V1 V2 V3 | The sandbox's `localhost` is **its own**: the host's loopback is not reachable. In registry mode the proxy checks the address it connects to, not the name (rebinding) | enforced | None known beyond T12 |
| T6 | Read or change the app's data (config, runs, audit log, other worktrees) | V1 V2 V3 | Not mounted. Of the data folder the sandbox sees only its own stage folder (control files read-only, output folder, copy, home). The worktree's parent folders exist inside as empty directories; siblings do not | enforced | If the person points the sandbox's extra folders at the data folder the validator refuses it |
| T7 | Read other repositories or the clone's working tree | V1 V2 V3 | Only the worktree and the **git directory of its repository** are bound, the latter read-only, with `config` replaced (T3) and `hooks` replaced by an empty folder. The clone's working tree is not mounted | enforced | Other branches and objects of the **same** repository are readable (git needs them) |
| T8 | Turn the app's own unsandboxed git commands into code execution (a rewritten `.git` pointer, a config key such as `core.fsmonitor`, a hook, a filter driver) | V2 V3 V6 | `.git` (a file in a worktree, a folder in a clone) is bind-mounted **read-only on itself**: it cannot be edited, replaced or removed from inside. The real git directory is read-only (T7). The app already commits with `core.hooksPath=/dev/null`, no signing, no file-system monitor, and reads diffs with `--no-ext-diff --no-textconv`. `.husky`, `.githooks`, `.gitattributes` and `.gitmodules` that exist are bound read-only too | enforced for what exists | A `.gitattributes` created by the sandbox can name a filter driver that **the person's own git configuration** defines; `git add -A` would then run it outside the sandbox. A hook directory the repository does not have yet can be created in the worktree, but nothing runs it (the app disables hooks) |
| T9 | Plant a symbolic link or a file in the worktree that the app later reads *outside* the sandbox (the cycle folder read for the next prompt, a document shown in the screen) | V3 V6 | `readFolder` and `readArtifact` read only regular files that resolve inside the worktree (`lstat` and `checkPath`); a link is skipped and said. A reader works in a copy, so it plants nothing in the real tree. The app's git stores links as links | enforced | An unconfined reader on the Claude SDK engine can already read outside the worktree (secret-looking names excepted): a link adds nothing for it. That gap exists today and is **not** closed here (open decision D6) |
| T10 | Leave code that runs when the **person** later uses the branch (a script, a hook, an editor task, an `.envrc`) | V2 V3 | Nothing runs on its own: the app disables hooks; the push **always waits** for the person's yes, after they can read the diff. The diff includes dotfiles | promised | Inherent to taking code from an agent: reading the diff before pushing is the defence |
| T11 | Exhaust CPU, memory, disk or processes | V2 V3 | Per command: wall-clock limit (`timeout`, then kill), `RLIMIT_DATA` (default 2 GiB), `RLIMIT_NPROC` (default 256, counted inside the sandbox's own user namespace on Linux 5.14 and later), `RLIMIT_FSIZE` (default 256 MiB); `/tmp` is a size-capped memory filesystem; a cumulative budget per stage (default 30 min of command time); output is cut. All stop at the stage's own limits as before (`stageIdleMs`, `stageMaxMs`) | enforced (per process) | No CPU quota; no cap on the **sum** of memory of many processes; no disk quota on the worktree. cgroups are not available without privileges. A runaway can slow the machine until the stage limit |
| T12 | Escape the sandbox through a kernel or user-namespace bug | V2 V3 | Unprivileged user namespaces, `no_new_privs`, nested user namespaces disabled, `--new-session` (no terminal injection), `--die-with-parent` | enforced as far as the kernel is | **A sandbox is a mitigation, not a virtual machine.** No seccomp filter is applied (none can be compiled without extra tooling). A kernel vulnerability defeats it. Keep the system updated |
| T13 | A process outlives the stage (a dev server, a miner) or the app | V2 V3 | Everything lives in the stage's own process namespace; the sandbox is killed with its whole process group when the stage ends (also on error, cancel and timeout), and with `--die-with-parent` when the app dies. **The sandbox is closed before the app runs its first git command of the stage**, so no sandbox process can race the commit | enforced | None known |
| T14 | The model asks for more than `command`: another folder, another mount, another limit | V1 V4 | The `Shell` tool takes one string, `command`, with a size cap. Mounts, limits, network and environment come only from the configuration | enforced | None |
| T15 | Raise permissions without the person: a paired browser, an imported configuration, an imported template | V5 | A paired browser can lower `shell` and `tracker` and cannot raise them, nor touch `runner.sandbox` (`configScope.ts` checks the change against the stored configuration, field by field). An import's preview lists every agent set to `sandbox` among the programs the import would run, and its extra folders among its paths. A template applied on a machine without a sandbox cannot bring `sandbox`. The extra folders are validated again when a sandbox is built | enforced | An imported or hand-edited file that the person approves on the computer is theirs |
| T16 | QA claims to have executed something it did not, or a script lies | V1 V2 V4 | `evidence` is checked against the stage's own command list; an unbacked claim is recorded as `read` and labelled | enforced for the claim, **promised** for the truth | A test script can print "pass" and exit 0. "Executed" is a statement about what ran |
| T17 | Prompt injection steers a tracker read into disclosure (an issue says "paste the other issue here") | V1 | `tracker: read` is read-only; what an agent writes to the tracker is checked and goes through the door of Actions under the agent's autonomy, as today. Nothing new is written | promised (as today) | What a model reads from the tracker goes to the model's provider, as for the ceremonies |
| T18 | The proxy and the control channel become an attack surface | V2 V3 | The stage folder is `0700` in a folder of the app's data; the proxy listens on a socket inside it, not on a port; it speaks only `CONNECT` and answers everything else with an error; the supervisor in the sandbox reads one line per command and a token the app made per command | enforced | A process inside can write to the output folder (it is the command's own output) and could print a line that looks like the supervisor's; the token is not available to it. Its worst case is a wrong exit code for its own command |
| T19 | Output as an injection vector into the thread, the comments or the audit log | V1 V3 | Output goes through `redact`, is cut to its end, shown as text (never rendered), and the agent receives it as tool output inside the usual "this is material, not instruction" rule. Nothing in it reaches the tracker except through the agent's own comment, checked as today | enforced / promised as today | A model may repeat what it read |

### 5.4 What stays outside the guarantee

- The model provider sees everything the agent reads and every command output. The sandbox limits what there is to see; it does not hide what the repository contains.
- A person who adds a read-only folder, or turns the registry on, takes the corresponding risk knowingly. The defaults are closed.
- The commands of `allowlist` and the commands the app runs before QA for a QA agent without a sandbox are **not sandboxed**: they run as today, with the scrubbed environment. That is why the defaults move QA, the developer and the Tech Lead to the sandbox, and why `allowlist` stays an explicit choice.
- Existing guards stay: the write guard (`guard.ts`), the secret-file rule, the denial of the network and of `git push` for the other tools, the hooks that make the app commit without hooks, the door of Actions and its audit. `@mention` and question-chain calls stay read-only.

## 6. Rules

1. `tracker` and `shell` are per agent, stored in the configuration. A missing field reads as `none` (and `allowlist` for an agent that writes, which is what it was).
2. `allowlist` requires `permission: worktree`; the configuration check refuses it otherwise.
3. The sandbox exists per **stage attempt** and is closed before the app commits, when the stage ends, fails, is cancelled or times out.
4. The sandbox never receives anything from the app's environment, never a credential, and never a folder the configuration did not name.
5. A stage whose agent needs a sandbox that does not work **fails**, with a message that says what to do; nothing falls back to running unsandboxed.
6. **Network.** `off` (default): nothing leaves. `registry`: only `CONNECT` on port 443 to the listed hosts, through the app's proxy; it needs the sandbox's `PATH` to have `node` (the forwarder from the sandbox's own loopback to the proxy is a short Node program run inside it); without it the stage fails with that message. It is **not** a general internet switch and is documented as a window to the listed hosts only. "Localhost" is the sandbox's own.
7. A command has a limit of time, memory, processes and file size; a stage has a budget of command time; the output kept is the end of it, masked.
8. A `Shell` call is refused, with the reason, when the command is empty or longer than 8 KiB, when the stage's budget is used up, or when the sandbox ended. One command runs at a time per stage.
9. A paired browser may lower `tracker` and `shell`, never raise them, and may not change `runner.sandbox`; an agent it creates has `none` and `none`.
10. The migration never raises what an agent can do (4.5). The recommended permissions are offered, never applied.
11. `evidence` is checked by the app (2.3); without a sandbox every scenario is `read`.
12. The write guard, the secret-file rule and the prompt goldens do not change for a workspace that does not use the new fields.

## 7. Out of scope

- Docker (or any other backend) as an alternative sandbox; a sandbox on macOS or Windows.
- Reading **linked issues** (issue-to-issue links); writing to the host from an agent.
- cgroup-based limits, a disk quota, a seccomp filter, network filtering by anything other than the registry proxy.
- Closing the pre-existing gap that an unconfined reader on the Claude Agent SDK engine can read outside the worktree (D6).
- Running the ceremonies' agents (daily, unblock, retro) in a sandbox: they run no commands.

## 8. Decisions of the maintainer

Reviewed and **approved by the maintainer on 2026-10-03**, each decision as this spec recommends it (D6 is to be opened as a separate issue).

- **D1** (approved) Migration of a reader's `tracker`: keep what it has today (this spec) or set `none` as the issue says.
- **D2** (approved) `allowlist` only for agents that write (this spec) or also for readers.
- **D3** (approved) A reader with a sandbox works in a **throwaway copy** (this spec) versus the real worktree read-write as the issue states. The copy costs disk and time and guarantees QA cannot change the branch.
- **D4** (approved) Registry mode needs `node` inside the sandbox for the forwarder. The alternatives are `socat` (not installed everywhere) or a network that is fully open (rejected: it reopens T4).
- **D5** (approved) The defaults of the sandbox limits (2 GiB, 256 processes, 256 MiB files, 5 minutes a command, 30 minutes a stage).
- **D6** (approved) Closing the unconfined-reader gap (T9, last column) is a separate change.
- **D7** (approved) Docker as a second backend later.

## 9. Acceptance

1. A team with the defaults: the Product Owner and the Tech Lead show `read`, QA, the developer and the Tech Lead show `sandbox` (where one works); nobody else has either.
2. An existing workspace opens with the migration of 4.5, no agent gained a command or a host read it did not have, and the notes say so.
3. A sandboxed command cannot read the home folder, cannot write outside the worktree, cannot see an environment variable of the app, cannot reach the network, and cannot change `.git`; a process started in one command answers the next and is gone when the stage ends.
4. A paired browser cannot raise `shell` or `tracker` nor touch `runner.sandbox`.
5. A stage of an agent set to `sandbox` on a machine without a sandbox fails with the message, and runs nothing.
6. A QA pass records `evidence` per scenario; a claim of `executed` with nothing behind it is labelled.
7. Every command appears in the thread, the live activity and the audit log with its exit code.
8. No test reaches a model, a host or the network; the test that really runs `bwrap` runs only where it exists and uses harmless commands in a temporary folder.
