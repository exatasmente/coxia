---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [CONTRIBUTING.md:102-113, src/main/vcs/types.ts, src/main/vcs/github.ts, src/main/vcs/validate.ts, src/main/vcs/runtime.ts, src/main/vcs/probe.ts, src/shared/config/types.ts:1-60, test/vcs-github.test.ts]
summary: The steps to add a code host to the neutral provider interface
stages: [development]
roles: [developer, tech-lead]
---

# Add a code host

Everything the app reads from or writes to a code host goes through the neutral interface in
`src/main/vcs/`. A new host (Gitea, Azure DevOps, ...) means:

1. **Declare the kind** in `VCS_KINDS` (`src/shared/config/types.ts`). The configuration's JSON
   Schema is derived from it; `test/config-schema.test.ts` fails if types, schema and defaults
   drift apart.
2. **Implement `VcsProvider`** (`src/main/vcs/types.ts`) in `src/main/vcs/<kind>.ts`, following
   `github.ts` or `bitbucket.ts`: authenticated user, issues, merge or pull requests, threads,
   changes, CI and approvals mapped to the neutral shapes. A provider only **reads** and
   **describes** writes (`planWrite`); it never writes by itself.
3. **Validate and execute writes** in `validate.ts` (a strict list of the shapes accepted;
   anything else is refused before it is stored) and `exec.ts`. Only `runtime.ts` imports the
   executors and only `actions.ts` calls them; `test/vcs-writes.test.ts` fails if that changes.
4. **Wire it in:** `runtime.ts` (`buildRuntime`), `probe.ts` (the wizard's "Test" button, which
   reports the token's permissions), `stages.ts` (the default stage mapping) and `readPolicy.ts`
   (what an agent may read; if there is no CLI, expose the `VcsRead` tool).
5. **Test against a fake host** (`test/helpers/fakeHost.ts`, `test/fixtures/vcs/`), modelled on
   the official API documentation: reads, pagination, errors (`auth`, `forbidden`,
   `rate_limited`, ...), the validators' refusals and the probe. `test/vcs-github.test.ts` is
   the model.
6. **Wizard and strings:** the integration step and its texts in both catalogs
   (`rules/i18n.md`).
7. **Document** the token permissions and what is not verified in `docs/vcs-providers.md`, and
   say honestly if you could only test against a fake.

Do not let a test reach a real host (`rules/build-and-test.md`). Consistent with a new read
path, the guard tests (`test/shell-allowlist.test.ts`, `test/vcs-read-policy.test.ts`) check the
allowed commands, so update `readPolicy.ts` to match.
