# Governance

Coxia is a small project with a single maintainer. This document says how decisions are made so that contributors know what to expect. It will grow if the project does.

## Roles

- **Maintainer.** Has write access, reviews and merges pull requests, cuts releases, handles security reports and enforces the [Code of Conduct](CODE_OF_CONDUCT.md). The current maintainer is listed in [`MAINTAINERS.md`](MAINTAINERS.md).
- **Contributor.** Anyone who opens an issue, a discussion or a pull request. There is no formal membership; see [`CONTRIBUTING.md`](CONTRIBUTING.md).

A contributor who has made several sound contributions over time may be invited to become a maintainer. Maintainers can step down at any time, and a maintainer who is inactive for a long period may be moved to emeritus status.

## Decisions

- Day-to-day changes are decided in pull requests: they need a maintainer's approval and a green CI.
- Larger changes (a new provider kind, a change to the safety model, a change to the configuration format, a new dependency with a copyleft or unclear license) start as an issue. The maintainer decides after discussion, and records the reasoning in the issue or the pull request.
- The safety model is a project priority. A change that widens what an agent, the phone companion or the update path can do needs an explicit justification and tests; the maintainer may decline it even if it is convenient.
- Releases follow [`RELEASING.md`](RELEASING.md): a maintainer tags, CI builds a draft, a maintainer checks and publishes it.

## Disagreements and conduct

Discuss disagreements in the issue or pull request, in a respectful way. If a discussion stalls, the maintainer makes the call. Conduct problems are handled as described in the [Code of Conduct](CODE_OF_CONDUCT.md); security problems as described in [`SECURITY.md`](SECURITY.md).

## Changing this document

By pull request, approved by the maintainer. When there is more than one maintainer, decisions here need the agreement of the majority of them.
