# 60 Add a DeepInfra preset for the open engine

- Endereço: https://github.com/exatasmente/coxia/issues/60
- Estado: open
- Rótulos: enhancement, coxia, priority:medium
- Autor: exatasmente

## Descrição

## Scope (updated 2026-10-06)

The DeepInfra preset only: one entry in the open engine's presets (base URL, key required, where to get the key), a line in `docs/llm-providers.md`, and any new text in both catalogs. The wizard warning for an unrecognized model is left out.

---

## The problem

DeepInfra serves an OpenAI-compatible API at `https://api.deepinfra.com/v1/openai` with the same open models that are used through other gateways, and passes the app's connection test on the open engine (chat, tool calls and JSON schema). It is not one of the presets, so a person has to pick "another address" and know the URL.

It also has an Anthropic-shaped endpoint (`https://api.deepinfra.com/anthropic`), which looks like a way to keep the Claude Agent SDK. It does not work for non-Claude models. That endpoint has no `/v1/models`, so the Claude Code binary rejects the model name before sending anything (`unrecognized_model`), even with gateway model discovery on. The setup only fails at the first call.

## What you would like to happen

- **A DeepInfra preset for the open engine:** base URL `https://api.deepinfra.com/v1/openai`, key required, the key page as `keyUrl`, and a suggested model the connection test then replaces with the listed ones.
- **A warning in the wizard:** when an `anthropic` provider on the Claude Agent SDK points at a non-Anthropic `baseUrl`, the SDK connection test is run before the provider is saved. If it fails with an unrecognized model, the message says to use the open engine with the provider's OpenAI-compatible address.
- **`docs/llm-providers.md`** lists DeepInfra with what was tested.

## Comentários

### exatasmente, 2026-10-06T19:02:29Z

Escopo reduzido ao preset do DeepInfra no motor aberto, com a linha em `docs/llm-providers.md`; o aviso no wizard para `unrecognized_model` fica para outra issue, se fizer falta. Prioridade sobe para média: é o provedor em uso neste workspace.
