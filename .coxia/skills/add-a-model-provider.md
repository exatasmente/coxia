---
checked-commit: 1a0858c59ed1d4c43e03feb3e709bbefd8441336
checked-date: 2026-10-06
evidence: [CONTRIBUTING.md:127-131, src/shared/wizard.ts, src/main/llm-core.ts, src/main/engine/contract.ts, src/main/engine/registry.ts, test/engine-open-tools.test.ts, test/helpers/fakeOpenAI.ts, docs/llm-providers.md:1-80]
summary: The steps to add a model provider, from an OpenAI-compatible preset to a new engine
stages: [development]
roles: [developer]
---

# Add a model provider

There are three shapes of change. Read `rules/model-providers.md` for the engines and the
contract first.

## An OpenAI-compatible server or service (the common case)

No engine code.

1. Add a preset to `OPEN_PRESETS` in `src/shared/wizard.ts` (base URL, suggested models,
   headers if any) and its label to both wizard catalogs.
2. Check it with the connection test (`probeOpenAIProvider`).
3. Add what the server does differently (error wording, `reasoning` fields, parameters it
   rejects) to `test/helpers/fakeOpenAI.ts` and the `test/engine-open-*.test.ts` files.
4. State in `docs/llm-providers.md` whether you tested it against the real thing.

## A new way to reach Claude models (another cloud)

1. Add the kind to `PROVIDER_KINDS` (`src/shared/config/types.ts`); the JSON Schema is derived
   from it.
2. Map its settings to the SDK's environment in `src/main/llm-core.ts`.
3. Add it to the wizard's models step and to `test/config-*.test.ts`.

A claude.ai subscription login is never offered: only an API key or cloud credentials.

## A new engine (a different agent runtime)

1. Implement the contract in `src/main/engine/contract.ts`.
2. Register it with `registerEngine` (`src/main/engine/registry.ts`).
3. It must apply the same hooks as the others (`shellAllowlist`, `noSecrets`,
   `redactSecretResults`) and show the same refusals in a test, as
   `test/engine-open-tools.test.ts` does.

Every step is subject to `rules/build-and-test.md` (no test reaches a real model or the
network) and `rules/public-repo.md` (no real host, person or key anywhere).
