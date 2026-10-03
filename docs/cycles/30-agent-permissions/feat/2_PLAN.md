# #30 Agent permissions: code host read and sandboxed execution per agent — technical plan

Reads with [`1_SPEC.md`](1_SPEC.md) (rules and threat model; the IDs `T1`..`T19`, `D1`..`D7` and "rule N" below point there). Everything here is checked against the code as of release 0.4.1 (config schema 9; the issue's text says "v4": the current version is 9, so the new one is **10**).

## What gets built

1. `AgentDef.tracker` and `AgentDef.shell`, `runner.sandbox`, validation, the schema, the migration to schema 10, the defaults of the two shipped teams, the web scope.
2. `src/main/sandbox/`: the policy and argv builder (pure), the git view, the capability probe, the session (supervisor, limits, lifecycle), the registry proxy and forwarder, the reader's copy, the tool for both engines.
3. The wiring: `agents.ts` (`AgentCall`, `EngineRequest`, tool lists, the `VcsRead` tool for agents that write), `runner/executor.ts` (open, use and close the session; QA evidence), `runner/service.ts` (preflight, recording), thread/activity/audit lines.
4. The screens: the two fields in the team editor, the recommended permissions, the sandbox block in the runner settings, the evidence in the review rounds, the audit row.
5. Tests (fakes everywhere; one real `bwrap` test that skips when it is missing), docs in both languages, the changelog, the test plan.

## 1. Config

```ts
export const AGENT_TRACKERS = ['none', 'read'] as const;            // AgentTracker
export const AGENT_SHELLS = ['none', 'allowlist', 'sandbox'] as const; // AgentShell
export const SANDBOX_NETWORKS = ['off', 'registry'] as const;

interface AgentDef { /* ... */ tracker: AgentTracker; shell: AgentShell; }

interface RunnerSandbox {
  network: 'off' | 'registry';
  /** Exact host names the registry switch lets through (HTTPS, 443). */
  registryHosts: string[];
  /** Folders outside the worktree the sandbox may read: "~/" or absolute, read-only. */
  readOnlyPaths: string[];
  limits: { commandMs: number; stageMs: number; memoryMb: number; processes: number; fileMb: number; copyMb: number };
}
interface RunnerConfig { /* ... */ sandbox: RunnerSandbox }
```

Defaults (`neutralRunner().sandbox`): `network: 'off'`, `registryHosts: ['registry.npmjs.org', 'registry.yarnpkg.com']`, `readOnlyPaths: []`, limits `commandMs 300_000`, `stageMs 1_800_000`, `memoryMb 2048`, `processes 256`, `fileMb 256`, `copyMb 2048`. Ranges (schema and validator): `commandMs` 5 s to 1 h, `stageMs` 1 min to 8 h, `memoryMb` 512 to 65 536 (below 512 a Node process does not start under `RLIMIT_DATA`; measured here: 256 MB fails, 2 GiB works), `processes` 16 to 4096, `fileMb` 1 to 8192, `copyMb` 64 to 65 536.

`newAgent()` fills a missing `tracker` with `none` and a missing `shell` with `allowlist` for `permission: worktree`, `none` otherwise: **the value it had before the fields existed**, so a file that lacks them reads exactly as it behaved. `systemAgent()` (the five ceremony agents) is `none`/`none`.

Validation (`validate.ts`, errors unless stated):
- `agents.team[i].shell: allowlist` with `permission: read` (rule 2). The repair path of the migration resets such a field to its default.
- `runner.sandbox.registryHosts`: each a host name (`^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$`, at least one dot, no scheme/port/path/wildcard), at most 20, no duplicates (warning).
- `runner.sandbox.readOnlyPaths`: each absolute or `~/…`, not `~`, not `/`, no `..`, and not matching the shared secret-looking rule (`readOnlyPathProblem` in `src/shared/sandboxPaths.ts`: `.ssh`, `.gnupg`, `.aws`, `.config`, `.docker`, `.kube`, `.npmrc`, `.netrc`, `.pypirc`, `.claude`, `.git-credentials`, names with `secret`, `credential`, `token`, `.env`, `id_*`); at most 20. The data folder and the home folder itself are refused at run time (`sandbox/policy.ts`), where the machine is known.
- `runner.sandbox.limits.*` within the ranges above (error), `stageMs < commandMs` (warning).
- A warning (not an error) is not raised for `shell: sandbox`: configuration is portable, the machine decides (rule 5).

### Migration 9 → 10 (`v9ToV10`)

Pure (no machine in it):

```
for each agent a of agents.team:
  a.tracker = a.permission === 'worktree' ? 'none'
            : (agents.tools.vcsCli || agents.tools.trackerMcp) ? 'read' : 'none'
  a.shell   = a.permission === 'worktree' ? (runner.commands is [] ? 'none' : 'allowlist') : 'none'
runner.sandbox = defaults
schemaVersion = 10
```

Notes it writes: that no agent gained a command or a read; that readers keep the read they had (D1); that the recommended permissions are offered in the team editor. The sentences are English diagnostics, like the other steps.

### Defaults per role (new teams, templates)

In `shared/cycles/templates/agentFlow.ts`, `member()` takes `tracker` and `shell`:

| Agent (agent cycle) | tracker | shell | | Agent (engineering cycle) | tracker | shell |
|---|---|---|---|---|---|---|
| support | none | none | | refiner (Product Owner role) | read | none |
| product-owner | read | none | | planner (Tech Lead role) | read | sandbox |
| tech-lead | read | sandbox | | developer | none | sandbox |
| developer | none | sandbox | | reviewer (Tech Lead role) | read | sandbox |
| qa | none | sandbox | | qa | none | sandbox |
| customer-success | none | none | | | | |

`RECOMMENDED` (`shared/config/team.ts`) is that table by agent id. `recommendations(config, sandbox)` returns, for each agent of the team whose id is in the table and whose values differ, `{ id, tracker?, shell? }` (the shell value is lowered to `allowlist`/`none` when `sandbox` is false). The team editor shows it; nothing applies it by itself.

`mergeTemplateTeam(current, brought, cycle, { sandbox })`: an agent it **adds** with `shell: sandbox` gets `allowlist` (`permission: worktree`) or `none` when `sandbox` is false (default **false**: a caller that does not know the machine gets the safe value). `cycle-core.applyTemplate` and the wizard's `cycleTemplates` result pass the real status (the result gains `sandbox: boolean`; the wizard's `applyTemplate` takes it).

