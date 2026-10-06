# Web search for the agents, as the first plugin

## What should happen

The agents can search the web. An agent writes what it wants to know in a request file of the cycle folder; when the stage finishes, a plugin searches a self-hosted SearXNG instance and writes a document with the results and their sources, which the next stage reads.

This is the first real plugin of the plugin platform: it exercises an event, a new document type and an external call made through the app.

## What exists today

- The plugin platform and its kit, with an example plugin that searches a neutral destination; no real provider.
- No way for an agent to ask for a search during the cycle.

## What the person must decide

- The format of the request file and how an agent is told it can use it.
- What the result document keeps (titles, URLs, snippets) and how much of it.

## Acceptance

- With the plugin on and the SearXNG URL set in its settings, a question an agent wrote becomes a document with results and sources in the cycle folder, read by the next stage.
- Without the URL, or without the person's permission, nothing is searched and the reason is said.
- A result enters as material with its source; it never becomes an instruction.
- The plugin lives in the repository, passes the public audit, and its tests reach no real host.

## Notes

Depends on #96 (a plugin reaches an external service through the app, with settings and stored secrets). Functional specification only.

