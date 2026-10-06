---
checked-commit: 0000000
checked-date: 2000-01-01
evidence: [src/main/engine/contract.ts, src/main/engine/registry.ts, src/main/engine/guard.ts, src/shared/wizard.ts, src/main/llm-core.ts, test/engine-open-tools.test.ts, test/helpers/fakeOpenAI.ts, docs/llm-providers.md:1-80]
summary: The two agent engines, the providers each supports, the connection test and what was verified
stages: [development]
roles: [developer]
---

# Model providers

Coxia has **two agent engines**. The engine decides how the call runs; the provider decides
where it goes.

| Engine | Runs on | Providers |
|---|---|---|
| **Claude** (`claude-sdk`) | The Claude Agent SDK (the Claude Code runtime) | Anthropic API, Amazon Bedrock, Google Vertex AI, Microsoft Foundry: Claude models |
| **Open** (`open`) | Coxia's own agent loop over OpenAI Chat Completions | Any OpenAI-compatible server: Ollama, LM Studio, llama.cpp, vLLM, OpenAI, Groq, DeepSeek, OpenRouter and similar (non-Claude models) |

Why two: Anthropic does not support pointing the Claude Code runtime at non-Claude models
through any gateway. The open engine does not go through the Claude Code binary: it is the
app's own loop (model, tools, answer), under the same safety policy.

## The engine contract

`runOpenOnce` implements the same contract `agents.ts` passes to the SDK's `query()` and
returns what `runOnce` returns: input is the role, the prompt, the `json_schema` output,
`maxTurns`, `resume`, the allowed and disallowed tools, the hooks, `additionalDirectories`,
the appended system prompt and `tools: []` (no tool at all); output is
`{ data, sessionId, sources }`. When `maxTurns` runs out it throws the same error as the
Claude path, and `agents.ts` makes the single resume with no tools and returns the partial
answer. Open-engine sessions live in `<workspace data>/open-sessions/<id>.jsonl`.

A new engine implements the contract in `src/main/engine/contract.ts` and registers with
`registerEngine` (`src/main/engine/registry.ts`). It must apply the same hooks as the others
(`shellAllowlist`, `noSecrets`, `redactSecretResults`) and show the same refusals in a test,
as `test/engine-open-tools.test.ts` does.

## Adding an OpenAI-compatible provider

The common case needs no engine code: add a preset to `OPEN_PRESETS` in
`src/shared/wizard.ts` (base URL, suggested models, headers if any) and its label to both
wizard catalogs. Check it with the connection test (`probeOpenAIProvider`) and add what the
server does differently to `test/helpers/fakeOpenAI.ts` and the `test/engine-open-*.test.ts`
files. State in `docs/llm-providers.md` whether you tested it against the real thing.

`probeOpenAIProvider(baseUrl, key, model, { lang })` returns `{ reachable, ok, models, chat,
tools, jsonSchema, capabilities, messages }`: it reaches the server and lists `GET /models`
(including the context window when the server reports it), does a simple answer, a tool call,
and `response_format` with `json_schema`. `capabilities` feeds the engine.

## Adding a way to reach Claude models

Add the kind to `PROVIDER_KINDS` (`src/shared/config/types.ts`), map its settings to the
SDK's environment in `src/main/llm-core.ts`, and add it to the wizard's models step and to
`test/config-*.test.ts`. A claude.ai subscription login is never offered: only an API key or
your cloud's credentials.

## Structured output

The app depends on a validated JSON answer. Order of preference (`structured: 'auto'`):
`response_format: json_schema` when the connection test confirmed it; the `final_answer` tool
with forced `tool_choice` when the model answers in text; a prompt with the schema plus JSON
repair and one correction round. In all three cases the answer is validated against the
schema, and fields the schema forbids are pruned first. A server that refuses
`response_format` or `tool_choice` is remembered and no longer receives the parameter; a model
that says it does not support tools falls back to prompt mode without tools.

## Local models

A local or small model needs two things: real **tool calling**, and a context window of at
least 10k tokens (16k or more is comfortable) — the agent prompt is already over 10k tokens.
Ollama defaults to 4096, so raise `num_ctx`. Use the wizard's connection test and prefer
models trained for tools.

## What was verified

The open engine has been tested only against a scripted fake server, not against a real Ollama
or a hosted model. The two engines keep separate sessions, and the open engine computes
tokens, not dollar costs. Bedrock, Vertex and Foundry were written from Anthropic's
documentation and not tested against a live account. The full table is in
`docs/llm-providers.md`.
