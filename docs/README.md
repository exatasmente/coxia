# Documentation

Start with the [project README](../README.md). These documents go deeper. Several are written in Portuguese (Brazil) and English in the same file (the language links at the top of each); the rest are in English.

## Using Coxia

| Document | What it covers | Languages |
|---|---|---|
| [Configuration](configuration.md) | The workspace configuration (`WorkspaceConfig`), where data lives, secrets, export and import, the setup wizard | pt-BR, en |
| [Model providers](llm-providers.md) | The two agent engines, the providers each one supports, the connection test, what was tested, limits of local models | pt-BR, en |
| [Code hosts](vcs-providers.md) | GitLab, GitHub and Bitbucket: how the provider is chosen, token permissions, what agents may read, how writes are confirmed | pt-BR, en |
| [Development cycles](cycles.md) | The cycle templates (SDD, Scrum, Kanban, GitHub Flow, Minimal), stages, prompts, making and sharing your own | pt-BR, en |
| [The runner](runner.md) | How an issue goes through the agent cycle: the worktree, the stages, the guard on an agent that writes, the commits, autonomy, the scheduler, what was not verified | pt-BR, en |
| [Learned procedures](procedures.md) | What agents keep about a recurring task for the next one: the record and its kinds, the tools, the screen draft, what never goes in, the switch, the Procedures view, the comparison | pt-BR, en |
| [Persona and chat](persona.md) | The persona of the workspace and the chat that opens the app: the wizard that makes it, its starting access, the streamed answer and the Work under it, the buttons that open a screen, what the persona does (its eleven tools, the one door, the lines of its acts), the Audit that says who, the Stop, the Overview, the menu, where the notices lead, the paired phone, where its personal text lives, what was not verified | pt-BR, en |
| [Budget](budget.md) | The operating budget: the monthly total and the limit per category, the ledger, how model cost is estimated and what reconciliation exists, what pauses at the limit and what keeps working, the channels | pt-BR, en |
| [Autonomy by kind of effect](autonomy.md) | Every kind of external effect asks until the person grants autonomy: the kinds and what maps to them, the track record, the offer after N approved proposals, the grant and its threshold, revoking, incidents, the audit, the channels and who may call them | pt-BR, en |
| [External accounts](accounts.md) | The registry of the accounts Coxia acts in: provider, purpose, secret references and whether they resolve, monthly cost, the grants tied to each; who opens an account; the rule that an agent acts only in a listed provider; the export without values | pt-BR, en |
| [Claude Code sessions](claude-sessions.md) | The opt-in screen of the machine's Claude Code sessions: where the list comes from without opening a key, sending, the copy, permission requests, stop and end, starting, the audit, why a paired phone and the persona never reach it, what was not verified | pt-BR, en |
| [Shared memory](memory.md) | What every agent can learn of the whole app without loading it: the notes agents keep per conversation, the short list and its tools, the version and the roadmap, the notice to a running run, the Memory view, the switch, what protects the rest | pt-BR, en |
| [Project instructions for agents](harness.md) | The root `AGENTS.md` format, how agents receive it, and the documentation run that creates or updates it | pt-BR, en |
| [Voice](voice.md) | Voice is optional: what "off" means, the call/chat wording, the voice setup, Edge and Kokoro engines | en |
| [Plugins](plugins/README.md) | The plugin kit: the declaration, the fixed event catalog, the boundary and the example (web search for the agents) | pt-BR, en |
| [The client contract](contract.md) | The one versioned contract every client speaks to an instance: the channel list and its types, the closed list of error codes, the version exchange over IPC and HTTP | pt-BR, en |
| [The core without the desktop](headless.md) | Running the core in a plain Node process: the bundle, the options, the master key file, one process per workspace, the web address of the process, the health route, signals and exit codes | pt-BR, en |
| [Passkeys and admin devices](passkeys.md) | A paired device with a registered passkey becomes an admin device: which channels open, what asks for the passkey at that moment, how a device registers, what the verification checks, the threat model | pt-BR, en |
| [The core without the desktop](headless.md) | Running the core in a plain Node process: the bundle, the options, the master key file, one process per workspace, one owner per workspace and the handover, the web address of the process, the health route, signals and exit codes | pt-BR, en |
| [Updates](updates.md) | How an installed app updates itself, channels, security of the update feed | pt-BR, en |
| [The documentation site](site.md) | The site the repository publishes: where each page comes from, how it is built and checked, how it is published | pt-BR, en |

## Contributing and maintaining

| Document | What it covers | Languages |
|---|---|---|
| [Contributing](../CONTRIBUTING.md) | Setup, scripts, tests, rules, how to add a code host, a cycle template or a model provider | en |
| [Internationalization](i18n.md) | The `t()` rules, the two catalogs, the voice-aware `tv()`, the lint | en |
| [Releasing](../RELEASING.md) | How a version goes from a commit to the people who run it | en |
| [Security policy](../SECURITY.md) | Supported versions and how to report a vulnerability | en |
| [Governance](../GOVERNANCE.md) and [maintainers](../MAINTAINERS.md) | How decisions are made | en |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | Dependencies and their licenses (generated) | en |

## Project history

| Document | What it covers |
|---|---|
| [Screenshots](images/README.md) | The screenshots the README shows, taken from the app by the capture scripts, and the rules for taking them |
