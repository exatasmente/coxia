# 220 Publish a documentation site on GitHub Pages: landing, guide, use cases and blog

- Endereço: https://github.com/exatasmente/coxia/issues/220
- Estado: open
- Rótulos: documentation, enhancement, coxia
- Autor: exatasmente

## Descrição

## What should happen

The repository publishes a documentation site on GitHub Pages: a landing page, a guide (install, first workspace, first ceremony, first run), the reference documentation already in `docs/`, use cases (one developer with a team of agents; a run from issue to pull request; an agent on a virtual screen handed to the person for a login; the paired phone approving an action), and a blog whose first posts come from the release notes. Agents of the app write and maintain it through the normal cycle; the person turns Pages on once and gives the yes at the pull request.

## Today (0.8.0 / 0.9.0-beta.12)

- `docs/` has the reference documentation, bilingual in places (`README.md`, `docs/llm-providers.md`), with `docs/images/` holding only a README.
- The repository's `README.md` still says "Status: 0.1, first public version" while 0.8.0 is released and 0.9.0 is in beta.
- `CHANGELOG.md` is written in prose per feature: it is the raw material of the blog and of the use cases.
- The `docs-flow` run kind exists, but its `docs-writer` agent writes only `AGENTS.md`, without shell or tracker. The site needs an agent of the person's with a sandbox, routed to the site's folder by a squad.
- Nothing in the app is a GitHub Pages or repository-settings write: turning Pages on is a repository setting the person changes on the host.

## Behaviour

- **A static site in the repository**, in a folder of its own (`site/`), built by a generator that fits the repository's toolchain (VitePress is the natural fit for a TypeScript repository; plain Jekyll if the no-toolchain path is preferred). The reference documentation is included from `docs/`, not copied.
- **Deployed by a workflow** (`.github/workflows/pages.yml`) on push to the default branch, using the GitHub Actions source of Pages. The person enables Pages once in the repository settings; the issue says so and does not try to do it from the app.
- **Bilingual, English first**, with the Brazilian Portuguese pages alongside, as the README does.
- **Sections:** landing (what the app is, in one screen, with one image or recording); guide; reference; use cases; blog (a post per release, written from the changelog, plus posts on what the agents learned); a changelog page generated from `CHANGELOG.md`.
- **Images come from the app, not from a design tool**, through the virtual display a stage already gets since 0.8.0 and the seeded workspace with its capture scripts (#221). Until that lands, the pages use text and placeholders, never screenshots with real data.
- **Public-repository rules apply to every page**: `scripts/public-audit.mjs` runs on the site's sources; no company, person, host or real issue number; placeholders stay neutral.
- **The site's own checks run in CI**: the site builds, links resolve, both languages have every page.
- **Verified from the app:** an agent whose allowed hosts include the repository's Pages host opens the published site in the app's browser and keeps a screenshot as evidence of the stage. A local preview is checked with Playwright on the loopback inside the sandbox.

## Acceptance

- A pull request adds the site, the workflow and the CI check; the audit, the typecheck and the tests pass; the person enables Pages and merges; the site is reachable at the repository's Pages host within the workflow's run.
- The landing, guide, reference, use cases, blog and changelog pages exist in both languages, and every reference page of `docs/` is reachable from the site.
- The blog has a post for 0.8.0 written from the changelog, and the changelog page follows `CHANGELOG.md` without a copy of it.
- The README's status line says the current version and links to the site.
- A later change to `docs/` or `CHANGELOG.md` through the normal cycle updates the site on merge without a step by the person beyond the usual yes.

## Open questions for refinement

- VitePress or Jekyll: toolchain weight against a landing page that looks like a product.
- Whether the reference documentation moves into `site/` or stays in `docs/` and is included (the issue prefers included: `docs/` is read by the agents of the app at runtime).
- The folder name and the squad routing for the docs agent.
- Whether a custom domain is wanted now; it costs money and accepts terms, so it goes through the external-effect rule and a separate decision.

## Comentários

(sem comentários)
