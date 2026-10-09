# 170 Let a stage test the app under development with real configuration: workspace variables and secrets

- Endereço: https://github.com/exatasmente/coxia/issues/170
- Estado: open
- Rótulos: enhancement, coxia, priority:high
- Autor: exatasmente

## Descrição

## What should happen

A stage of a run — QA first of all — can exercise the app under development with **real configuration**: a model provider key, a code host token, the URL of an integration, a feature flag. The person keeps, per workspace, a **test environment**: a list of **variables** (plain values) and **secrets** (references into the secrets store), and chooses which stages receive it. The app under test gets them; the person decides where they may reach on the network; and a value never ends in a commit, the pull request, the conversation, the log or the paired browser.

This has to work for any app a workspace develops, not only for Coxia developing Coxia.

## What exists today

- The secrets store keeps provider keys, code host tokens and plugin secrets by reference (`stored`, `command`, `env` sources), global to the data folder; only the main process resolves a value, and no workspace or stage scope exists.
- There is no notion of plain variables for a workspace or a repository (only per-plugin settings).
- A sandbox stage starts from an empty environment and, by default, without network (`registry` reaches listed hosts on 443 through the proxy and refuses private addresses; `open` shares the host network). Nothing the person chooses is added to it, so the app under test has no key, no token and no way out.
- A host stage gets the app's own environment with every credential-looking name removed; it has no file or network confinement.
- Redaction is by pattern (known key prefixes, long opaque strings); only plugin requests mask the exact value of a secret. Screenshots and evidence files are not redacted.
- The QA prompt asks the agent to start Coxia with an empty data folder, but nothing enforces it on the host.

## What the person must decide

- **Where the list lives**: per workspace (and optionally per repository of the workspace); secrets as references in the existing store, under their own prefix, never values in the configuration.
- **Who receives it**: which stage kinds or agents (QA by default?), and in which shell (sandbox only at first, or the host too).
- **How the app under test receives it**: environment variables of the stage; a file the app writes from a template outside the worktree (an `.env`, a config file); for Coxia under test, its own `env` secret source can read a key from a variable without the agent writing it anywhere.
- **Where it may reach**: each secret or variable may declare the hosts it is for, and the stage's network opens only to those; what to do with a code host or an integration on a private address, which the proxy refuses today.
- **What the agent may see**: the agent runs commands in the same environment, so it can read a value; the exact value (raw, URL-encoded, JSON-escaped) is masked in command output, the conversation, the audit log, the run file, stage documents and the pull request, as plugin requests already do. Images cannot be masked: say so, and how a screenshot that shows a value is handled.
- **Real effects**: an app under test holding a real code host token can write to the host without going through the app's proposal, confirmation and audit. Should the list say which credentials are test-only (a dedicated project, a low-budget key), should a test workspace refuse real secrets, and should the person confirm before a stage starts with them?

## Acceptance

- A workspace can keep variables and secret references for testing; the values are filled in on the computer only, and a secret value never reaches the configuration file, an export, the log, the audit log or the paired browser.
- A stage the person allowed receives them in the way chosen above; a stage not allowed, or a workspace without the list, behaves exactly as today.
- The network of a stage that receives them opens only to the destinations the person declared.
- An exact secret value is masked wherever the stage's text is kept or shown, and a commit or a pull request that would carry one is refused with the reason.
- On the host, a stage testing Coxia cannot read the person's real data folder or secrets file.
- A QA stage can show a real integration working (for Coxia: a model call with a real key, a read from a code host) and record it as executed evidence, without the value appearing in it.

## Notes

Functional specification only; the contract is for refinement and planning. Close to the plugin requests (the app places the secret, the plugin never sees it), with one difference that the refinement must face: here the value has to reach the app under test, inside an environment the agent also commands.

## Comentários

(sem comentários)
