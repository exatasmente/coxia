# Plan: a test environment per workspace, delivered to allowed stages

Implements `1_SPEC.md` (issue 170). Everything below was checked against the code as it is today; nothing here has been implemented yet.

## 1. The pieces of today this builds on (read, not changed)

- Secrets store (`src/main/secrets-core.ts`): refs matching `SECRET_REF` (`src/shared/secrets.ts`), sources `stored`/`command`/`env`, resolution only in the main process, `SecretError` with codes. Values are returned only by `resolve()`.
- Sandbox (`src/main/sandbox/index.ts`, `session.ts`, `host.ts`, `policy.ts`, `proxy.ts`): a sandbox session builds the command environment internally; a host session starts from the app environment passed through `scrubbedEnv` (which drops credential-looking names, `src/main/engine/guard.ts`). Registry mode builds `createRegistryProxy` with `hosts: opts.config.registryHosts` and refuses any private/loopback address via `isPrivateAddress` (`proxy.ts`), with no opt-out path.
- The launcher point: `openStageSandbox` (`src/main/runner/executor.ts:311`) calls `d.sandbox.open(...)` or `d.sandbox.openHost(...)` with `config.runner.sandbox`; a stage that asks for QA display is told by `outputKindOf(stage.kind) === 'qa'`.
- Config: `WorkspaceConfig` (`src/shared/config/types.ts`), `CONFIG_SCHEMA_VERSION = 20`, migration `STEPS` in `src/shared/config/migrations.ts`, validation in `src/shared/config/validate.ts`, defaults in `defaults.ts`. Per the platform rule, a config change needs the migration step and the three of `types.ts`, `defaults.ts` and `validate.ts`.
- Masking precedent: plugin requests mask the secret in raw, URL-encoded and JSON-escaped forms, longest first, then run pattern-based `redact` after it (`src/main/plugins/requests.ts:213-215`).
- Trace sinks: the run conversation (`forum.ts`/`forum-core.ts`), the audit log (`auditoria.ts` `recordWrite`), command reporting in `openStageSandbox`, run/stage documents (`runner/cycleFolder.ts`) and the Actions door (`actions.ts`) for commits and pull requests.

## 2. Changes, in order

### 2.1 Config schema and migration (shared config)

