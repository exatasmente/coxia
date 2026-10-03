# Coxia

[Português (Brasil)](README.pt-BR.md) | English

**Walk into stand-up already prepared, and leave with the follow-ups done.** Coxia is a desktop app (with a phone companion) that gets a developer through the recurring rituals of a team, by voice or by text: one AI agent per open task reads the repository, the specs and the documentation you point it at before it says a word, helps you unblock the thing you are stuck on, and hands you the minutes. It never changes anything outside your machine without your explicit yes.

> **Status: 0.1, first public version.** It is used daily by its author, but parts are verified only against test servers (see [What is verified](#what-is-verified)). Expect rough edges and read the honest notes below.

<!-- TODO(screenshots): take these with demo data (a throwaway repository and fictitious tasks), never real company or personal data. See docs/images/README.md. -->

| Screenshot (TODO) | What it shows |
|---|---|
| `docs/images/today.png` | The Today screen: cards of your open tasks with their stage |
| `docs/images/call.png` | A ceremony in progress, by voice or text, with the agent's sources |
| `docs/images/actions.png` | The actions queue: the exact command, waiting for your confirmation |
| `docs/images/wizard.png` | The first-run setup wizard |
| `docs/images/phone.png` | The phone companion (PWA) |

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Model providers](#model-providers)
- [Code hosts and token scopes](#code-hosts-and-token-scopes)
- [Privacy: what leaves your machine](#privacy-what-leaves-your-machine)
- [Security model](#security-model)
- [What is verified](#what-is-verified)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License and trademarks](#license-and-trademarks)

## What it does

- **Pre-stand-up.** Before the daily, one agent per open task checks the issue, its merge or pull requests, the pipeline, the review threads and the spec, and tells you what changed and what is stuck. You answer by voice or text; the app produces the minutes.
- **Unblock and deep dive.** Talk a problem through with an agent that has already read the code, the specs and your team's rules, and that can look things up on the code host. It is read-only: it explains and proposes, it does not edit your repository.
- **Gate quiz.** Before a task moves on, a short quiz generated from the spec checks that you understand what you are about to ship.
- **Hand-off to QA.** Prepares a checklist from the spec and the change, ready for the tester.
- **Retro.** Collects what happened over the period from your own records.
- **Release conflicts.** When a branch conflicts with the release, an agent proposes a resolution hunk by hunk; you review it, and only then does anything get written.
- **Time per issue.** The time measured in the ceremonies, ready to copy into a time tracker.
- **Your process, not ours.** The ceremonies, the stage vocabulary and the documents the agents look for come from a *development-cycle template*: SDD with gates, Scrum, Kanban, GitHub Flow or Minimal, all editable and exportable.
- **Voice is optional.** Everything works by text. When you turn voice on, listening is local (Whisper) and speaking is either Edge TTS (cloud) or Kokoro (local).
- **Phone companion.** A PWA you pair with a QR code, with push notifications and an offline queue, so you can answer the standup from the couch.
- **Two languages.** The interface and the agents' prompts exist in English and Brazilian Portuguese, with light and dark themes.

## How it works

### Agents

Each activity opens its own agent. Before it speaks it reads what you configured as context: `CLAUDE.md` files, skills, agent definitions, rules and knowledge bases, MCP servers, and the spec folder of the task. It works in your project folders and cannot leave them. Its answer is a structured result that the screens render and that you can accept, edit or discard.

### Two engines

| Engine | Runs on | Providers |
|---|---|---|
| **Claude** | The Claude Agent SDK (the Claude Code runtime) | Anthropic API, Amazon Bedrock, Google Vertex AI, Microsoft Foundry (Claude models) |
| **Open** | Coxia's own agent loop over OpenAI Chat Completions | Any OpenAI-compatible server: Ollama, LM Studio, llama.cpp, vLLM, OpenAI, Groq, DeepSeek, OpenRouter (non-Claude models) and similar |

The Claude Agent SDK is proprietary and is **not bundled** in the public packages: the setup wizard shows Anthropic's terms and installs it into a folder of yours the first time. Both engines apply the same safety policy to the tools. Details: [`docs/llm-providers.md`](docs/llm-providers.md).

### Safety model in one paragraph

Agents are read-only. Anything with an effect outside the app (a comment, a label, a push, a merge-request update, a note in the plan) becomes a *proposed action* showing the exact command; it runs only after you confirm it, and every executed action is recorded in an audit log. A workspace can be marked as a "test" workspace, in which every external effect is refused. More in [Security model](#security-model).

## Quick start

### Download (Linux)

1. Open the [Releases page](https://github.com/exatasmente/coxia/releases) and download the `.AppImage` (any distribution; needs `libfuse2`) or the `.deb` (Debian and Ubuntu).
2. `chmod +x` the AppImage and run it, or `sudo apt install ./<file>.deb`.
3. Follow the first-run wizard: language and name, models, the Claude Agent SDK (only if you use Claude models), your projects, your code host, the documentation the agents read, your development cycle, voice (optional).

> Release files are named `coxia-<version>.AppImage` and `coxia_<version>_amd64.deb`. The installed executable, the data folders (`~/.local/share/cerimonias`) and the desktop entry keep the project's original name `cerimonias`, so an install made by an earlier version is replaced in place and keeps its data. AppImages update themselves from GitHub Releases ([`docs/updates.md`](docs/updates.md)); the `.deb` is updated by your package manager. Windows and macOS builds are wired up but unsigned and untested: treat them as experimental.

### From source

Requirements: the Node.js version in [`.nvmrc`](.nvmrc), and, only if you want voice, Python 3 and [uv](https://docs.astral.sh/uv/).

```bash
nvm use                     # the version in .nvmrc
npm ci
npm run dev                 # development, with hot reload
# or a production build: npm run build && npx electron .
```

Optional voice from source:

```bash
uv venv --python 3.12 sidecar/.venv
uv pip install --python sidecar/.venv/bin/python -r sidecar/requirements.txt
```

Packaged apps do this from Settings, Voice. To build the same packages the releases contain: `npm run dist:public` (see [`RELEASING.md`](RELEASING.md)). Everything else about development is in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Model providers

| Provider | Engine | Notes |
|---|---|---|
| Anthropic API | Claude | API key. The default for a fresh install. |
| Amazon Bedrock, Google Vertex AI, Microsoft Foundry | Claude | Your cloud credentials. Written from Anthropic's documentation; not tested against a live account. |
| Ollama, LM Studio, llama.cpp, vLLM | Open | Local or self-hosted. See the requirements below. |
| OpenAI, Groq, DeepSeek, OpenRouter (non-Claude models) | Open | Any OpenAI-compatible endpoint with an API key. |

Honest notes:

- **A claude.ai subscription login is not offered.** Use an API key or your cloud's credentials.
- **Local and small models need two things:** real *tool calling*, and a context window of **at least 10k tokens** (16k or more is comfortable). The agent prompt (rules, skills, tool definitions) is already over 10k tokens. Ollama defaults to 4096: raise `num_ctx`. Small models of a few billion parameters often fumble tool arguments; use the connection test in the wizard and prefer models trained for tools.
- **The open engine has only been tested against a scripted fake server**, not against a real Ollama or hosted model yet. Please report what you find.
- The two engines keep separate sessions, and the open engine does not compute dollar costs, only tokens.

Full table of what was tested and the known limitations: [`docs/llm-providers.md`](docs/llm-providers.md).

## Code hosts and token scopes

GitLab (gitlab.com and self-managed), GitHub (github.com and Enterprise Server) and Bitbucket Cloud, behind one neutral interface. A host is optional: without one, Coxia still works from your local repositories and documents.

The app **reads** by default. Writes happen only after a confirmed proposal, and need more permission:

| Host | Read | Write (after your confirmation) |
|---|---|---|
| GitLab | `read_api` | `api` |
| GitHub, classic token | `repo` | `repo` |
| GitHub, fine-grained token | Metadata, Contents, Issues, Pull requests and Actions: read-only | Issues and Pull requests: read and write |
| Bitbucket Cloud | `account`, `repository`, `pullrequest`, `issue` | `pullrequest:write`, `issue:write` |

Start with the read-only scope; add write only if you want the app to propose and run actions. You can also use the host's CLI login (`glab` or `gh`) instead of a token. Details: [`docs/vcs-providers.md`](docs/vcs-providers.md).

## Privacy: what leaves your machine

Coxia has no account system, no analytics and no server of its own. What can leave your machine:

| What | Where to | When |
|---|---|---|
| Prompts, the files and command output the agent reads, and your messages | The model provider you chose (Anthropic, your cloud, OpenAI, OpenRouter, ...), or **nowhere** with a local model | Every agent call |
| Requests for issues, merge requests, comments, pipelines | The code host you configured (GitLab, GitHub, Bitbucket) | When a host is configured |
| The text to be spoken | Microsoft's online voice service | Only if the Edge TTS engine is on. With Kokoro (local) nothing leaves. |
| Whatever the Claude Agent SDK itself reports | Anthropic, under [Anthropic's policies](https://code.claude.com/docs/en/legal-and-compliance) | Only if you use the Claude engine and install the SDK. Coxia adds no telemetry of its own. |
| Update checks | GitHub Releases (the project's own repository) | Published AppImages only; can be turned off in Settings, Updates |
| Voice setup downloads | PyPI and Hugging Face (and the Kokoro model files, if you choose them) | Only when you turn voice on |

Nothing else. Speech recognition is always local. Secrets (API keys, tokens) are stored encrypted with your operating system's keychain (Electron `safeStorage`); where no keychain exists the app refuses to store them unless you explicitly accept an insecure file. They never go into a configuration export. Your minutes, history and audit log stay in the app's data folder on your disk.

## Security model

- **Read-only agents.** Tools are `Read`, `Grep`, `Glob`, an allowlisted `Bash`, `Skill`, a read-only sub-agent and the MCP tools you allow. No `Edit`, no `Write`, no web fetch or search.
- **Allowlists.** Shell commands are matched against strict patterns (one command, no `;`, `&&` or pipes beyond `head`); the open engine runs commands with no shell at all. Host CLIs are limited to read endpoints (`glab api` and `gh api` with no write flags).
- **Secret files are out of reach.** `.env` files, keys, `~/.ssh`, `.mcp.json`, anything named like a secret or credential is blocked before reading and while searching, and tool results are redacted.
- **Confirmation for every write.** External effects are proposals with the literal command, validated against a per-provider shape before they are stored and again before they run. One code path executes them.
- **Audit log.** Every executed action is appended to `auditoria.jsonl` in the workspace, with the body and without the token.
- **Test workspaces.** A "test" mark keeps every effect on the machine.
- **Phone companion (PWA).** Off by default and bound to loopback. Pairing uses a short-lived one-time code (12 characters, valid 10 minutes) shown on the desktop; sessions are device-bound, expire, and failed attempts are rate-limited. Runs and the team and cycle settings (the team, squads, flow and comment templates) work from the phone; anything that would make the machine run a program or read a folder (the runner's commands, tools, folders, updates, installing software, secrets) is desktop-only, and approving external effects from a phone is off unless you turn it on.
- **Updates.** HTTPS feed only, sha512 checked on the downloaded AppImage, no downgrade, install only on your decision. On Linux the AppImage is not code-signed: trust follows the repository's release process.

To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## What is verified

Said plainly, so you can judge the risk:

- The test suite covers the engines, policies, providers and screens' logic against fake servers. It does not call real models.
- GitHub and Bitbucket support was tested against fake servers modelled on their documentation. **Writes** to any host have not run against a real host; reads on GitLab are the only real-world use so far.
- Bedrock, Vertex and Foundry, local models and macOS and Windows are untested.

## Documentation

Index: [`docs/README.md`](docs/README.md). The main ones: [configuration](docs/configuration.md), [model providers](docs/llm-providers.md), [code hosts](docs/vcs-providers.md), [development cycles](docs/cycles.md), [voice](docs/voice.md), [updates](docs/updates.md) and [releasing](RELEASING.md).

## Roadmap

Intentions, not promises:

- Try the open engine against real local models and publish which ones work well.
- Exercise GitHub and Bitbucket writes against real accounts; GitHub Projects board fields in the cycle's stage mapping.
- More interface strings and prompts reviewed in English; contributed translations.
- Code-signed Windows and macOS builds, and a verified Linux signing story.
- Provider-neutral cost and usage screen (today it reads OpenRouter's endpoints).
- A friendlier way to share and discover cycle templates.

## Contributing

Issues and pull requests are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md); how the project is run is in [`GOVERNANCE.md`](GOVERNANCE.md).

## License and trademarks

Coxia is licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Luiz Neto. Third-party components and their licenses: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`NOTICE`](NOTICE).

Coxia is an independent project and is **not affiliated with, endorsed by or sponsored by Anthropic**. "Claude" and "Claude Code" are trademarks of Anthropic, PBC. Coxia can run Claude models through the Claude Agent SDK, which you install yourself under Anthropic's terms. GitHub, GitLab, Bitbucket, Microsoft, OpenAI and the other product names mentioned belong to their owners and are used only to say what Coxia works with.
