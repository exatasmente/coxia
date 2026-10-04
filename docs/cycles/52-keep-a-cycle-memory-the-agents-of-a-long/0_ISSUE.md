# 52 Keep a cycle memory the agents of a long run read and update

- Endereço: https://github.com/exatasmente/coxia/issues/52
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

Each stage of a run starts a fresh model session, and the runner builds its prompt from scratch (`stagePrompt`, `src/main/runner/prompt.ts`). What carries over from one stage to the next is:

- the documents of the cycle folder (`docs/cycles/<n>-<slug>/`), the issue first and then the rest in name order, at most 30,000 characters per file and 120,000 in all (`readFolder`, `src/main/runner/cycleFolder.ts`);
- the last 40 messages of the run's thread, each clipped to 1,500 characters (`src/main/runner/executor.ts`);
- the last handoff note left for this agent, the person's answer to its question, and the last four review rounds of the stage.

That works for a small issue. A long cycle runs into these problems:

- **The cut falls on the newest documents.** Files are read in name order until the budget runs out, so a later stage's own inputs (the review, the test plan) are the first to be clipped or dropped. A small issue already gets close to the limit: a recent cycle in this repository produced about 61,000 characters of documents, 24,000 of them in the plan.
- **What was decided in the thread goes away.** A decision, a constraint the person gave, or an answer from the reporter that only lives in the thread leaves the prompt once 40 newer messages arrive.
- **A rewritten document loses its history.** When review or QA sends the work back, the stage writes its document again. Why the first approach was dropped stays only in git history, which no agent is given.
- **Nothing holds the decisions together.** Every agent rebuilds the state of the cycle from long documents, and may contradict a decision it never saw.

## What you would like to happen

- **One memory file per cycle**, with a fixed name in the cycle folder, versioned with the branch like the other documents. It is short and structured: decisions (what, who, why), constraints, what was tried and dropped, open questions, and where the work stands.
- **It is always read, and always in full.** It goes first in every stage's prompt, before the other documents, and it is never clipped by the folder budget. It has a cap of its own, and the stage is told when it is over that cap.
- **Every stage updates it.** A stage that ends with `done` returns its changes to the memory together with its summary. The app writes the file and commits it with the stage's documents. An agent does not edit the file freely. A return from review or QA adds what was rejected and why.
- **The thread feeds it.** An answer from the person or the reporter, and a handoff note, go into the memory, so they survive the 40-message window.
- **The person can see and correct it.** It shows on the run screen next to the other documents. An edit made by the person is the version the next stage reads, and it is recorded as the person's.
- **The folder budget favours the current stage.** When the documents do not fit, the ones this stage needs (its inputs as the flow declares them) are kept in full, and the older ones are clipped first, each with a note that it was clipped.

## Alternatives you considered

- **Raise the limits.** This puts the problem off, costs more on every stage, and a small model with a short context window still breaks.
- **Have the model summarise the whole folder at each stage.** That makes one more model call per stage, and the summary changes from stage to stage: decisions get rewritten instead of carried over.
- **Keep the memory outside the repository**, in the app's data. It would not travel with the branch, nobody could review it in the pull request, and it would go against "the spec of an issue is its source of truth".

## Notes

- Same rules as the other documents: what goes in comes from outside and goes between `<data>` tags, anything that looks like a credential is masked, and the file passes the public audit.
- It has to work on both engines (the open engine and the Claude Agent SDK) and with a resumed run after a restart.
- To measure: a run with a return loop (review or QA sending work back) and a cycle whose documents pass the folder budget, both with a real model. Neither has been exercised so far (`docs/runner.md`, what ran with a real model).

## Comentários

(sem comentários)