- `types.ts`: add to the workspace runner block:
  ```ts
  export interface TestEnvVariable { name: string; value: string; hosts?: string[]; privateHosts?: string[]; }
  export interface TestEnvSecret { ref: string; testOnly: boolean; hosts?: string[]; privateHosts?: string[]; }
  export interface TestEnvironment { variables: TestEnvVariable[]; secrets: TestEnvSecret[]; }
  ```
  `WorkspaceConfig` gains `testEnvironment?: TestEnvironment`.
  `StageDef` gains `testEnv?: boolean` (left out reads as: `kind === 'qa'` for a stage created by this version's editor; read as `false` for every stage carried by an already-saved template, as the spec requires).
- Validation: variable names held to `ENV_NAME`; secret refs held to `SECRET_REF` plus the required `test.` prefix; hosts normalized the way the proxy reads them (exact lowercase names); `privateHosts` must be a subset of `hosts`; a duplicate name/ref is a problem. No resolved value can ever exist here — the type has nowhere for one.
- `defaults.ts`: default `testEnvironment: { variables: [], secrets: [] }`.
- `migrations.ts`: add `v20ToV21`, bump `CONFIG_SCHEMA_VERSION` to 21; the step fills the empty section in and nothing else (no stage field is defaulted by migration — a template saved before this change stays "left out = false").
- Export/audit: the config export path gets a test asserting it carries the variable values and secret references only, never a resolved value and never the confirmation ledger.

### 2.2 Test secret prefix in the store

- Convention `test.<name>` for refs of the test environment (the store's `SECRET_REF` has no colon, so a dot prefix); enforced in validation and grouped in the Settings UI.
- `secrets-core.ts` gets no store change; group deletion is a Settings action that lists and removes every ref with the prefix — one call each through the existing `remove()`, so managing and deleting test secrets as a group need no store code.

### 2.3 Resolver and launcher injection (new module `src/main/testEnv.ts`)

- `resolveStageTestEnv(config, stage, secrets)` →
  `{ vars: Record<name, value>, forms: string[], hosts: string[], privateHosts: string[], entries: TestEnvEntry[], refusals: {name, reason}[] }`.
  - Runs only when the stage allows it: `stage.testEnv === true`, or (`testEnv` left out) `kind === 'qa'` as defined in 2.1. A workspace without a `testEnvironment` section, or an empty list, returns nothing — behavior exactly as today.
  - Variables: name/value straight into `vars`.
  - Secrets: `secrets.resolve(ref)` in a try/catch; a `SecretError` becomes a refusal entry and the entry is dropped from what is injected, never a crash. Called with the stage's audit context so each refusal is recorded in the audit log and named to the person (spec rule 11).
  - `forms`: for every resolved value, the four forms the plugin precedent uses (raw, URL-encoded, JSON-escaped, and any formatted value) filtered to length ≥ 4, longest first.
  - Confirmation: a secret with `testOnly: false` needs its ref in the confirmation ledger (2.7); an unconfirmed one puts the stage in the ask-a-person state, not merely missing.
- `src/main/runner/executor.ts`, in `openStageSandbox`: build the resolution once per stage launch:
  - sandbox branch: pass `testEnv: { vars, hosts, privateHosts }` into `OpenOptions`; when the list is non-empty, the stage's config becomes `{ ...config.runner.sandbox, network: 'registry', registryHosts: [...config.runner.sandbox.registryHosts, ...hosts] }` — entries without declared hosts add nothing.
  - host branch: pass the same into `HostOpenOptions` (the host has no proxy; the network list matters to a sandbox shell only).
  - Report every refusal through the existing forum append and `recordWrite` paths.

### 2.4 Sandbox and host session environment (`src/main/sandbox/session.ts`, `host.ts`)

- The sandbox session's environment assembly gains the injected vars, applied after every other environment decision (a sandbox starts from an empty environment; nothing can wash them out there).
- Host: `scrubbedEnv` keeps dropping credential-looking names from the inherited app environment; the test vars are then merged on top, in `HostSessionOptions.env()`'s caller. So a person's real key is never reintroduced under a test's variable name, and no test name is lost to the scrub.
- Host stage testing Coxia (spec rule 9): when the stage carries a test environment and the agent's shell is host, the launcher, not the agent,
  - sets `CERIMONIAS_DATA_DIR` and `CERIMONIAS_SPECS_DIR` to fresh empty folders under the session's own output folder, after deleting any inherited value of those two names first (so a value in the person's environment cannot redirect the tested app to the real data); the folders are removed by the session's `close()`;
  - leaves the person's real `secrets.json` out of the tested app's reach in the only way a host shell offers: the tested Coxia starts against the fresh folders and no variable ever carries a real secret to it. Stronger file confinement of the host shell is out of scope per `1_SPEC.md`.
  - Other apps under test on the host simply ignore those variables; no harm.

### 2.5 Registry proxy: declared hosts and opt-in private addresses (`src/main/sandbox/proxy.ts`)

- `ProxyOptions` gains `privateHosts?: string[]`.
- Decision rule becomes: name not in `hosts` → refused; port ≠ 443 → refused; name in `privateHosts` → allowed even when its resolved address is private (connect to the address the resolver gave); otherwise an address failing `isPrivateAddress` stays refused with `why: 'address'`.
- The registry-mode override only exists when the stage actually receives a test environment (enforced by 2.3); stages without one keep the workspace's own network setting byte for byte.

### 2.6 Exact-value masking wherever stage text is kept or shown (new module `src/main/maskExact.ts`)

- `maskExact(forms, text)` replaces every form with the same `[secret]` token plugin requests use, then calls the existing `redact` (two layers, spec rule 7). Pure, testable alone.
- Attach points (each covered by a test):
  - command reporting, `executor.ts` `report()`: apply the stage's masker to `command` and `output` before the forum append and `recordWrite` (the existing `redact` becomes the second layer);
  - the conversation: the executor's forum appends of that stage feed already-masked text;
  - run file, stage documents and executed-evidence text: the masker is threaded into the document writers the stage uses (the writer layer of `runner/cycleFolder.ts` takes it as an argument).
- A stage without a test environment gets no masker: behavior identical to today.
- Concurrency: the masker is a per-stage object created in `openStageSandbox`, never a process-wide one — runs run concurrently.

### 2.7 Confirmation for non-test-only secrets, refusals with a reason

- Approval ledger: a JSON file in the workspace's own data folder (never the config, never exported); entries are ref, timestamp, stage that asked. It never carries a value.
- Launch gate: when a resolved entry is non-test-only and unconfirmed, the run does not start the work stage; it raises the ask-a-person mechanism the plugin network/write asks already use (the card shows the entry, its declared hosts and the receiving stages; approve/reject). Approve → ledger entry and `recordWrite` before anything changes; refuse → the stage launches without that entry, refusal reported to the person and in the audit log.
- Confirmation is never delegated to the agent; the asking is the runner's doing.

### 2.8 Commits, pull requests and images refused with a reason (`src/main/actions.ts`)

- Every write going out through the Actions door from a stage that carried a test environment is scanned for the stage's `forms` before a commit or a pull request body is allowed: an exact hit refuses with a reason naming what was found, the same shape the door already uses for its content/pattern refusals. The same scan covers the commit message and the pull request title.
- Images: a screenshot or image file that would be attached to anything leaving the computer (an issue comment, a pull request attachment) is refused with the reason "images are not redacted"; local viewing, in the paired browser, stays allowed.
- Stage prompt: `runner/prompt.ts` adds a sentence for an environment-carrying stage — that the stage carries entries, that exact values are masked in stored text, that screenshots cannot be masked and will not leave the computer. Both i18n catalogs.

### 2.9 Renderer: the test environment editor

- Settings gains a Test-environment section: variables (name, value, hosts, privateHosts) and secrets (ref shown with its `test.` prefix, testOnly toggle, hosts, privateHosts), plus the group-delete bound to 2.2.
- A stored secret never shows a resolved value; only an availability check the store already offers (`check()`).
- The confirmation flow renders in the ask-the-person card view the plugin asks already use; the screen changes there are data-driven (the entry list the run hands over), not a new setting screen.

## 3. Tests (one per behavior; the file names)

- `test/testEnv-schema.test.ts` — validation (names, prefix, subset of private hosts, duplicates); migration 20→21 preserves everything and fills the empty section; export carries no resolved value.
- `test/testEnv-resolve.test.ts` — resolution merge; refusals reported and the entry dropped; a missing ref never throws; the confirmation gate open/close; a stage that does not allow the environment resolves nothing.
- `test/sandbox-session.test.ts` (extension) — a sandbox session's commands see the injected variables; a stage without them starts from the empty environment as today.
- `test/sandbox-host.test.ts` (new or extension) — test vars survive `scrubbedEnv`; a test-env-carrying host stage starts against fresh empty data folders, any inherited data-folder variables are removed first, folders are cleaned on close.
- `test/sandbox-proxy.test.ts` (extension) — declared host allowed; undeclared refused; private-address declared host without the private mark refused with `address`; marked → allowed; 443 only.
- `test/maskExact.test.ts` — every form (raw, URL-encoded, JSON-escaped), single and combined, longest first; `redact` still runs after; short values filtered.
- `test/runner-sandbox.test.ts` (extension) — a stage that does not allow the environment behaves exactly as before; QA default on for stages created by this version, off for template stages without the field.
- `test/actions-testEnv.test.ts` — a commit carrying an exact form refused with a reason; a PR body carrying one refused; an image attach refused; the same shapes pass without a test environment.
- i18n: every new key in `pt-BR` and `en`; the store and theme gates (`npm run i18n:lint`, `node scripts/theme-audit.mjs`) cover the two screens' strings and tokens.

## 4. Acceptance criteria of `1_SPEC.md`, mapped

1 → 2.1 tests and 2.2; 2, 3 → 2.3/2.5 and the sandbox/proxy tests; 4 → 2.6 maskExact tests and the executor/forum/document attach points; 5 → 2.8; 6 → 2.8 image rule, local view unchanged (sessions already read images locally); 7 → 2.3/2.4 and a real-key scenario — not verified here, it belongs to a machine with real integrations and is not part of this repository's test suite; 8 → the resolver/runner tests; 9 → the 2.7 gate and audit; 10 → the resolver's refusal path. The per-repository overlay ships after this change, as the spec sequences it; not covered by these tests and to be designed on its own.

## 5. Risks and how they are held

- A mask set computed for one stage seeping into another stage's text: the masker is a per-stage object created in `openStageSandbox`, never process-wide.
- A person's real credential riding into a host stage inside an inherited variable: `scrubbedEnv` runs before the injection merge, so the scrub can never drop a test name and no real ever rides under one.
- A declared host widening a sandbox that had no network: the registry-mode override exists only when the stage actually receives entries; the allow-list is the workspace's list plus the declared ones, and `privateHosts` is a validated subset of `hosts`.
- Confirmation separating from the audit: the approve handler calls `recordWrite` before the ledger flips.
- A refusal swallowed as a crash: the resolver never throws for a secret problem; it reports a named refusal and drops the entry, and the stage cannot enter an unclear state.

## 6. Decisions and why

- **Prefix `test.` (not `test:`)**: `SECRET_REF` allows `[a-z0-9._-]` and no colon; a dot prefix keeps every test ref valid for the existing store without touching it.
- **Registry allow-list = workspace list ∪ declared hosts**: matches spec rule 5 ("starts from the hosts the person declared") and keeps the person's package hosts working on the same stage.
- **Injection after the scrub** on the host: simpler than teaching the scrub about test names, and strictly safer in the one order that can leak.
- **Approval ledger in the data folder, not the config**: the config is exported and shared; approval is a per-computer decision about live keys, like the store's insecure-accept flag.
- **Reusing the plugin-ask plumbing for the confirmation screen**: the run must stop for a person instead of crashing or launching silently short of a credential, and that mechanism already exists and is audit-backed.
