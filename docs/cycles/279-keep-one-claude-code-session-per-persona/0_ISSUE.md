# 279 Keep one Claude Code session per persona conversation instead of one per message

- Endereço: https://github.com/exatasmente/coxia/issues/279
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

Talking to the persona through a keyless `anthropic` provider (the signed-in Claude Code CLI) opens a new Claude Code session for every message of the conversation. The persona's answer is a fresh engine call each time: nothing carries the session of the previous message, so the machine collects one session per message and the persona rebuilds its context from the thread every turn.

## What should happen

- One conversation with the persona keeps one engine session: the next message resumes the session of the previous answer instead of starting a new one, while that session is still valid.
- When the session cannot be resumed (expired, removed, another process holds it, the provider changed), the answer starts a new session and the thread goes on as today; the person is not asked anything.
- A scheduled wake-up (#275) and an answer the persona gives after a stop follow the same rule.
- The open engine keeps the behavior it has today, unless the plan finds a cheap equivalent.

## Boundaries

- Nothing from `~/.claude` (session ids, transcripts) goes into tests or fixtures.
- The persona's tools, its door, the stop and the audit are unchanged.

## Acceptance

- Three messages in a row to the persona through the signed-in CLI produce one Claude Code session, not three.
- Removing that session makes the next message open a new one with no error in the thread.
- Tests with a fake SDK cover resume, the fallback to a new session and the scheduled wake-up.

Split from #262 (deliveries 1 and 2 cover the sessions screen; this one is the persona's own conversation).

## Comentários

(sem comentários)
