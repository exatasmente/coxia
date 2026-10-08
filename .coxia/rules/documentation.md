---
checked-commit: b94bbea2d99f0d0ebee1ce0b6d5e24e2c9adf9d3
checked-date: 2026-10-06
evidence: [docs/README.md:1-33, docs/README.md:28-32, CONTRIBUTING.md:133-138, .coxia/.gitignore, docs/configuration.md:1-3, docs/runner.md:1-5]
summary: How the docs in docs/ are written, indexed and kept honest
stages: [development, review]
roles: [developer, tech-lead]
---

# Documentation

The project's own documentation for people lives in `docs/` and is indexed in
`docs/README.md`. Keep an English section in every document; Portuguese (Brazil) sections are
welcome. Several documents carry both languages in the same file, with language links at the
top.

## The documents

`docs/README.md` is the index and links to: `configuration.md` (the workspace configuration),
`llm-providers.md` (the two engines and their providers), `vcs-providers.md` (the code hosts),
`cycles.md` (the cycle templates), `runner.md` (how an issue goes through the agent cycle),
`voice.md`, `updates.md`, `i18n.md`, `verify-commands.md`, plus the root `CONTRIBUTING.md`,
`RELEASING.md`, `SECURITY.md`, `GOVERNANCE.md`, `MAINTAINERS.md` and `THIRD_PARTY_NOTICES.md`.
Per-issue design records and run documents live under `docs/cycles/<n>-<title>/`.

## The rules

- **Keep the index current.** A new document goes into the table in `docs/README.md`.
- **Say what is not verified.** This project would rather admit that something only ran against
  a fake server than let a reader assume otherwise. `docs/vcs-providers.md` and
  `docs/llm-providers.md` each carry a "not verified" list; follow that example.
- **No real names.** Do not put real company names, hosts, people or issue numbers in
  documentation, tests or examples; use neutral placeholders such as `example.com`,
  `group/project` and `#123`. This is enforced by the public audit (`rules/public-repo.md`).
- **A new interface string goes through `t()`** in both catalogs (`rules/i18n.md`).

**This app's own documentation lives in two places, and they are not the same.** `docs/` is
for people. `.coxia/` is the documentation an agent of this app reads when it works a stage on
a repository, and it is written from the code on purpose: it says how the app is built and
tested, the rules of each domain, the procedures and the notes for each agent. It does not
replace `docs/`, and it is not kept in sync with it mechanically — a fact belongs in one of
them, and the other should point at it rather than say it again. A default `.coxia/.gitignore`
excludes the folder and its `.run/` artifacts in a *consumer* repository; here `.coxia/` is
versioned on purpose, because it is the shipped documentation.

**Nothing in this folder restates a person's private session.** Do not write a credential, a
host name, a local machine path, a person's name or any address: the folder is versioned and
may be public, and relative repository paths are the only paths that belong here.
