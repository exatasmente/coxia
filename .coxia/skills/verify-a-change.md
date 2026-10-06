---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [CLAUDE.md:27-41, CONTRIBUTING.md:45-75, .github/workflows/ci.yml:1-90, package.json:6-15]
summary: What to run before calling a change done, and what each gate means
stages: [development, review, qa]
roles: [developer, qa, tech-lead]
---

# Verify a change

Run these and report what actually happened — do not describe a gate you did not run:

```bash
nvm use                      # the Node version in .nvmrc
npx tsc --noEmit
npx vitest run               # fast; the whole suite is safe to run
node scripts/theme-audit.mjs
npm run i18n:lint
node scripts/public-audit.mjs
```

CI (`.github/workflows/ci.yml`) runs the same, plus `electron-vite build`. A red gate is not
"done". The Python voice sidecar is not part of CI.

## What each one is for

| Gate | What it checks |
|---|---|
| `npx tsc --noEmit` | Strict TypeScript; no `any` without a reason |
| `npx vitest run` | The whole suite; every behavior change has a test that fakes the model, the code host and the network |
| `node scripts/theme-audit.mjs` | Literal colors per file and the theme tokens' contrast in both themes |
| `npm run i18n:lint` | Both catalogs define the same keys, and the renderer's literal count is at zero |
| `node scripts/public-audit.mjs` | No company or personal name, private address, outside email or credential in the tree (`rules/public-repo.md`) |

## Grading a change

- Does it have a test, and does the test fake the outside world (`rules/build-and-test.md`)?
- Does every new user-facing string go through `t()`, with both catalogs updated
  (`rules/i18n.md`)?
- Does the UI use theme tokens, and did you check both themes?
- Does the change widen what an agent or a browser can do? If so, it needs a justification and
  a test showing the refusals still hold (`rules/safety-model.md`).
- Is the change visible to users? Add a line under `## [Unreleased]` in `CHANGELOG.md`.
- Does anything you wrote carry a real name, host or issue number? Fix it before pushing
  (`rules/public-repo.md`).
