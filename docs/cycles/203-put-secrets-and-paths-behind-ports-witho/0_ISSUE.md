# 203 Put secrets and paths behind ports, without Electron

- Endereço: https://github.com/exatasmente/coxia/issues/203
- Estado: open
- Rótulos: enhancement, coxia, area:plataforma
- Autor: exatasmente

## Descrição

## What should happen

Secrets and paths stop importing `electron`. They become ports the host fills in: the desktop keeps the OS keychain and Electron's paths, and a headless host gives a master key file and plain folders.

This is the cheapest step with the largest effect. Of the 292 files under `src/main`, 13 import `electron` directly and **131 reach it through their imports**. Most of that goes through two files:

- `src/main/secrets.ts:5` imports `safeStorage` for the `keychain` `CryptoPort` (`:13-28`), and `secrets()` (`:37-40`) fixes it with no way to inject another. `createSecretsStore` in `secrets-core.ts` already takes `crypto`; only the caller is fixed. Imported by 7 files.
- `src/main/paths.ts:2` imports `app` for `app.getPath('userData')` (`:24-25`, the voice folders). Imported by 8 files.

With both behind ports, the files that reach `electron` drop from 131 to 16.

## Behaviour

- A `CryptoPort` that encrypts with a master key read from a file the host names (mode 0600, outside the data folder). The desktop keeps `safeStorage`.
- A `Paths` port for `userData` and the resource folders. Under Electron it keeps today's values; headless it is `<dataDir>/userData` (the same thing Electron does with `CERIMONIAS_DATA_DIR`).
- `secrets.json` keeps its format and its 0600 mode. Only `resolve()` returns a value, as today.

## Acceptance

- `secrets.ts` and `paths.ts` do not import `electron`, directly or through their imports.
- The desktop reads the existing `secrets.json` with no migration.
- A store created with the master key port round-trips a secret, and refuses to open with a different key.
- A missing or world-readable key file fails closed, with a message that never prints the key.

Checked against `release/0.9.0` at 0.9.0-beta.12 (`a1a7e6f7`). Line numbers move; re-check before planning.

## Comentários

(sem comentários)
