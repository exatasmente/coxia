# 107 Call a plugin from a conversation

- Endereço: https://github.com/exatasmente/coxia/issues/107
- Estado: open
- Rótulos: enhancement, coxia, priority:medium
- Autor: exatasmente

## Descrição

## What should happen

A person (or an agent) can call a plugin from a conversation of the forum — for example `/web-search how does replay work?` — and the plugin's answer comes back in the same conversation, as material with its sources. Today a plugin only runs on the four events of a run's cycle; a mention or a message never reaches one.

## What the person must decide

- How a plugin is called: a slash command, a mention, or both, and how that is told apart from calling an agent.
- Whether a plugin's answer inside a run's conversation also goes to the run's cycle folder (for the web search, `WEB_SEARCH.md`).
- Whether a paired phone may call a plugin (today it may refuse a request or block a write, never allow one).

## Acceptance

- The fixed event catalog of the kit gains an event for a call from a conversation, with what was asked, the conversation and the run (when there is one) in the plugin's context; a plugin opts in by declaring it.
- The answer is posted in the conversation, inside the material fence, never as an instruction.
- The permission contract is the same: the network and writes a plugin needs are asked in Actions; a test workspace widens nothing.
- A plugin that is off, refused or missing a required setting cannot be called, and the conversation says why.

## Notes

Follows #84, #96 and #97. The web search is the first plugin that would use it.

## Comentários

(sem comentários)
