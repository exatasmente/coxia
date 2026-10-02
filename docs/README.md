# Documentation

Start with the [project README](../README.md). These documents go deeper. Several are written in Portuguese (Brazil) and English in the same file (the language links at the top of each); the rest are in English.

## Using Coxia

| Document | What it covers | Languages |
|---|---|---|
| [Configuration](configuration.md) | The workspace configuration (`WorkspaceConfig`), where data lives, secrets, export and import, the setup wizard | pt-BR, en |
| [Model providers](llm-providers.md) | The two agent engines, the providers each one supports, the connection test, what was tested, limits of local models | pt-BR, en |
| [Code hosts](vcs-providers.md) | GitLab, GitHub and Bitbucket: how the provider is chosen, token permissions, what agents may read, how writes are confirmed | pt-BR, en |
| [Development cycles](cycles.md) | The cycle templates (SDD, Scrum, Kanban, GitHub Flow, Minimal), stages, prompts, making and sharing your own | pt-BR, en |
| [Voice](voice.md) | Voice is optional: what "off" means, the call/chat wording, the voice setup, Edge and Kokoro engines | en |
| [Updates](updates.md) | How an installed app updates itself, channels, security of the update feed | pt-BR, en |

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
| [Decoupling inventory](decoupling-inventory.md) | What was personal and hardcoded before the configuration existed, and what replaced it |
| [Screenshots](images/README.md) | The planned screenshots and the rules for taking them |
