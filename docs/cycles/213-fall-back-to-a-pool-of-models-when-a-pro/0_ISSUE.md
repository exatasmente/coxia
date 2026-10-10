# 213 Fall back to a pool of models when a provider is busy, with a model per activity

- Endereço: https://github.com/exatasmente/coxia/issues/213
- Estado: open
- Rótulos: enhancement
- Autor: exatasmente

## Descrição

## What should happen

A stage of a run fails when the provider refuses with a rate limit or an overload ("Model busy, retry later"), even when other models of the same provider, or other providers, are free. The refusal is per model: retrying the same model keeps failing, and the person has to press "Try again" by hand.

Each LLM role keeps an ordered **pool** of models (provider + model), from the cheapest to the most expensive. When a model is busy, the call moves to the next one in the pool and the stage goes on. Within a role, each **activity** of an agent (exploring the code, editing, running commands, working on the virtual screen, writing documents) can have its own pool, so every activity runs on the model that fits it best. The pool is suggested from the provider's own catalog (price, context, tools, structured output, vision, prompt cache) where the provider publishes one.

## Behaviour

- **Pool per role.** `turn`, `reply`, `deep`, `teams`, `fix` and each agent with an explicit model keep an ordered list. The first entry is today's model; the rest are fallbacks. An existing workspace has no fallbacks, and nothing changes for it.
- **Switching.** After the client's own retries, a rate limit or overload moves the call to the next model of the pool, in the same session of the open engine (the history is replayed; only the prompt cache is lost). The busy model rests for the provider's `Retry-After`, or a few minutes, across the whole app, so other runs skip it. When every model of the pool is busy, the stage fails as today, saying so.
- **Activities.** A turn's activity comes from what it answers: a screenshot (screen), a command's output (shell), a file read or search (explore), an edit (edit), and the start of a stage or a ceremony (write). An activity without its own pool uses the role's pool. An activity that needs a capability (images for the screen) only uses models that have it.
- **Catalog.** Testing a provider's connection reads its model catalog where it lists prices and capabilities (for instance the `/models` of OpenAI-compatible providers that carry `pricing` and tags). It suggests a pool per role and activity: models with tools and structured output, a context large enough, ordered by the estimated cost of a typical stage (cached input, uncached input, output). The person reviews and saves the suggestion; nothing is saved on its own.
- **Visible.** Every switch shows in the run's thread (which model was busy, which one took over). The usage of each call keeps the model that answered it.
- **Retry fix.** A `Retry-After` from the server counts as an attempt, so the client never retries the same model without bound.
- Only providers of the open engine take part in a switch inside a session. A pool entry on the Claude Agent SDK is used only at the start of a stage, never in the middle of an open-engine session.

## Acceptance

- A busy refusal on the first model of a pool moves the stage to the next model with no click, and the thread says so.
- A busy model is skipped by other runs while it rests; it comes back after the rest.
- A pool with every model busy fails the stage with a message that names the pool, not a single model.
- A turn that answers a screenshot only runs on a model with images.
- The suggestion orders models by the estimated cost of a stage and leaves out models without tools or structured output; the person saves it explicitly.
- A workspace without a pool behaves exactly as before. The config schema migrates without raising any permission.
- The client never retries one model past its limit, with or without `Retry-After`.


## Comentários

Nenhum.
