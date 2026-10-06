---
checked-commit: 1a0858c59ed1d4c43e03feb3e709bbefd8441336
checked-date: 2026-10-06
evidence: [src/shared/secrets.ts, src/main/secrets-core.ts:1-60, src/main/secrets.ts, test/secrets.test.ts, docs/configuration.md:95-105]
summary: The credential store, its three sources, and the rule that a value never leaves it
stages: [development]
roles: [developer]
---

# Credential store

The pure, testable half lives next to the Electron half in the main process
(`src/main/secrets-core.ts` and `src/main/secrets.ts`). Values are keyed by a reference in
`<data>/secrets.json`, mode 0600, shared by every workspace and **never exported**. The
configuration holds only the reference (a key matching `^[a-z0-9][a-z0-9._-]{0,63}$`).

## The three sources

| Source | How it works |
|---|---|
| `stored` | Encrypted with the OS keychain (Electron `safeStorage`). Without a keychain (on Linux a `basic_text` backend does not count) it **refuses** to store, unless the person explicitly accepts the insecure file (`acceptInsecureStorage()`), which writes plain text in the 0600 file with a warning inside the file itself |
| `command` | The value is the stdout of an executable, run without a shell, so whoever already has a key script does not copy the key |
| `env` | The value is an environment variable of the app |

## The rule

**Nothing returns a value except `resolve()`, and its callers hand it straight to a child
process or an HTTP header.** `list()` and `check()` never return the value. A credential never
travels to the renderer, never goes in a log, a test, a fixture or a screenshot, and never
enters a configuration export.

Anything that handles a credential goes through the main-process modules of this domain. A
path with one is also blocked from the agents' tools (`secretPath` in `src/main/agents.ts`),
applied before a read and during a search, and tool results are redacted.

## Export and import

`src/shared/config/transfer.ts` lists `requiredSecrets` (`{ ref, usedBy, label }`) instead of
values. A file that carries a value is refused at import. The import preview shows which ones
are asked for and which already exist here.

## The channels

| Channel | What it does | Web |
|---|---|---|
| `config:secret-set` / `-remove` / `-check`, `config:secrets-accept-insecure` | Manage the sources | Desktop only |
| `config:export` / `-import-pick` / `-import-preview` / `-import-apply` | Open file dialogs and write the files | Desktop only |

`test/secrets.test.ts` pins the store's behavior.
