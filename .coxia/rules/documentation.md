---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [docs/README.md:1-33, CONTRIBUTING.md:133-138, docs/configuration.md:1-3, docs/runner.md:1-5]
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
Per-issue design records live under `docs/cycles/<n>-<title>/`.

## The rules

- **Keep the index current.** A new document goes into the table in `docs/README.md`.
- **Say what is not verified.** This project would rather admit that something only ran against
  a fake server than let a reader assume otherwise. `docs/vcs-providers.md` and
  `docs/llm-providers.md` each carry a "not verified" list; follow that example.
- **No real names.** Do not put real company names, hosts, people or issue numbers in
  documentation, tests or examples; use neutral placeholders such as `example.com`,
  `group/project` and `#123`. This is enforced by the public audit (`rules/public-repo.md`).
- **A new interface string goes through `t()`** in both catalogs (`rules/i18n.md`).

The folder you are reading (`.coxia/`) is the documentation the app's own agents read; it is
separate from `docs/`, which is for people. This folder does not replace `docs/`.
