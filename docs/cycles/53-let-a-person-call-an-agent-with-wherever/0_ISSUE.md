# 53 Let a person call an agent with @ wherever they talk in the app

- Endereço: https://github.com/exatasmente/coxia/issues/53
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

A person can call an agent of the team with `@agent` only in a run's thread. Everywhere else, `@` is plain text and no agent answers:

- **Forum channels and general conversations.** Mentions are parsed in every thread (`personPost`, `src/main/forum.ts`), but the runner only answers a post whose thread starts with `run-` (`src/main/runner/service.ts`, the forum subscription that queues `answerMention`). The thread still shows "Called: <agent>" under the message (`src/renderer/src/screens/cycle/Thread.tsx`), so the screen says an agent was called when none was. The composer's hint says `@` does not call an agent in a channel, but the person has to notice it.
- **The ceremonies.** The daily call, the deep dive, re-entry, the QA handoff, the retro and the free answer of a gate all take a typed question or answer (`Call.tsx`, `Deep.tsx`, `Reentry.tsx`, `QaHandoff.tsx`, `RetroScreen.tsx`, `Gate.tsx`). There, only the ceremony's system agent answers. An `@developer` or `@product-owner` in that text reaches nobody.

The person wants to talk to an agent, not to work out where in the app talking to it is allowed.

## What you would like to happen

- **One rule:** wherever a person can write to the app, `@agent` calls that agent of the team, and the agent answers in the same place.
- **Forum:** in channels and general conversations, the called agent answers in the thread as it does in a run's thread. It gets what that place knows: the thread, the squad's mission in a squad channel, and the workspace's repositories to read.
- **Ceremonies:** in a ceremony, a mention makes the named agent answer in the ceremony. Its answer is spoken in the call like the system agent's, and goes into the minutes with its name. The card or issue being discussed is its context. The system agent keeps leading the ceremony and picks up after the answer.
- **Same limits as in a run's thread:** a mention never writes. The agent works read-only, over a throwaway copy of the code when it runs commands. An issue it proposes waits in Actions for the person's yes. The same limit of agents per message and the same idle and wall-clock limits apply.
- **What the screen says matches what happened:** "Called: <agent>" shows only when an agent was really called. An `@name` that matches no agent of the team is said to be unknown. While the agent works, the place shows that it is working (#29).
- **Phone (PWA):** the same, wherever the paired browser can write.

## Alternatives you considered

- **Keep `@` only in run threads and make the hint louder.** The person still cannot talk to an agent outside a run, and that is what this issue is for.
- **Open a new run thread whenever an agent is called outside a run.** That scatters the conversation and creates runs that have no issue.

## Notes

- To settle in refinement: whether a spoken name ("ask the developer") calls an agent in a voice ceremony, or only a typed `@`; what an agent reads in a channel with no squad; and whether answers in a channel are ever mirrored to the tracker (today a person's post is internal and never mirrored).
- The design behind today's restriction is that a channel is a conversation between people and the squads' links. This issue changes that on purpose.

## Comentários

(sem comentários)
