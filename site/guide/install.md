# Install

Coxia is a desktop app for Linux, macOS and Windows, with a phone companion you open in the
browser. It is built and run from source today.

```bash
nvm use                 # the Node version in .nvmrc
npm ci
npm run dev             # Electron with hot reload
```

The setup is the repository's own, and it is kept in one place: read
[CONTRIBUTING.md](https://github.com/exatasmente/coxia/blob/main/CONTRIBUTING.md) in the repository
for the version of Node, the optional voice sidecar and the throwaway data folder to develop
against.

**What you should see:** the app window opening on the Today screen, with nothing in it yet. The
next step points it at a repository.

<!-- site:image-placeholder -->
> **Screenshot (pending).** The Today screen of a fresh install. Taken from the app over a seeded
> workspace with fictitious data, refreshed with each release.