### Who may change what (`configScope.ts`, rule 9)

`WEB_EDITABLE` keeps `agents.team` (a whole array is one path), so a new check `widenedByWeb(before, after)` runs on top of `refusedPaths` and adds `agents.team[<id>].shell` / `.tracker` to the refused list when: an existing agent's `shell` or `tracker` is **raised** (`none < allowlist < sandbox`, `none < read`); or an agent that is new has anything but `none`/`none`. `runner.sandbox` is not in `WEB_EDITABLE`, so it is refused by the existing rule. Pinned in `test/config-web-scope.test.ts`.

`shared/config/transfer.ts`: `collectCommands` adds one entry per agent whose `shell` is not `none` (`agents.team[<id>].shell`, "sandbox: any command" / "allowlist: runner.commands"), and `collectPaths` adds `runner.sandbox.readOnlyPaths[i]`. The import preview shows them.

## 2. The sandbox (`src/main/sandbox/`)

### 2.1 `policy.ts` (pure: no fs, no process)

```ts
interface SandboxSpec {
  worktree: string;               // the real path, also its path inside
  tree: string | null;            // reader: the copy, bound over the worktree path; null: bind the worktree itself
  stageDir: string;               // <data>/sandbox/<id>/: ctl (ro), out (rw), home (rw)
  gitBinds: GitBinds;             // from gitView.ts
  readOnlyPaths: string[];        // expanded, validated
  systemLinks: Record<string,string>; // /bin -> usr/bin etc, from the host
  network: 'off' | 'proxy';       // 'proxy': a loopback port inside, served by the forwarder
  limits: Limits;
}
function bwrapArgs(spec): string[]      // the whole argv, after the program name
function sandboxEnv(spec): Record<string,string>  // what --setenv sets
const SUPERVISOR_SH: string             // written to stageDir/ctl/supervisor.sh
```

The argv, in this order (every flag was exercised on bubblewrap 0.9.0):

