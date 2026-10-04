# 29 Show that an agent called in a run's thread is working

- Endereço: https://github.com/exatasmente/coxia/issues/29
- Estado: open
- Rótulos: enhancement
- Autor: exatasmente

## Descrição

## The problem

When a person calls an agent with `@agent` in a run's thread, nothing in the thread says the agent is working. The person cannot tell whether the call was taken, is running, or was lost until the answer (or a "the call failed" app message) shows up.

What exists today:

- The call runs under the run's activity context (`withActivityContext(`run:${runId}`)`, `src/main/runner/service.ts`, `answerMention`), so it shows in the jobs dock only as the generic "Agent" entry, with no name and no link to the run.
- The run screen shows the live activity panel only while `run.status === 'working'` (`src/renderer/src/screens/cycle/RunScreen.tsx:162`). A mention usually happens while the run waits at a gate or a question, so the panel is not there.
- Mentions of one run are queued one at a time and at most three agents per message; a second call waits for the first, silently.

## What we want

- **In the thread:** right after the person's message, a transient line per called agent ("@developer is reading…", then the live step, e.g. reading a file) that disappears when its answer or its failure message arrives. A queued call says it is waiting for the one before it.
- **On the run screen:** the live activity panel also shows while a mention call is running, whatever the run's status, labelled with the agent that was called.
- **In the jobs dock:** the entry names the agent and the run (not the generic "Agent"), and opens the run's thread.
- **In the PWA:** the same, since the thread and the run screen already work there.

## Notes

- Mentions only call agents in a run's thread; in channels and general threads `@` is plain text. The input could say so when the person types `@` there.
- The call stays read-only and keeps its silence and wall-clock limits (`runner.stageIdleMs`, `runner.stageMaxMs`).

## Comentários

(sem comentários)
