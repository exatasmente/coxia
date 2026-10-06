---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [scripts/public-audit.mjs:1-70, scripts/public-audit.allow.json, CLAUDE.md:43-62, CONTRIBUTING.md:135-138, .github/workflows/ci.yml:32-34]
summary: The public audit, the placeholder rule, and the file for an unavoidable false positive
stages: [development, review, qa]
roles: [developer, qa, tech-lead]
---

# Public repository rules

This repository is public. `scripts/public-audit.mjs` fails when a file of the tree — tracked,
or untracked and not ignored — carries something that belongs to a company or a person instead
of the project. It runs as the first CI step, before the dependencies are installed.

## What it hunts

- The name, hosts, repositories, tools and accounts of the company the app was born in.
- A real issue or merge-request number.
- A real person's name or handle.
- A private network address (use a documentation range such as `192.0.2.0/24`).
- An email outside the reserved domains (`example.com`, `.test`, `.invalid`, `.local`,
  `localhost`, the code hosts' own domains).
- Something that looks like a key or a token.
- A path that must never be public: a `.claude/` folder at the repository root, `scratch/`,
  `.runlogs*`, `.env*`, `*.log`, `*.key`, a private legacy profile.

The company and personal patterns are stored encoded in the script so the script itself does
not leak the names it hunts. `node scripts/public-audit.mjs --list-rules` prints the rule ids
and messages. Binary files are checked by path only.

## The rule for anything you write

For code, tests, fixtures, docs, examples, commit messages and branch names:

- **No company name, real person, real host, real issue number or credential.** It is public
  the moment it is pushed.
- **Neutral placeholders instead:** `example.com`, `group/project`, `#123`.

## An unavoidable false positive

It goes into `scripts/public-audit.allow.json` with a `reason`, and that file stays short:
every entry is an exception. An entry has `{ rule, file, match, reason }`, where `file` takes
`*` within a folder and `**` across folders, and `match` is the text the hit must contain.

## Checking your work

```bash
node scripts/public-audit.mjs
node scripts/public-audit.mjs --counts     # the number of hits per rule, even when zero
node scripts/public-audit.mjs --list-rules # the rule ids and messages
```

The audit is a hard gate: a red audit is not "done".
