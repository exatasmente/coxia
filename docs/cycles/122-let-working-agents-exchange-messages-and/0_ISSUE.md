# 122 Let working agents exchange messages and call each other during a run

- Endereço: https://github.com/exatasmente/coxia/issues/122
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## What should happen

An agent that is working a stage can **receive messages while it works** and **send messages without stopping**, and it can **call another agent** and discuss a point with it, in the run's conversation or in a conversation of their own in the forum, so the team exchanges information during a run instead of only through the end of a stage.

Today an agent's question ends its work: the stage pauses and starts again with the question and the answer in the prompt (`docs/runner.md`, questions and mentions). A message the person writes in the run's conversation while a stage works reaches the agent only if it answers a question. An agent can turn to another (`turnsTo`) only with a question, and the other can only answer; only a person's message calls an agent with `@`.

### 1. Receiving while working

- A message written to the working agent (an `@` to it in the run's conversation, from the person or from another agent) is delivered to it **during** its stage: at the next point between two steps of the model, as a message in its session, on both engines. The stage does not restart.
- The run's screen shows that the message was delivered (and when), or that it is waiting for the next step.
- A message to an agent that is not working keeps today's behaviour (the mention calls it).

### 2. Sending while working

- A tool, **`SendMessage`**, lets the working agent post to the run's conversation (to the person, to an agent, or to everyone), without ending its stage: a progress note, a finding, a question that does not need to block.
- A blocking question keeps today's path (the stage pauses); `SendMessage` with a question to the person does not pause, and the agent is told an answer may come as a message.
- Messages sent this way are internal to the run unless the stage's output publishes them; they never go to the code host by themselves.

### 3. Calling another agent

- A tool, **`CallAgent`**, lets the working agent start a conversation with another agent of the team, about a point, in the run's conversation or in a new conversation of the forum linked to the run (the caller chooses; the run's screen links both ways).
- The called agent answers in that conversation; the two can go back and forth, within a limit of rounds per conversation (workspace setting), and either can end it. The caller receives each answer as a message (section 1).
- **What the called agent may do depends on the conversation**: it starts reading; when the point needs it (reproduce something, change a file), it may use **its own permissions in the team** (commands per its `shell`, writes per its `permission`), never more. The spec must say:
  - how two agents never write the same worktree at the same time (one writer at a time, and what the other sees);
  - where a called agent's commands run (the run's sandbox, a throwaway copy) and that they appear in the run's list of commands by agent;
  - what of it is committed, and with which stage.
- A call follows the autonomy of the run: host commands, external writes and pushes wait for the person exactly as they would in a stage.
- The person sees every message of these conversations live and can write in them; `@` from the person still works.

### 4. Limits

- Rounds per conversation, conversations per stage and the model use of a call count against the caller's stage (shown in its usage), and the stage clocks keep running.
- A loop of agents calling each other is refused (a call chain that comes back to an agent already in it).

## Out of scope

Agents of different runs talking to each other (requests between squads keep their own path).

## Acceptance

- While the developer works a stage, the person writes `@developer use the existing helper`; the developer receives it before its next step, without the stage restarting, and its work shows it.
- The developer sends a progress note with `SendMessage`; the stage goes on.
- The developer calls QA with `CallAgent` in a new forum conversation to ask how to reproduce a scenario; QA runs a command in its sandbox to check, answers, and the developer continues with the answer; the conversation is linked from the run, and QA's command is in the run's list of commands under QA.
- When the called agent needs to change a file and has `permission: worktree`, it does, without two writers at the same time.
- A loop of calls and a conversation over the round limit are stopped, and the conversation says why.

## Notes

Functional specification only; the solution design belongs to refinement and planning. Relates to #118 (autonomy and the list of commands by agent).

## Comentários

(sem comentários)
