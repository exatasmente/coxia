# 145 Let a person create and adjust an agent with AI, through questions the model writes and a test conversation

- Endereço: https://github.com/exatasmente/coxia/issues/145
- Estado: open
- Rótulos: enhancement
- Autor: exatasmente

## Descrição

## The problem

Creating an agent today means filling a form by hand: name, job, a free-text instruction box, a model, two permissions, the tools, the stages, a squad and who it turns to (`AgentPanel`, `src/renderer/src/screens/team/TeamSection.tsx`). The part that matters most — the instructions — is a blank text area. A person who knows what they want the agent to do, but not how to write a good prompt or which permission it needs, has to work that out alone, save, and find out only in a real run whether it behaves.

What exists and could carry this:

- **The editor already takes a draft.** A suggestion (#5) opens the same editor filled in (`suggestion` prop of `TeamSection`), so a generated draft has a place to land that keeps every check the editor makes.
- **A structured call to the model with no state exists** (`askAgent`, used by `src/main/suggestionsModule.ts`).
- **Every agent of the team has a direct conversation** (`agent-<id>`, #71), where the person talks to it with no `@`.

## What you would like to happen

- **A "Create with AI" path** next to "New agent", and "Adjust with AI" inside the editor of an agent the person made.
- **A first question in the person's words:** "What should this agent do?" (when adjusting: "What do you want to change?").
- **Questions the model writes from that answer.** Each one open, single choice or multiple choice; the choice questions always accept an "Other" answer. The person answers; the model refines the draft prompt and may ask a new round; the person can stop whenever they want. The draft shows next to the questions and changes with each round.
- **A complete draft at the end:** name, job, instructions, and the permissions, tools, stages, squad and who it turns to, each one above the minimum shown with the reason and resettable with one click.
- **A way to test the agent in a conversation** before keeping it, and to feed what went wrong in that conversation back into the next round.
- **The editor stays the gate:** finishing opens the editor with the draft; nothing reaches the team's flow until the person saves there.

## Alternatives you considered

- **A template gallery.** Ready-made agents (`agent-flow`) already exist, but they cannot fit what a person describes in their own words.
- **One big prompt and a text box that returns an agent.** Skips the questions that find out what the person did not think to say.
- **A test that is not a real agent** (a throwaway answer with no tools). It cannot show how the agent behaves with the permissions it will have.

## Notes

- To settle in refinement: how a draft agent is kept out of the cycle while it is tested, and how its conversation is cleaned up.
- Builds on #5 (the editor opened filled in) and #71 (the direct conversation).
