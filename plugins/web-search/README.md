# Web search plugin

Lets the agents of a run search the web through a SearXNG instance of your own. When a
stage ends, the questions an agent wrote in `SEARCH_REQUESTS.md` (one per list item,
`- question`) are searched, and the next stage reads `WEB_SEARCH.md` with up to five
results per question — title, address and snippet — and their sources. A question
already answered is not searched again; up to five new questions per stage. A
conversation can also call it at any moment, writing `/web-search <question>`: the answer
comes back in that conversation with its sources, and in a run's conversation the same
text is kept in `WEB_SEARCH.md`, over what was there.

## Setting it up

1. **A SearXNG instance with JSON on.** In its `settings.yml`, `search.formats` must
   include `json` (for example `[html, json]`). A local one (`http://localhost:8888`)
   works: the app makes the call, not the plugin's sandbox.
2. **The plugin folder.** In Settings › Plugins, point the plugins folder at the
   `plugins/` folder of a Coxia checkout, or copy `plugins/web-search/` into the
   workspace's own plugins folder.
3. **The address.** In the plugin list, fill in *SearXNG address* and switch the plugin on.
4. **The permission.** The first time it searches, the plugin asks for the network in
   Actions; allow it once, for the session or always.

The agents learn about it from the plugin itself: while it is on, every stage's context
carries the plugin's note saying how to ask for a search. A stage whose flow lists the
documents it reads (`reads`) must list `WEB_SEARCH.md` to see the results.

## What it sends

Only the questions, as `q`, with `format=json`, to the address you set. Everything the app
sends for the plugin is in the audit log (without the query).
