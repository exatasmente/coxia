# 142 Make a QA stage back what it says it ran, and keep or report the screenshots it looked at

- Endereço: https://github.com/exatasmente/coxia/issues/142
- Estado: open
- Rótulos: bug, coxia, priority:high
- Autor: exatasmente

## Descrição

## What happens today

A QA stage with a sandbox (and a virtual display) can end as "pass" without keeping a single piece of evidence, and nothing tells the agent or the person.

Seen in a real run: the QA agent opened the app on the virtual display, took about a dozen screenshots in `/coxia/out` and looked at each one with `ViewImage`, but never called `SaveEvidence`. Then:

- Its output came with `evidence: []`, and five scenarios marked `executed` with no `commands` and no `evidenceIds`.
- `backEvidence` turned those scenarios into `read` in the run's record, without telling the agent.
- The `5_TEST_PLAN.md` and the comment published on the issue still said "passed (executed)" and "checked with the app open in a window", because they come from the agent's own text.
- The stage folder was removed with the sandbox, so every screenshot was lost. The run screen shows "No evidence in this stage", and nothing reached the code host.

## What should happen

1. **A claim of execution needs backing.** When a QA stage with a sandbox answers a scenario as `executed` with no command of its own and no evidence id, the answer goes back to the agent for one repair round, as a text outside the schema already does. The agent then keeps the evidence (or cites the commands), or turns the scenario into `read` / `not-run` itself. Only after that round does the app downgrade on its own, and the stage says so in the run's conversation.
2. **What is published matches the record.** The test plan written to the cycle folder and the QA comment reflect the scenario results the app recorded (after `backEvidence`), not the agent's text when they differ. A scenario the app downgraded reads as "read" in both.
3. **What the agent looked at is not lost silently.** An image in the output folder that the agent opened with `ViewImage` and did not keep is either kept automatically as evidence when the stage concludes, or listed in the run's conversation as "looked at, not kept" before the sandbox is removed. Pick one in the spec and say why.

## Acceptance

- A QA output with an `executed` scenario and neither commands nor evidence ids gets one repair round; a test covers the round and the downgrade after it.
- The written `5_TEST_PLAN.md` and the QA comment never call a scenario executed when the run's record says `read`; a test covers it.
- A QA stage whose agent viewed images in `/coxia/out` without keeping them ends with them kept or reported, never with nothing; a test covers it.
- Stages without a sandbox behave as today.

## Notes

- The evidence tools, `backEvidence` and the stage output live in `src/main/runner/executor.ts`, `src/main/evidence/` and `src/main/runner/publish.ts`.
- The repair round can follow the open engine's existing pattern for a final answer outside the schema (`src/main/engine/open/loop.ts`).

## Comentários

(sem comentários)
