# The documentation site

The published site of the repository: a landing page, the guide, the reference documentation that already lives in
[`docs/`](../docs/), the use cases and the blog. It is written and maintained by the agents of the app through the
normal cycle — the same path any other change of the repository takes, with the person's yes at the pull request.

`docs/` stays where it is: the reference pages are built from the documents where they already are, so the site and
what the app's agents read at run time cannot drift apart, and no document is copied into this folder.

## What is here

| Path | What it is |
|---|---|
| `index.md`, `pt-br/`, `guide/`, `use-cases/`, `blog/` | The pages written by hand or by an agent, English and Portuguese (Brazil) side by side. |
| `scripts/` | The plain Node modules the site builds from: the walk of `docs/`, the split of a bilingual document, the changelog extractor, and the links and languages checks. The suite tests these. |
| `.vitepress/config.mts` | The generator's configuration: the navigation, the sidebar, and the generated pages. |
| `generated/` | Written on every build from `docs/` and `CHANGELOG.md`; not versioned (`.gitignore`). |

The history page and the blog posts are read from [`CHANGELOG.md`](../CHANGELOG.md) when the site is built, so a
version released through the normal cycle gets its post without anybody writing one. A reference page is born from
the document's own path: a document that lands in `docs/` has a page without a list anywhere being edited.

## Working on it

```bash
npm run docs:dev      # the local preview
npm run docs:build    # build into site/.vitepress/dist
npm run docs:check    # links and languages, over the built site
```

The whole of the site's CI step is those last two, in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): a
link that points at a page the site does not have, or a page that lost one of its two languages, fails the pull
request.

## How it is published

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) builds the site on every push to the default branch
and publishes it to the repository's own Pages address. **The person turns Pages on once**, in the repository settings
on the host, with the GitHub Actions source; nothing in this repository writes that setting, and no address of the
site is written into a file of the tree — the build reads it from the host.

## Images

The pages use text and a placeholder for now. The screenshots come from the app itself, over a seeded workspace
holding fictitious data, and they are refreshed with each release; until they land, no page carries a capture, and
never one with real data.
