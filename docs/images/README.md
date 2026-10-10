# Screenshots

The screenshots the README shows are taken from the app itself, by the scripts of `scripts/captures/`, over a workspace of
fictional data written by `scripts/seed-docs-workspace.mjs`. Nothing is drawn by hand:

```bash
node scripts/seed-docs-workspace.mjs /tmp/docs-workspace        # a throwaway workspace, no real data
npx electron-vite build                                          # the capture opens the built app, never the sources
node scripts/captures/run.mjs --data /tmp/docs-workspace         # writes every image of scripts/captures/index.json
```

`scripts/captures/index.json` is the list: one entry per screen, with the title in both languages, the capture script and
where the image is used. The README, the pages and the site reference images only through it, and
`node scripts/docs-images-check.mjs` (the CI job `check`) refuses a reference with no entry, an entry with no image, a
script the list does not name and an image nobody references. A release refreshes the images in a stage of the release
flow, and the change goes to the release's pull request like any other.

| File | What it shows |
|---|---|
| `today.png` | The Today screen with a few cards in different stages |
| `call.png` | A ceremony in progress (voice or text), with the agent's sources visible |
| `actions.png` | The actions queue with one proposed command waiting for confirmation |
| `wizard.png` | The first-run setup wizard (models step) |
| `phone.png` | The phone companion (PWA), taken in a phone-sized window |

Each screen is written twice, `docs/images/<name>.png` for the Portuguese pages and `docs/images/<name>-en.png` for the
English ones; a capture that the list knows and the folder does not have yet stays listed as pending, so the list and
the folder never disagree in silence.

Rules:

- **Demo data only.** The seed is what guarantees it: a throwaway repository, fictitious tasks and a fictitious name
  (`example.com`, `group/project`, `#123`). No real company, host, person, issue number, token or path from your home
  folder. Check the window title, the status bar and the browser address bar as well.
  `node scripts/public-audit.mjs --root <the folder the seed wrote>` checks the seeded folder.
- Never point the capture at the app's real data folder: it takes a throwaway one, and the seed refuses a folder that
  already holds a workspace.
- PNG, fixed window size (1280x800 for desktop shots, 390 px wide for the phone), light theme unless the shot is about
  the dark theme, fixed clock and animations off, so two runs write the same files.
- The capture runs on Linux: the screen a stage is given is a virtual one, and never the person's.

