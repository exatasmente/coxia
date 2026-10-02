# Security policy

Coxia handles things people care about: API keys, code-host tokens, the contents of repositories and the minutes of team meetings. Reports that help us protect them are welcome.

## Supported versions

Only the latest published release receives security fixes. While the project is in the 0.x series, that means the latest `0.x` version on the [Releases page](https://github.com/exatasmente/coxia/releases). Installed AppImages update themselves; if you use the `.deb` or a build from source, update to the latest release before reporting.

| Version | Supported |
|---|---|
| Latest release (stable channel) | Yes |
| Latest pre-release (beta channel) | Best effort |
| Anything older | No |

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.** Report it privately with GitHub's *private vulnerability reporting*:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** (a GitHub Security Advisory draft, visible only to you and the maintainers).

<!-- TODO(maintainer): enable "Private vulnerability reporting" under Settings > Code security before the repository is made public, and optionally add a monitored security email here. -->

Include what you can: the version, your operating system, which engine and provider were in use, what you did, what you expected, what happened, and a proof of concept if you have one. **Do not include real keys, tokens or private repository content**; use throwaway credentials and a demo repository.

What to expect, from a project with one maintainer, so these are goals and not guarantees:

- an acknowledgement within 7 days;
- an assessment and a plan within 30 days;
- a fix in a new release and a published advisory when the issue is confirmed; we will credit you if you want, and we ask you to give us a reasonable time to ship the fix before you disclose.

We will not take legal action against people who research and report in good faith, stay within the scope below, do not access other people's data and do not degrade a service for others.

## Scope

In scope: the Coxia application, its packaging and its update channel.

- **Agent tool escapes.** An agent doing anything its policy forbids: writing or changing files, running a command outside the allowlists (shell metacharacters, argument tricks, a CLI write flag), reading outside the project folders and documentation folders, getting around the secret-file rules, or making a call with an effect without the confirmation flow. This applies to both engines (Claude and open).
- **Prompt injection that leads to an effect.** Content from an issue, a merge request, a document or a tool result that makes an agent or the app act outside what the person confirmed.
- **Secret leakage.** An API key, token or other secret reaching a log, the audit log, an export, the renderer, a screenshot, the model's context or the network where it should not. Secrets are meant to stay in the OS keychain store and never appear in exports or error messages.
- **PWA and browser access.** Pairing and session handling, the rate limits, the desktop-only restrictions, cross-origin or cross-site request problems, access to another device's data, push subscription abuse, the offline queue.
- **Update feed and installers.** Anything that lets someone deliver a different build than the one released: feed parsing, checksum verification, downgrade, the install path, the `update.sh` and `install-local.sh` scripts, the release workflow.
- **The configuration import.** A crafted file that makes the app run a program, read a path or store a secret without the person seeing it in the preview.
- **The voice setup.** Installing software or downloading models in an unsafe way.

Out of scope:

- Vulnerabilities in third-party services or software themselves (the model providers, the code hosts, Electron, the Claude Agent SDK, Python packages): report those to their owners. Tell us if Coxia uses them in an unsafe way.
- Attacks that need an already compromised machine, the user's own account, or physical access, and issues that only exist when the user turns a protection off on purpose (for example accepting the insecure secrets file, or approving external effects from the phone and then approving something harmful).
- Model behavior that is only a quality problem (a wrong answer, a refusal) with no policy bypass.
- Findings from automated scanners without a demonstrated impact, missing hardening headers on a loopback-only server, and denial of service against your own machine.
- The AppImage not being code-signed on Linux. This is documented ([`docs/updates.md`](docs/updates.md)).

## Hardening you control

Use the narrowest token that works (read-only scopes unless you want the app to propose writes), keep the phone companion off unless you need it, put it behind HTTPS if you expose it beyond the machine, and use a test workspace to try anything new. The [README](README.md#security-model) summarizes the security model.
