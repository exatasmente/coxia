---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [package.json:1-58, CONTRIBUTING.md:24-75, .github/workflows/ci.yml:1-90, test/setup.ts, test/helpers/fakeOpenAI.ts, test/helpers/fakeHost.ts, scripts/theme-audit.mjs, scripts/i18n-lint.mjs]
summary: Setup, the scripts, the CI gates and the rules for a test
stages: [development, review, qa]
roles: [developer, qa, tech-lead]
---

# Build and test

## Setup

You need the Node.js version in `.nvmrc` and a Linux or macOS machine. Python 3 and `uv` are
needed only for the voice sidecar.

```bash
nvm use                 # the version in .nvmrc
npm ci
npm run dev             # Electron with hot reload
```

To work with a throwaway copy of the app's data, so real workspaces stay untouched, point
`CERIMONIAS_DATA_DIR` (and `CERIMONIAS_SPECS_DIR`) at an empty folder before starting. Only one
instance of the app runs at a time: close an installed copy before running the development one.

The Claude engine needs the Claude Agent SDK, a regular dependency in development and left out
of the public packages. You need no model or account to run the tests: the open engine can talk
to a local server such as Ollama.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Electron with hot reload |
| `npm run build` | Builds main, preload and renderer into `out/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | The whole suite (`vitest run`); `npx vitest run test/<file>.test.ts` for one file |
| `node scripts/theme-audit.mjs` | Counts literal colors per file and checks the theme tokens' contrast |
| `node scripts/public-audit.mjs` | Fails when a file carries a company or personal name, a private address, an email outside the reserved domains or a credential (`rules/public-repo.md`) |
| `npm run i18n:lint` | Checks that the `pt-BR` and `en` catalogs define the same keys |
| `node scripts/i18n-lint.mjs` | Lists user-facing literal strings that do not go through `t()` |
| `node scripts/third-party-notices.mjs` | Regenerates `THIRD_PARTY_NOTICES.md` (`--check` verifies it) |
| `npm run dist` | Your own package, with the Claude Agent SDK inside (do not redistribute it) |
| `npm run dist:public` | The public package, without the SDK: what releases contain |

## The gates

CI (`.github/workflows/ci.yml`) runs, for a pull request or a push to `main` or `release/**`:
the public audit, `npm ci`, `npx tsc --noEmit`, `npx vitest run`, the theme audit,
`npm run i18n:lint` and `npx electron-vite build`. A separate job builds the unsigned Windows
NSIS installer as a temporary artifact. The Python voice sidecar is not part of CI.

Before calling a change done, run the same gates. A red gate is not "done". The exact list is
in `skills/verify-a-change.md`.

## Tests

- Every behavior change comes with a test in `test/`. The suite is Vitest, in Node.
- **No test may call a real model, a real code host or the real network.** The helpers in
  `test/helpers/` fake them: `fakeOpenAI.ts`, `fakeHost.ts`, `vcs.ts`, `fakeMcp.mjs`,
  `conflictRepos.ts` and others. Fixtures live in `test/fixtures/`.
- `test/setup.ts` gives every test file its own temporary data folder. Never point a test at
  real data or at the specs folder.
- Prefer testing the pure `*-core.ts` modules and `src/shared/` over the Electron shell; that
  is why those modules exist.
- Never put a real token, key, host name, person or issue number in a test, fixture or
  snapshot.

```bash
npx vitest run > .runlogs-test.log 2>&1   # the whole suite, output in a file
npx vitest run test/vcs-github.test.ts     # one file
```

`test/helpers/` also carries `runner.ts`, `runs.ts`, `squads.ts` and `squadRunner.ts` for the
runner, and `electron.ts`, `config.ts`, `parity.ts` and `promptCapture.ts` for the rest.

## Code rules

- **TypeScript, strict.** No `any` without a reason. Keep Electron-free logic in `*-core.ts` or
  `src/shared/` so it can be tested without the app.
- **Every user-facing string goes through `t()`**, with the key in both catalogs
  (`rules/i18n.md`).
- **Theme tokens, not colors.** In the renderer use the CSS custom properties defined in the
  `:root` token blocks; never a literal `#hex`, `rgb()` or `hsl()` in a component or
  stylesheet. Check both themes when you touch the UI.
- **Code, tests, identifiers and commit messages are in English.** Documentation for people
  may be in English or Brazilian Portuguese; new docs should have an English section.
- **Respect the safety model** (`rules/safety-model.md`). A change that widens what an agent or
  a browser can do needs a clear justification in the pull request and a test showing the
  refusals still hold.
- **Comments say why, not what.** Short, in English, no narrative of how you investigated.