```
--unshare-all                  user, ipc, pid, net, uts, cgroup  (no --share-net: ever)
--disable-userns               no nested user namespaces inside
--die-with-parent --new-session --clearenv
--ro-bind /usr /usr   (+ --symlink usr/<x> /<x> for each of /bin /sbin /lib /lib32 /lib64 that is a link on the host, --ro-bind for one that is a folder)
--ro-bind /etc /etc
--proc /proc --dev /dev
--size <tmpMb> --tmpfs /tmp
--bind <stageDir>/home /home/sandbox     HOME; disk-backed so a package cache does not eat memory
--ro-bind <stageDir>/ctl /coxia/ctl      supervisor.sh, cmd.<n>   (the sandbox cannot add commands for itself)
--bind <stageDir>/out /coxia/out         out.<n>
for each readOnlyPath: --ro-bind P P
--bind <tree|worktree> <worktree>        rw
gitBinds: --ro-bind <gitdir-or-file> ..., --ro-bind <sanitised config> <common>/config, --ro-bind <empty dir> <common>/hooks, --ro-bind <wt>/.git <wt>/.git, and --ro-bind for each of .husky .githooks .gitattributes .gitmodules that exists in the worktree
--setenv ...  (PATH HOME TMPDIR LANG TERM CI NO_COLOR GIT_* npm_config_* limits, proxy variables when network is proxy)
--chdir <worktree>
/bin/sh /coxia/ctl/supervisor.sh
```

The argv does not go on the command line: it is written to a pipe (`--args 3`), so `ps` inside the sandbox (pid 1 is `bwrap`) shows no host path. The spawned `bwrap` itself gets an empty environment but `PATH`.

`SUPERVISOR_SH` (POSIX sh, read from the stage folder, so it is a real file and not a quoting problem):

```sh
#!/bin/sh
# one line per command from the app: <id> <token> <seconds>; the command text is the file ctl/cmd.<id>
while IFS=' ' read -r id token secs; do
  [ "$id" = quit ] && exit 0
  (
    cd "$COXIA_WT" || exit 126
    exec prlimit --data="$COXIA_DATA" --nproc="$COXIA_PROCS" --fsize="$COXIA_FSIZE" --core=0 -- \
      timeout -k 3 "$secs" /bin/sh "/coxia/ctl/cmd.$id" >"/coxia/out/out.$id" 2>&1 </dev/null
  ) &
  wait $!
  printf 'done %s %s %s\n' "$id" "$token" "$?"
done
```

Why `prlimit` and not `ulimit`: the system `sh` may be dash, whose `ulimit` takes one resource per call and has no `-u`; `prlimit` (util-linux) is the same on every distribution and sets the hard limit so the command cannot raise it. `RLIMIT_DATA` and not `RLIMIT_AS` (V8 reserves address space it does not use; measured). `timeout -k 3` kills the command's process group; a process the command **backgrounded** (a dev server) is another process group of the same sandbox and stays until the stage ends.

### 2.2 `gitView.ts` (reads the repository)

`gitMounts(worktree, stageDir)` returns the binds of 2.1 and writes into `stageDir`: `.git` is a file (a worktree: `gitdir: <common>/worktrees/<name>`) or a folder (a clone). For the file form it resolves the gitdir and the common dir (`commondir` file), bind-mounts the **whole common dir read-only**, replaces its `config` by the copy produced by `sanitizeGitConfig` (credentials in URLs, `extraheader`, `credential`, `helper`, `token`, `password`, `askpass`, `sshcommand`, `fsmonitor`, `hookspath`, `pager`, `editor`, `gpg.program`, `include`/`includeif` keys removed) and `hooks` by an empty folder; the same for the worktree's own `config.worktree` when there is one. The worktree's `.git` file or folder is bound read-only **over itself**. The sandbox's environment sets `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, and `GIT_CONFIG_COUNT/KEY/VALUE` for `core.fsmonitor=false` and `core.hooksPath=/dev/null`.

### 2.3 `probe.ts`

