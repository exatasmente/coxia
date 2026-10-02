# Contributing to Coxia

Thanks for wanting to help. Coxia is a small project with one maintainer, so a short conversation before a big change saves everybody time: open an issue describing what you want to do, or comment on an existing one. Small fixes can go straight to a pull request.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, do **not** open an issue: follow [`SECURITY.md`](SECURITY.md).

## Contents

- [License of contributions](#license-of-contributions)
- [Development setup](#development-setup)
- [Scripts](#scripts)
- [Tests](#tests)
- [Code and interface rules](#code-and-interface-rules)
- [Commits, branches and pull requests](#commits-branches-and-pull-requests)
- [How to add a VCS provider](#how-to-add-a-vcs-provider)
- [How to add a development-cycle template](#how-to-add-a-development-cycle-template)
- [How to add a model provider](#how-to-add-a-model-provider)
- [Documentation](#documentation)

## License of contributions

Coxia is licensed under the [Apache License 2.0](LICENSE). Unless you state otherwise, a contribution you submit is licensed under the same terms (section 5 of the license). Do not submit code you do not have the right to license this way, and do not add a dependency without checking its license: `node scripts/third-party-notices.mjs` flags anything that is not permissive.

## Development setup

You need the Node.js version in [`.nvmrc`](.nvmrc) and a Linux or macOS machine. Python 3 and [uv](https://docs.astral.sh/uv/) are needed only to work on the voice sidecar.

```bash
nvm use                 # the version in .nvmrc
npm ci
npm run dev             # Electron with hot reload
```

To work with a throwaway copy of the app's data, so your real workspaces stay untouched, point `CERIMONIAS_DATA_DIR` (and `CERIMONIAS_SPECS_DIR`) to an empty folder before starting. Only one instance of the app runs at a time: close an installed copy before running the development one.

The Claude engine needs the Claude Agent SDK, which is a regular dependency in development (`npm install` brings it in) and is left out of the public packages. You do not need a model or an account to run the tests or to work on most of the app: the open engine can talk to a local server such as Ollama (see [`docs/llm-providers.md`](docs/llm-providers.md)).

Optional voice, from source:

```bash
uv venv --python 3.12 sidecar/.venv
uv pip install --python sidecar/.venv/bin/python -r sidecar/requirements.txt
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Electron with hot reload |
| `npm run build` | Builds main, preload and renderer into `out/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | The whole test suite (`vitest run`); `npx vitest run test/<file>.test.ts` for one file |
| `node scripts/theme-audit.mjs` | Counts literal colors per file and checks the contrast of the theme tokens |
| `npm run i18n:lint` | Checks that the `pt-BR` and `en` catalogs define the same keys |
| `node scripts/i18n-lint.mjs` | Lists user-facing literal strings that do not go through `t()` |
| `node scripts/third-party-notices.mjs` | Regenerates `THIRD_PARTY_NOTICES.md` (run after changing dependencies; `--check` verifies it) |
| `npm run dist` | Your own package, with the Claude Agent SDK inside (do not redistribute it) |
| `npm run dist:public` | The public package, without the SDK: what the releases contain ([`RELEASING.md`](RELEASING.md)) |

CI runs the typecheck, the tests, the theme audit, the i18n lint and the build for every pull request. Run the same before you push.

## Tests

- Every behavior change comes with a test in `test/`. The suite is Vitest, in Node.
- **No test may call a real model, a real code host or the real network.** The helpers in `test/helpers/` fake them: `fakeOpenAI.ts` (an OpenAI-compatible server with SSE, tool calls and provider-specific errors), `fakeHost.ts` and `vcs.ts` (code hosts), `fakeMcp.mjs`, `conflictRepos.ts` and others. Fixtures live in `test/fixtures/`.
- `test/setup.ts` gives every test file its own temporary data folder. Never point a test at your real data or at the specs folder.
- Prefer testing the pure `*-core.ts` modules and `src/shared/` over the Electron shell; that is why those modules exist.
- Never put a real token, key, host name, person or issue number in a test, fixture or snapshot.

```bash
npx vitest run > .runlogs-test.log 2>&1   # the whole suite, with the output in a file
npx vitest run test/vcs-github.test.ts     # one file
```

## Code and interface rules

- **TypeScript, strict.** No `any` without a reason. Keep Electron-free logic in `*-core.ts` or `src/shared/` so it can be tested without the app.
- **Every user-facing string goes through `t()`** (`useT()` in the renderer), with the key defined in **both** `src/shared/i18n/pt-BR.json` and `src/shared/i18n/en.json` (the wizard has its own pair, `wizard.pt-BR.json` and `wizard.en.json`). Keys are flat, keep the same placeholders in both languages, and a missing key falls back to pt-BR and then to the key itself, so a gap is visible on screen. Text the agents receive is in the catalogs as well (`prompt.<family>.<id>`). Strings that mention a "call" need a `.novoice` variant for when voice is off ([`docs/voice.md`](docs/voice.md)). Details in [`docs/i18n.md`](docs/i18n.md).
- **Theme tokens, not colors.** In the renderer use the CSS custom properties defined in the `:root` token blocks; never a literal `#hex`, `rgb()` or `hsl()` in a component or stylesheet. `node scripts/theme-audit.mjs` counts the literals and checks contrast in the light and dark themes. Check both themes when you touch the UI.
- **Code, tests, identifiers and commit messages are in English.** Documentation for people can be in English or Portuguese (Brazil); new docs should have an English section.
- **No secrets, ever.** Not in code, tests, logs or screenshots. Anything that handles a secret goes through `src/main/secrets*.ts`; a secret value never travels to the renderer.
- **Respect the safety model.** Agents are read-only; effects go through the proposal, confirmation and audit path (`src/main/actions.ts`); `src/main/webPolicy.ts` decides what a paired phone may call. A change that widens what an agent or a browser can do needs a clear justification in the pull request and a test showing the refusals still hold.
- **Comments say why, not what.** Short, in English, no narrative of how you investigated.

## Commits, branches and pull requests

- Branch from `main`; name it for what it does (`fix-vcs-timeout`, `feat-bitbucket-labels`).
- Commit messages have exactly two prefixes, lowercase, English, imperative, no trailing period:

  ```
  feat: add <thing>            # any addition or change of behavior
  fix: correct <thing>         # a bug fix
  ```

  For example `feat: add a gitea provider` or `fix: keep the downloaded update when a later check fails`. One logical change per commit.
- If the change is visible to users, add a line under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
- Open the pull request against `main` and fill in the template. Keep it focused; a refactor and a feature are two pull requests.
- A maintainer reviews every pull request, and CI must be green.

## How to add a VCS provider

Everything the app reads from or writes to a code host goes through the neutral interface in `src/main/vcs/` ([`docs/vcs-providers.md`](docs/vcs-providers.md) explains the model). A new host (Gitea, Azure DevOps, ...) means:

1. **Declare the kind** in `VCS_KINDS` (`src/shared/config/types.ts`). The JSON Schema of the configuration is derived from it; `test/config-schema.test.ts` fails if types, schema and defaults drift apart.
2. **Implement `VcsProvider`** (`src/main/vcs/types.ts`) in `src/main/vcs/<kind>.ts`, following `github.ts` or `bitbucket.ts`: authenticated user, issues, merge or pull requests, threads, changes, CI and approvals mapped to the neutral shapes. A provider only **reads** and **describes** writes (`planWrite`); it never writes by itself.
3. **Validate and execute writes** in `validate.ts` (a strict list of the shapes accepted, anything else refused before it is stored) and `exec.ts`. Only `runtime.ts` imports the executors and only `actions.ts` calls them; `test/vcs-writes.test.ts` fails if that changes.
4. **Wire it in:** `runtime.ts` (`buildRuntime`), `probe.ts` (the wizard's "Test" button, which reports the token's permissions), `stages.ts` (default stage mapping) and `readPolicy.ts` (what an agent may read; if there is no CLI, expose the `VcsRead` tool).
5. **Test against a fake host** (`test/helpers/fakeHost.ts`, `test/fixtures/vcs/`), modelled on the official API documentation: reads, pagination, errors (`auth`, `forbidden`, `rate_limited`, ...), the validators' refusals and the probe. `test/vcs-github.test.ts` is the model.
6. **Wizard and strings:** the integration step and its texts in both catalogs.
7. **Document** the token permissions and what is not verified in `docs/vcs-providers.md`, and say honestly if you could only test against a fake.

## How to add a development-cycle template

A template is a named `devCycle` section ([`docs/cycles.md`](docs/cycles.md)): the ceremonies that are on, the stage vocabulary and mapping, what counts as a blocker or "ready for QA", and where the documents live. You can build one without code (adjust in the app, then export it as a file and share it). To ship one with the app:

1. Create `src/shared/cycles/templates/<id>.ts` exporting a `CycleTemplate` (see `kanban.ts` for a small one, `sdd.ts` for a full one).
2. Register it in `BUILT_IN_TEMPLATES` in `src/shared/cycles/index.ts` (the order is the wizard's order).
3. Add its name and description keys (`cycle.<id>.name`, ...) to **both** catalogs, and any prompt texts it overrides under `prompt.<id>.*` (a family falls back to `sdd` for what it does not define).
4. Cover it in `test/cycle-templates.test.ts` (it must validate, and its stages must be reachable) and, if it changes prompts, `test/cycle-prompts.test.ts`.
5. List it in the table of `docs/cycles.md`.

## How to add a model provider

- **An OpenAI-compatible server or service** (the common case): no engine code. Add a preset to `OPEN_PRESETS` in `src/shared/wizard.ts` (base URL, suggested models, headers if any) and its label in both wizard catalogs. Check it with the connection test (`probeOpenAIProvider`), and add what the server does differently (error wording, `reasoning` fields, parameters it rejects) to `test/helpers/fakeOpenAI.ts` and `test/engine-open-*.test.ts`. State in [`docs/llm-providers.md`](docs/llm-providers.md) whether you tested it against the real thing.
- **A new way to reach Claude models** (another cloud): add the kind to `PROVIDER_KINDS` (`src/shared/config/types.ts`), map its settings to the SDK's environment in `src/main/llm-core.ts`, and add it to the wizard's models step and to `test/config-*.test.ts`.
- **A new engine** (a different agent runtime): implement the contract in `src/main/engine/contract.ts` and register it with `registerEngine` (`src/main/engine/registry.ts`). It must apply the same hooks as the others (`shellAllowlist`, `noSecrets`, `redactSecretResults`) and show the same refusals in a test, as `test/engine-open-tools.test.ts` does.

## Documentation

- Docs live in `docs/` and are indexed in [`docs/README.md`](docs/README.md). Keep an English section in every document; Portuguese (Brazil) sections are welcome.
- Say what is **not verified**. This project would rather admit that something only ran against a fake server than let a reader assume otherwise.
- Do not put real company names, hosts, people or issue numbers in documentation, tests or examples; use neutral placeholders such as `example.com`, `group/project` and `#123`.
