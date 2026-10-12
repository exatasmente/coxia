# 290 A called agent never gets the caller's message, and a call to a writer can hang the stage

- Endereço: https://github.com/exatasmente/coxia/issues/290
- Estado: open
- Rótulos: bug, coxia
- Autor: exatasmente

## Descrição

## What happened

On the 0.11.0 beta (`release/0.11.0`), a stage's agent called another agent of the team with `CallAgent` during an implement stage. Both agents had `permission: worktree`.

1. The caller's topic was posted in the run's conversation, but the called agent never received it. It answered "I did not receive your point, please send it again" four times, each from a fresh session.
2. On the next turn the called agent asked again through `AskConversation` and waited for the caller's next message. The caller was itself blocked inside `CallAgent`, waiting for the conversation to end. Neither side could move.
3. The stage stayed like that for over 70 minutes, with no change to the worktree and no error. The stage's idle limit (10 minutes) never fired. `callStop` on the run's thread answered `false`.

It only cleared when the called agent's engine process was killed by hand: `CallAgent` then returned an error to the caller, which went on with its work.

## Why (read from the code on `release/0.11.0`, not yet confirmed by a test)

- **The first message never reaches the called agent.** `runConversation` takes the caller's first message (`conversation.ts:188`) and only posts it to the thread (`:190`). `turnOf` builds the called agent's prompt from `main.runner.conversation.system` / `systemWrite` plus the procedure and memory indexes (`:331`). The message itself is not in it. Later messages do arrive, because they are the result of `AskConversation` (`:297`).
- **The loop calls the agent again with nothing new.** After a turn that ends without `AskConversation`, the loop in `runConversation` (`:221-243`) starts another `turnOf` without waiting for the caller. With no history and no message, the called agent repeats itself until it calls `AskConversation` or the round cap is hit.
- **A writer callee deadlocks the caller.** When the called agent writes (`permission: worktree`), `callAgent` awaits the whole conversation (`executor.ts:1187`). The called agent's `AskConversation` waits on `incoming()` (`executor.ts:~1130`), which is only fed when the caller calls `CallAgent` again (`open.say`, `:1119`). The caller cannot, because it is still inside the first call. Only the stage's abort or the inbox closing ends it.
- **Nothing times out.** The stage's idle clock did not trip in 70 minutes. Something keeps beating it while the call hangs (not identified). `callStop` only knows the calls registered in `callStops` (mentions and persona), not runner conversations.

## What should happen

- The called agent gets the caller's first message (and every later one) as part of what it reads, in the same session across turns.
- A turn that ends without asking for more ends the conversation instead of starting a new turn with nothing new.
- A caller that waits on a writer callee can still answer it. Or the callee's `AskConversation` returns at once with "the caller is waiting for your answer; give it now", so the conversation can never wait on itself.
- A conversation that makes no progress hits a time limit, ends with a system line in the thread saying why, and returns that to the caller.
- `callStop` (and the run screen) can stop a runner conversation.

## Acceptance

- A test with fakes: a caller calls a writer callee with a topic, and the callee's prompt contains the topic.
- A test with fakes: a writer callee that calls `AskConversation` on its first turn does not hang the caller; the call returns within the limit.
- A test with fakes: a callee that answers without asking for more runs exactly one turn.
- A conversation with no progress for the limit ends, and the caller's `CallAgent` returns a message that says so.
- `callStop` on the run's thread stops a hanging runner conversation and answers `true`.

## How to reproduce

In a test workspace, give two agents of the team `permission: worktree`, start a run, and have the stage agent call the other with `CallAgent` about any point. The called agent's first answer says it got no message.

## Comentários

(sem comentários)
