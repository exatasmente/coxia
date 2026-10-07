# 59 Bring the open engine's wizard note and provider docs up to date

- Endereço: https://github.com/exatasmente/coxia/issues/59
- Estado: open
- Rótulos: documentation, coxia, priority:medium
- Autor: exatasmente

## Descrição

## The problem

Two texts about the open engine no longer match the code:

- **The wizard says the open engine only reads.** `wizard.models.openEngineNote` ("this provider runs on the open engine: read-only tools…") shows under every non-Claude provider kind (`src/renderer/src/wizard/steps/ModelsStep.tsx`). The engine gives `Write` and `Edit` when the call has a write root, allowlisted `Bash`, and the MCP tools the call allows, including the sandbox's `Shell` (`src/main/engine/open/loop.ts`). A runner agent with `worktree` permission writes on it. A person reading the note would think the runner cannot use an open-engine provider.
- **`docs/llm-providers.md` describes a test hook as the way to pick the engine.** It says the selection "for now" is a set of environment variables (`COXIA_ENGINE=open`, `COXIA_LLM_OPENAI_*`) that "the configuration layer will replace". The configuration layer exists: each provider in `llm.providers` has `kind` and `engine`, and the roles pick a provider.

## What you would like to happen

- **Fix the note, in both catalogs.** It says what is true: the open engine is the app's own agent loop, it reads, writes in the worktree and runs commands under the same policy as the Claude Agent SDK, and quality depends on the model.
- **Rewrite the selection section of `docs/llm-providers.md`, in both languages.** It describes the provider → engine choice in `llm.providers`. The environment hook stays only as a test aid, if it is still used.
- **Update the coverage table** for what has run on the open engine since then.

## Comentários

(sem comentários)
