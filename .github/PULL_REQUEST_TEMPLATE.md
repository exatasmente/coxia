## What and why

<!-- What does this change, and what problem does it solve? Link the issue: "Closes #123". -->

## How it was checked

<!-- Tick what you ran. CI runs the first four for every pull request. -->

- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run` (new behavior has tests)
- [ ] `node scripts/theme-audit.mjs`
- [ ] `node scripts/public-audit.mjs`
- [ ] `npm run i18n:lint` (new texts exist in both `pt-BR` and `en`)
- [ ] Tried it in the app (`npm run dev` or a packaged build), when the change is visible

## Notes for the reviewer

<!-- Risky parts, follow-ups, screenshots for UI changes. -->

- [ ] No secrets, tokens or personal data in the diff, the tests or the logs
- [ ] `CHANGELOG.md` has a line under "Unreleased" when the change is visible to users
