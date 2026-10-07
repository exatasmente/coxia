# 71 Chat directly with an agent and let it propose the actions it recommends

- Endereço: https://github.com/exatasmente/coxia/issues/71
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

An agent called with `@` can look at the work and say what should be done, but it cannot turn that into anything the person can act on, outside a run.

A real case: asked in the general conversation to go over the open issues, the product owner read the tracker and came back with a sound list. Five open issues were already delivered by merged pull requests and could be closed with a line pointing to the pull request. Two bugs deserved high priority, three small ones medium, two new directions low. It also said which version each should go into. Every one of those is a write on the code host that the person now has to do by hand, one by one, copying from the answer.

What stands in the way today:

- **Outside a run, an agent proposes nothing.** A mention answer may carry a proposed issue only in a run's thread (`proposesIssue` in `src/main/mentions/answer.ts` requires a run place, and only a run has a publisher). In the general conversation, a squad channel or a conversation the person opened, the answer is text and nothing else.
- **The only thing an agent can propose is a new issue.** The writes the answer above needs already exist as operations of the Actions door (`commentIssue`, `setIssueLabels`, `setIssueStatus` in `src/main/vcs/types.ts`), but no agent answer can propose them.
- **There is no direct conversation with an agent.** To talk to the product owner the person writes `@product-owner` in every message of a shared thread, and nothing ties that conversation to the agent.

## What you would like to happen

- **A direct chat with an agent of the team.** A conversation that belongs to one agent: every message of the person goes to it, with no `@` needed, and it answers there with the conversation as its context. It is listed with the forum's conversations and works from the paired phone too.
- **An agent proposes actions wherever it answers.** From a direct chat, a channel, a general conversation or a run's thread, an answer may carry proposed writes on the code host: comment on an issue, add or remove labels (priority, milestone label), change an issue's status or close it with a comment that says why. Each one is checked like any other proposal and waits in Actions with the exact command.
- **The person decides in one place, in a batch.** The proposals of one answer show together in Actions (and in the chat, under the answer) so the person can read the list and say yes to all, some or none. Every write that runs is audited, one line per write, as today. A test workspace refuses them all.
- **Autonomy is the person's choice, per agent, and narrow.** By default nothing runs without the yes. An agent may be allowed to run low-risk writes by itself (a comment, a label), audited, in the manner of an autonomous agent that already comments and reviews in a run. Closing an issue and changing its status always wait for the person.
- **The agent stays read only on the code.** A chat never gets the agent Edit or Write on a branch; changing code is still a run's job. When the agent says something needs code, what it proposes is an issue.

## Alternatives you considered

- **Keep the answer as text and let the person copy it into the host.** That is today, and it is the friction this issue is about.
- **Let the agent write to the host directly.** It would skip the one door every external effect goes through (propose, confirm, audit), which the rest of the app relies on.
- **Open a run for every request made in a chat.** A run needs an issue and a branch; asking to close five issues needs neither.

## Notes

- To settle in refinement: whether closing an issue is `setIssueStatus` on every provider or needs an operation of its own; how a proposal from a place with no run is keyed and deduplicated in Actions; what a direct chat reads besides the conversation (the tracker, the workspace's repositories, the squad of the agent); whether an agent's direct chat keeps a memory between conversations; and how a direct chat shows on the phone.
- Builds on #53 (an `@agent` answers wherever a person writes) and the Actions door.

## Comentários

(sem comentários)
