# 221 Take the images of the documentation from a seeded workspace, and regenerate them on release

- Endereço: https://github.com/exatasmente/coxia/issues/221
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## What should happen

The images of the documentation are taken from the app, by an agent, from a workspace seeded with fictional data, following one capture script per feature. A release regenerates them, so the pictures never fall behind the screens. The person reviews the images in the pull request like any other change.

Feeds #220 (the documentation site on GitHub Pages).

## Today (0.8.0 / 0.9.0-beta.12)

- Since 0.8.0 a stage can test an interface: the browsers folder reaches every sandbox and host session through `PLAYWRIGHT_BROWSERS_PATH`, the **QA stage** gets a virtual display (Xvfb, no TCP), the prompt says how to test, and `ViewImage` shows the agent a screenshot from the stage's own output folder. Only the stage whose output is QA asks for the display (`src/main/runner/executor.ts`, `outputKindOf(stage.kind) === 'qa'`); a release or documentation stage does not get one.
- With an empty `CERIMONIAS_DATA_DIR` the app shows only the setup wizard. Every other screen (the day, a run, a stage with evidence, a virtual screen with a hold, the Procedures view, Settings › Team, the paired phone) needs a workspace with data behind it. The test suite has fixtures for most of these screens, each one local to its test; there is no seed that puts a whole workspace on disk.
- A stage can keep an image as evidence (`ev-N`), mark it up (rectangle, arrow, ellipse, label, numbered marker, blur) and, with the Settings › Runner choice "also in the cycle folder", commit it into the cycle folder. There is no path from evidence to `docs/images/`.
- `docs/images/` holds only a README. The repository is public: no real person, company, host or issue number may appear in a seed, a fixture or an image.

## Behaviour

- **A seed script** (`scripts/seed-docs-workspace.mjs`) writes a complete fictional workspace into a folder given on the command line: configuration (schema of the running version, through `withConfigDefaults`), a team of agents with the system five and a product team, a few activities on a board of a fake host, two runs (one finished with documents per stage and evidence, one blocked at a human gate), a conversation with a held step and a recording, three learned procedures (one reviewed, one stale), the minutes of a day, and a paired phone. Every name, host and number is a neutral placeholder; the script's output passes `scripts/public-audit.mjs`.
- **The seed never touches real data.** It refuses to write into a folder that already holds a workspace, and it sets nothing outside the folder it is given. Tests and the capture always point `CERIMONIAS_DATA_DIR` (and `CERIMONIAS_SPECS_DIR`) at it.
- **One capture script per feature** (`scripts/captures/<feature>.mjs`): launches the built app on the seeded workspace through Playwright's Electron launcher, in the app's language of the capture (`pt-BR` and `en`), at a fixed window size and theme, walks to the screen, waits for it to settle, and writes `docs/images/<feature>[-<lang>].png`. Phone screens are taken from the web mode at 390 px. A script may call the mark-up tool to add a rectangle or a label; the plain image is kept as well.
- **The list of features is a file** (`scripts/captures/index.json`): id, title in both languages, which script, which screens, where the image is used (README, a `docs/` page, the site). The site and the README reference images only through this list.
- **A stage that is not QA can ask for the display.** A stage of the flow carries a flag (`display: true`, off by default) that gives it the same virtual display the QA stage gets, under the same settings and guards (sandbox or host, Xvfb with no TCP, never the person's screen). Without it nothing changes for existing flows.
- **A stage of `release-flow` regenerates the images** after the version is bumped and before the release notes are final, with that flag on, and commits what changed in `docs/images/`. A changed image shows in the pull request as any other diff; the person's yes is the review.
- **A check compares what is used to what exists**: a referenced image with no script, or a script with no reference, fails CI.

## Acceptance

- `node scripts/seed-docs-workspace.mjs <empty folder>` produces a workspace the current version opens without a migration warning; the public audit passes on the seed and on the folder it wrote.
- `node scripts/captures/run.mjs` on the seeded workspace, on a computer with the built app and the browsers, writes every image of `index.json` in both languages, and a second run produces the same files byte for byte (fixed time, fixed size, fixed theme, animations off).
- The same command inside a stage with the display flag on (sandbox and host) does the same, and the stage keeps each image as evidence and can look at it with `ViewImage`.
- A stage without the flag, of any kind other than QA, gets no display, as today.
- A release run regenerates the images and the pull request shows only the images whose screen changed.
- The README and the `docs/` pages show images from `docs/images/` taken by the scripts, with no real data in any of them.

## Open questions for refinement

- The first list of features (the README needs five or six; the site wants more).
- Fixed time: a clock the app accepts from the environment, or the seed writing dates relative to a fixed day and the capture faking the system clock.
- Whether the seed also serves the test suite, replacing some per-test fixtures, or stays a documentation tool.
- Dark theme: one image per theme doubles the set; a single theme per image, chosen in `index.json`, may be enough.
- Whether the display flag belongs to the stage of the flow or to the agent (the agent already carries `screen`, `allowedHosts` and `browserProfile`).

## Comentários

(sem comentários)
