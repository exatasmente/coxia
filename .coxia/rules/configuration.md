---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [src/shared/config/types.ts:1-60, src/shared/config/schema.ts, src/shared/config/migrations.ts, src/main/secrets-core.ts:1-60, docs/configuration.md:1-130]
summary: The workspace configuration, its schema versions and migrations, the secrets store, export and import
stages: [development]
roles: [developer, tech-lead]
---

# Configuration

Everything a workspace decides lives in one versioned document, the `WorkspaceConfig`, at
`<data>/workspaces/<id>/config.json`. Several workspaces mean several configurations.
`src/shared/config/types.ts` documents every field; `src/shared/config/schema.ts` derives
the JSON Schema (channel `config:schema`), which also validates an import.
`test/config-schema.test.ts` fails when types, schema and defaults drift apart.

The current schema version is `CONFIG_SCHEMA_VERSION` in `src/shared/config/types.ts`
(read there; it changes). `docs/configuration.md` keeps the history of every version and what
each migration does.

## The main sections

| Section | What it decides |
|---|---|
| `schemaVersion`, `setupComplete`, `language` | Version, whether the wizard finished, `pt-BR` or `en` |
| `appearance`, `notifications`, `closeToTray`, `retention`, `schedule` | The pre-existing settings |
| `llm.providers[]` | `{ id, kind, engine, baseUrl, models, secretRef, ... }`; `kind` is one of `anthropic`, `bedrock`, `vertex`, `foundry`, `openai-compatible`; `engine` is `claude-sdk` or `open` |
| `llm.roles` | Per role (`turn`, `reply`, `deep`, `teams`, `fix`): `{ provider, model }` |
| `projects` | `roots[]`, `repos[]`, `autoDiscover`, `issues` (the issue project, the card prefix, `cardScope`, `cardLabels`), `verifyCommands` |
| `vcs[]` | The code-host integrations: `kind`, `host`, `apiUrl`, `user`, `secretRef`, `cliPreference`, `cliCommand` |
| `docs` | Context sources in the Claude Code style: `claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`, `mcpConfigFiles`, `specsDir` |
| `devCycle` | The development cycle (`rules/development-cycles.md`) |
| `agents` | `tools`, `extraInstructions`, `persona`, `roles[role]`, `team[]` |
| `voice` | `enabled`, `engine`, `sttModel`, `depsInstalled` |
| `claudeSdk` | Where the Claude Agent SDK is installed |
| `externalTools` | Optional integrations, all off until configured |
| `runner` | The agent cycle's settings (`rules/runner.md`) |

Paths under the home folder are stored with a leading `~/` so an exported configuration stays
portable. Browser access (host, port, public URL) belongs to the machine, not the workspace,
and lives in `web.json`.

## Migrations

A new schema version always brings a migration in `src/shared/config/migrations.ts`
(`vNToV(N+1)`); it must not touch anything but the fields it adds, and the ones that only
write a default must keep a value that already exists. `docs/configuration.md` lists the
history; read it before changing the types. An invalid field in an old file is replaced by
the default with a note in the log and never blocks the workspace; a file written by a newer
version of the app is refused.

## Secrets

`src/main/secrets-core.ts` is pure and testable; `src/main/secrets.ts` is the Electron side.
The configuration stores only a `secretRef`; the value lives in `<data>/secrets.json` (mode
0600), shared by every workspace and **never exported**. Three sources:

| Source | How it works |
|---|---|
| `stored` | Encrypted with the OS keychain (`safeStorage`). Without a keychain the app refuses to store, unless the person explicitly accepts the insecure file (`acceptInsecureStorage()`), which writes plain text in the 0600 file with a warning in the file itself |
| `command` | The value is the stdout of an executable, run without a shell |
| `env` | The value is an environment variable of the app |

Nothing returns a value except `resolve()`, and its callers hand it straight to a child
process or an HTTP header; `list()` and `check()` never return the value. A secret value
never travels to the renderer.

## Export and import

`src/shared/config/transfer.ts` defines the file format
(`{ format, formatVersion, exportedAt, app, workspace, requiredSecrets, config }`). A file
that carries a secret value is refused. The import preview shows the diff, the secrets asked
for, the programs the file would run and the paths that do not exist here; it does not write.
Applying writes the secrets and the configuration, keeping the previous one as
`config.pre-import.json`.

## Editing from a paired browser

Channels that write the configuration, the secrets or an export/import file are desktop-only
(`rules/safety-model.md`). The one write a browser has is `config:cycle-save`, which checks
its own scope in `src/main/configScope.ts` against the saved configuration: it accepts only
changes to the team, squads, flow, comment templates, priority and the runner's plain
settings, and never an increase of an agent's `shell` or `tracker`.