`probeSandbox(run = realSpawn)` returns `{ available: boolean; backend: 'bwrap' | null; version: string | null; reason: SandboxReason | null; detail: string }` where the reasons are `platform` (not Linux), `no-bwrap`, `refused` (user namespaces refused: the detail carries bwrap's first stderr line), `no-prlimit`, `no-timeout`. It runs one real stage-shaped sandbox (a temp folder as the worktree, no network) executing `prlimit --nproc=64 -- timeout 5 /bin/sh -c 'exit 0'`. Cached 5 minutes; `invalidate()` for the settings' "check again". `sandbox:status` returns the cached result; `sandbox:probe` re-runs.

### 2.4 `session.ts`

```ts
interface SandboxSession {
  exec(command: string, o?: { timeoutMs?: number }): Promise<ExecResult>;  // serial
  readonly log: ExecRecord[];            // every command of the stage, 1-based
  close(): Promise<void>;                // idempotent; kills the group, removes the stage folder
}
interface ExecResult { n: number; command: string; exitCode: number | null; timedOut: boolean; output: string; ms: number; refused?: 'budget' | 'size' | 'empty' | 'closed' }
async function openSession(o: SessionOptions, deps?: { spawn }): Promise<SandboxSession>
```

- Start: make `stageDir` (`0700`, inside `<data>/sandbox/`), write `ctl/supervisor.sh`, spawn `bwrap` **detached** (own process group) with `stdio: ['pipe', 'pipe', 'pipe', 'pipe']` (fd 3 carries the argv), wait for the supervisor to be ready (a first `ready` line).
- `exec`: refuses an empty or over-8 KiB command and a spent stage budget; writes `ctl/cmd.<n>`; writes `n token seconds` to the supervisor's stdin; resolves on `done n token code`; reads the **end** of `out/out.<n>` (the last 6000 characters, `tail()` and `redact()` of `runner/commands.ts`); exit 124 or 137 with a wall time over the limit is `timedOut`. Calls are chained (one at a time).
- `close`: writes `quit`, then `SIGKILL` to the process group (`process.kill(-pid)`), waits for exit, removes the stage folder. Called by the executor in a `finally`, **before** the app runs git. The process also dies with the app (`--die-with-parent`).
- Without a Node program in the sandbox's `PATH` the proxy mode cannot start its forwarder: the session fails to open with `SandboxError('no-node')` (rule 6).

### 2.5 `proxy.ts` (registry mode; rule 6, T4, T5)

In the app: `createRegistryProxy({ hosts, resolve, connect, audit })` listens on a Unix socket `stageDir/ctl/proxy.sock` (`0600`). It accepts only `CONNECT host:443` where `host` is exactly in the list; resolves the name **itself**, refuses when any address is loopback, private (RFC 1918, ULA), link-local, unspecified or multicast (`isPrivateAddress`), connects to **that address**, and pipes. Everything else is `405`/`403`. Caps: 16 concurrent connections, 2 GiB per stage, 60 s idle. Each decision is passed to `audit` (host, allowed or why not).

In the sandbox: the **forwarder**, a short Node program passed with `node -e`, started by the supervisor before it reads commands: it listens on `127.0.0.1:3128` of the sandbox's own loopback and pipes each connection to `/coxia/ctl/proxy.sock`. The environment sets `HTTPS_PROXY`/`HTTP_PROXY`/`https_proxy`/`http_proxy` to `http://127.0.0.1:3128`, `npm_config_proxy`/`npm_config_https_proxy`, `YARN_HTTPS_PROXY`, `NO_PROXY=127.0.0.1,localhost`. `ctl` is bound read-only but a Unix socket can be connected through a read-only bind. A program that ignores the proxy has no route.

### 2.6 `copy.ts` (reader's tree; spec 4.7)

`copyTree(worktree, to, { maxBytes })`: walks the tree without `.git`, sums the file sizes first (refuses above `copyMb`: `SandboxError('copy-too-big')`), then copies with per-file `copyFile(..., COPYFILE_FICLONE)`, symbolic links as links, never following one, skipping the special files. Closing the session removes it (the folder is the app's own).

### 2.7 `tool.ts`, `engineTool.ts`: the `Shell` tool for both engines

One implementation, `runShell(session, input)`: `{ command: string }` in, text out (`renderExec`: the number of the command, the exit code line, the tail). Open engine: a `ToolImpl` named `Shell` handed to `runOpenOnce` as an extra tool (same seam as `VcsRead`). Claude SDK: an in-process MCP server `coxia_sandbox` with the tool `Shell` (`mcp__coxia_sandbox__Shell`), exactly as `vcsMcpServer`. The SDK's own `Bash` stays **off** for an agent whose commands go to the sandbox (it is the unsandboxed path). Both are created per stage; neither knows about mounts or limits (T14).

## 3. Wiring

### 3.1 `agents.ts` and `engine/contract.ts`

`AgentCall` gains `exec?: ShellTool` (what `runShell` needs) and `tracker: 'none' | 'tool' | 'workspace'`; `EngineRequest` gains the same two. Meaning of `tracker`:

| value | who | effect |
|---|---|---|
| `workspace` | ceremonies, and a runner reader with `tracker: read` | what exists today: `allowedFor` MCP and CLI rules, `agentHooks` CLI patterns, `VcsRead` tool when there is no CLI |
| `tool` | an agent that writes with `tracker: read` | only the `VcsRead` tool (with `vcsReady()`), nothing else of the host |
| `none` | any runner agent with `tracker: none` | none of those tools, no CLI patterns |

`toolsOf` is the place that decides, from `agent.permission`, `agent.tracker` and `agent.shell`. `sdkOptions`: `shellOff` also counts `tracker`; `allowedTools` gets the `Shell` name of the engine. `runOpenEngine`: `extraTools` is the list of `VcsRead` and `Shell` that apply. `runClaudeSdk`: `mcpServers` merges `coxia_vcs` and `coxia_sandbox`. Mentions and chain calls: `tracker` of the agent (reader), no `exec`.

`AgentDef.shell === 'allowlist'` stays the existing path (`confine.hooks`, `commands`); `none` for an agent that writes gives it no commands (`confinedHooks({ commands: [] })`, which exists).

### 3.2 `runner/executor.ts`

```
shell   = agent.shell
need    = shell === 'sandbox'
session = need ? await deps.sandbox.open({ worktree, config, signal, reader: !writes }) : null   // StageError('no-sandbox') when unavailable
try {
  ran    = QA && shell !== 'allowlist': runCommands(.., session ? sessionRunner(session) : app runner)   // inside the sandbox when there is one
  agent call with exec = session ? shellTool(session, report) : undefined
} finally { await session?.close() }                  // BEFORE artifacts are written and the commit is made
```

`report` is the one place a command is told to the world: `forum.append(system 'runner.exec' {agent, n, command, exit, ms, tail})`, `activity.tool("exit N in 1.2s")` after the engine's own line for the call, and `recordWrite({ kind: 'exec', ... by: agent, issue, target: command, via: 'sandbox', code, result: tail })` to the audit log. The pre-run commands of QA are reported the same way, numbered first.

`commands` for an agent that writes: `shell === 'allowlist'` ? the list as today : `[]`. For an agent that only reads: `[]` as today.

A new `StageError` code `no-sandbox` (`main.runner.error.no-sandbox`): "The agent {agent} is set to run commands in a sandbox, and this computer cannot make one ({reason}). Choose "allowlist" or "none" for it in the team editor." `Runner.start` runs a **preflight** over the agents of the flow and refuses with the same text before making a worktree.

### 3.3 QA evidence

`Scenario` gains `evidence?: 'executed' | 'read'`, `unbacked?: boolean` and `commands?: number[]` (the numbers it cites). `outputSchema(kind, { evidence: true })` (asked only of a QA agent with `shell: sandbox`) adds `evidence` and `commands` to the scenario. `readScenario` reads them; `backEvidence(scenarios, log, asked)` (pure, in `shared/runs/output.ts`) returns the scenarios with the claim checked (rule 11) and, when evidence was not asked, every scenario `read`. The service applies it in `settle` before `recordQa`; the QA comment gets a section "what was executed" (n of m, and the claims nothing backed; `main.runner.scenario.evidence*`, only for a QA agent with a sandbox). The run file schema gains the three optional fields (no `RUN_VERSION` change: absent reads as before) and `QaCommand` gains `n` and `by: 'app' | 'agent'`. The run view labels the three states.

### 3.4 Prompts (catalog keys, both languages)

New keys only, so no existing text changes: `prompt.sdd.runner.rules.shell` (what `Shell` is: a sandbox with no network, which folder is yours, that a started process stays until the stage ends, that nothing else can run), `prompt.sdd.runner.output.evidence` (how to fill `evidence` and `commands`), `prompt.sdd.runner.rules.shellReader` (a reader works in a throwaway copy), `prompt.sdd.runner.rules.shell.registry` (the registry window). There is **no** text for the tracker: the tools carry their own descriptions, and a reader's prompt must not change. They are added to `systemText`/`stagePrompt` **only** for an agent that has the capability, so a workspace that does not use the fields sends the same text as before (the goldens do not move).

## 4. Hardening the app's own reads (T8, T9)

`readFolder` (`runner/cycleFolder.ts`) now `lstat`s each name and reads only regular files that `checkPath(..., { read: true })` accepts; a link is skipped. `readArtifact` already goes through `checkPath`. A test plants a link to a file outside the worktree and checks it never reaches a prompt.

## 5. Screens

- `team/TeamSection.tsx`, `agentEdit.ts`, `labels.ts`: two `<select>`s with hints; `allowlist` only when `permission` is `worktree`; `sandbox` only when `sandbox:status` is available (else a line with the reason and the way out); the list of agents shows both. `AgentDraft`, `draftOf`, `blankAgent`, `applyAgent` carry the two fields (a new agent: the pure default of `newAgent`).
- `team/Recommended.tsx` (new): the panel of spec 4.2 from `recommendations()`; hidden when `isWeb()`.
- `team/RunnerSection.tsx`, `runnerEdit.ts`: the sandbox block (network, hosts, folders, limits) with the checks of the validator; shown read-only in a paired browser (`runnerOfWeb` keeps the stored one). A "check the sandbox" button calls `sandbox:probe`.
- `cycle/ReviewRounds.tsx`: the evidence per scenario.
- `Auditoria.tsx` (+ `AuditKind` gets `'exec'`): a row per command.
- IPC: `sandbox:status`, `sandbox:probe` (reads: open to a paired browser, which is where the editor needs the status to hide the option), declared in `apiChannels.ts`.

## 6. Tests (no network, no model)

| File | What |
|---|---|
| `test/sandbox-policy.test.ts` | the argv: order, binds, no `--share-net`, `--clearenv`, nothing of `$HOME`, `.git` ro on itself, ro paths, system links as links, limits in the env, proxy mode adds the variables, the read-only path validator, `sanitizeGitConfig` |
| `test/sandbox-git.test.ts` | `gitMounts` over a real temp repository and a real `git worktree` (no sandbox): what is bound, the sanitised config has no credential |
| `test/sandbox-session.test.ts` | the session with a **fake spawn** that speaks the supervisor's protocol: serial calls, tokens, timeouts, budget, size refusal, close kills the group and removes the folder |
| `test/sandbox-proxy.test.ts` | the proxy over a Unix socket with a local fake upstream: allowed host, other host, other port, non-CONNECT, private address (resolved), caps |
| `test/sandbox-copy.test.ts` | the copy: skips `.git`, keeps links as links, refuses over the limit |
| `test/sandbox-bwrap.test.ts` | **really runs `bwrap`**, only if it exists and the probe says it works, with harmless commands in a temp folder: a write outside the worktree fails, `$HOME` is not the real one and holds nothing, an app variable is absent, `.git` cannot be changed, a process started in one command is visible to the next and gone after `close`, no network interface but `lo`. No network use. |
| `test/agent-permissions-config.test.ts` | the migration (every row of spec 4.5), the validator, the defaults of both templates, `recommendations`, `mergeTemplateTeam` lowering |
| `test/config-web-scope.test.ts` (extended) | raising refused, lowering allowed, a new agent only `none`/`none`, `runner.sandbox` refused |
| `test/runner-sandbox.test.ts` | the executor with a fake sandbox: the session is opened for `sandbox` agents only, closed before the commit, the pre-run commands go through it, the thread/audit/activity lines, `no-sandbox` fails the stage and `start` refuses, QA evidence backed/unbacked/not asked |
| `test/runner-tracker.test.ts` | what `tracker` gives each kind of agent (the table of 3.1) on both engines; mentions keep a read and get no shell |
| `test/engine-shell-tool.test.ts` | the `Shell` tool on the open engine against a scripted model, and as an SDK MCP tool |
| `test/runner-cyclefolder-links.test.ts` | the link case of section 4 |
| the existing ones | `runner-golden`, `gitlab-catalogs-unchanged`, `host-terms-leak`, `ui-i18n`, `config-schema` stay green; the helper builds its teams with `sandbox: false` so they describe the behavior without it |

## 7. Risks

- **The test helper** builds its teams with `applyTemplate`; with the new defaults the engineering team would be `sandbox`. It is changed to ask for `sandbox: false`, so the golden scenarios still pin the cycle without a sandbox; the new tests cover the other.
- **Ubuntu's restriction of unprivileged user namespaces** (AppArmor) can make `bwrap` fail with "operation not permitted" on a machine that has it installed. The probe reports `refused` with bwrap's own message, and the docs say what to allow. Here it works.
- **`prlimit`, `timeout`, `node`** must exist inside the sandbox (`/usr` is the host's). The probe checks the first two; `node` is checked only in registry mode.
- **`RLIMIT_NPROC` semantics** are per user namespace only since Linux 5.14. On an older kernel the limit counts the user's processes and may refuse forks immediately: the probe's own `--nproc=64` run would then fail, and the sandbox is reported unavailable (`refused`).
- **Output size**: a command that prints a lot is bounded by `RLIMIT_FSIZE` on its output file; the app reads only the tail.
- **Exposure that is promised, not enforced** is listed in the spec's section 5.3 ("Kind" column); the docs repeat it.

## 8. Decision log

| # | Decision | Why |
|---|---|---|
| P1 | **bubblewrap**, Linux only; Docker not built; macOS/Windows: `none`/`allowlist` | spec section 3 |
| P2 | One **long-lived sandbox per stage** with a supervisor, not one `bwrap` per command | a dev server and its `localhost` must survive between commands, and the stage's end must kill it; a per-command sandbox cannot share a loopback. Measured: processes started in one command stay for the next, `timeout` ends a hung one, killing the group ends everything |
| P3 | Commands cross by **files and a line**, not by a shell string on stdin | no quoting problem, the model's text is never parsed by the app, the command folder is read-only inside (the sandbox cannot add commands for itself) |
| P4 | **`prlimit`** inside, not `ulimit` or `systemd-run` | portable across `sh`s and distributions; cgroups need privileges the app does not have |
| P5 | `RLIMIT_DATA` for memory | V8's reservations make `RLIMIT_AS` unusable; measured: `--data=2 GiB` runs Node, allocation past it fails cleanly |
| P6 | `--ro-bind /etc`, system dirs by allow-list, **no `/home`, `/run`, `/var`** | the home must not exist; `/run` holds the agent sockets and the container daemon's socket |
| P7 | **Registry mode through a proxy in the app and a forwarder in the sandbox**, not `--share-net` | `bwrap` cannot filter by host; shared network is T4 reopened. The price is Node inside the sandbox (D4); without it the mode refuses to start |
| P8 | Reader's sandbox works in a **copy** | readers' promise is "do not change files"; the copy makes a test run or an install harmless to the branch, and the app keeps committing only what it knows (D3). `bwrap` 0.9 has no overlay option, so the copy is real |
| P9 | The **`VcsRead` tool** for an agent that writes, never the CLI or MCP | the CLI needs the person's credentials in a process that runs repository code; the tool keeps the token in the app (T3) |
| P10 | The sandbox closes **before** the app's first git command of the stage | no sandbox process can race the commit (T13) |
| P11 | `tracker` and `shell` live on the agent, `runner.sandbox` on the runner | who may do it is per agent; what the sandbox may reach and how much it may use is per workspace and desktop-only |
| P12 | No `RUN_VERSION` change for the run file | the new scenario fields are optional; an old file reads as before |
| P13 | Fail closed everywhere the sandbox is missing | rule 5; a silent fallback would be the unsandboxed path the feature exists to avoid |
| P14 | Network proxy and forwarder in the **same change** | shipping only the on/off switch would make "on" mean "everything"; the honest fallback of the issue (fully on) is rejected unless the forwarder proves unworkable (D4) |
| P15 | The maintainer's review of the spec: **D1** a reader keeps the code host read it has today, **D2** `allowlist` only for agents that write, **D3** a reader with a sandbox works in a throwaway copy, **D4** registry mode needs `node` inside the sandbox, **D5** the proposed limit defaults, **D6** the unconfined-reader gap is a separate issue, **D7** Docker later | approved by the maintainer on 2026-10-03, each as the spec recommends it |
| P16 | **B1.** What the app reads back of a command's output (`out/out.N`) is opened `O_NOFOLLOW|O_NONBLOCK` and checked with `fstat` on the descriptor; a link, a pipe or anything but a plain file gives "output unavailable" and no read. The supervisor opens the output file *inside* the timed command, so a pipe planted there ends by the time limit instead of blocking the stage | security review of #30: the folder is writable by the sandbox, so a path there is what a hostile command put there. Test: `test/sandbox-hardening.test.ts` (unit and real `bwrap`) |
| P17 | **B2.** `.git` and each of `.husky`, `.githooks`, `.gitattributes`, `.gitmodules` are `lstat`ed: a link **refuses** the sandbox (`SandboxError('hostile-link')`), a pipe or socket is not bound; `assertBindsSafe` checks every bind once more (no link inside the worktree or the copy on either side, a path outside it is its own real path) | bwrap follows links on source and destination, so `.husky -> ../..` mounted a folder of this computer; a link there is a hostile signal, and refusing is safer than guessing |
| P18 | **S1–S3.** `/dev` read-only with a size-capped `/dev/shm`; the proxy takes its tunnel slot before the name lookup and holds at most 64 bare client sockets; `isPrivateAddress` uses two `BlockList`s (IPv4 and IPv6, never mixed) with the mapped, compatible, NAT64, 6to4, Teredo, documentation and site-local ranges | review findings; the lists are mixed-up-proof because an IPv4 address matches an IPv6 rule as its mapped form |
| P19 | **S4, S5.** `issue_linked_mrs` is a `VcsRead` operation; `VcsRead` refuses a project that is not the issue project or a repository's project (same identity as the cards; no limit for the ceremonies when the workspace names none, as for the cards) | spec §2.1 promised the first; the second keeps a prompt-injected agent from reading any project the token can see |
| P20 | **S6, N8.** A browser may not give an agent with commands the `worktree` permission; `sandbox:probe` is desktop-only | the copy-to-worktree jump is a raise; the probe starts a process |
| P21 | **N6.** The reader's copy is made by `cp -a --reflink=auto` in a child, after a size walk that yields; links are kept as links | the walk and copy were synchronous on the main thread |
| P22 | **N7, N9.** A template file's check lists the agents it brings with powers; a listed read-only folder that holds a repository is said in the settings text and in the run's thread | the threat was a template or a folder handing over more than its name says |
| P23 | **S5, decided by the maintainer's session.** For a team agent of a run, an empty list of allowed projects means **refuse**: no code host read through the tool, and the message says to configure the issue project or the repositories. The ceremonies are unchanged. The two are told apart by `EngineRequest.tracker` being set (only `runAgent` sets it) | a run always has an issue project; a workspace without one has nothing to scope an agent's read to, and an agent that reads a prompt-injected issue should not be able to read every project a token sees |
| P24 | **Second review, 1.** `removeTree` (best effort, folders made writable first, links never followed, never throws) is used by `close()`, by the `catch` of `open()` and by `purge()`; the executor's `finally` swallows a failed close | a Go module cache left read-only made `close()` throw and leak the stage folder, and turned a finished stage into a failure |
| P25 | **Second review, 2 and N5.** `open()` mounts everything by its **real path**: the worktree and the data folder are `realpath`ed first; `assertBindsSafe` also requires the main bind to be a real folder at its own real path | a data folder under `/home -> /var/home` made every sandbox fail on the real-path rule |
| P26 | **Second review, 3 (decision).** Every runner agent with `tracker: read` gets the `VcsRead` tool and nothing else of the host (`trackerOf` returns `tool`); the host CLI and the tracker MCP stay for the ceremonies only. The tool needs `agents.tools.vcsCli` or `trackerMcp` on | the CLI is not limited by project and brings credentials next to repository code; the tool is the one path the app limits, so T17 holds for every runner read |
| P27 | **Second review, 4.** `origin/main` (0.4.2: send back, `linkDependencies`, login `PATH`, not-run commands) is **merged** into the branch. Dependencies the runner links are made before the sandbox opens and shared read-only at the link's own path when their real path is inside the clone and not inside the worktree; otherwise left dangling with a thread note | the sandbox cannot see the clone, so the links would dangle; sharing a folder named by a link is only safe when the app can tell where it leads |
| P28 | **N1–N4, N6.** A `.git` pointer is trusted only if `<gitdir>/gitdir` is this worktree's real `.git` and the common directory has `HEAD`; submodule configs under `modules/` are cleaned; a copy fails as one error with no path and stops on abort; linked merge requests are filtered by project; a browser may lower `shell` only to `none`; only the agent's own commands back an `executed` claim | review nits |
