# #8 Ceremonies have three jobs — functional spec

Issue: https://github.com/exatasmente/coxia/issues/8

## The rule

A ceremony exists to do three things, and only these:

1. **Report** what is being done.
2. **Define** what is blocked.
3. **Readjust** priorities.

What directly follows from one of the three (the minutes of what was reported, a decision taken about a blocker, an effect queued from it) is a **consequence** and stays. Anything else is **outside**: it moves out through an explicit item, never by silent removal.

## Where the ceremonies stand today

Audit of the code as of 2026-10-02 (evidence with `file:line` in [`AUDIT.md`](AUDIT.md)).

| Ceremony | Report | Blocked | Priority | Outside |
|---|---|---|---|---|
| Pre-daily | one turn per card: what moved, next step | the turn's blocker and pending question | only automatic ordering | the effect verifier job, minutes version management, time per issue |
| Unblock | — | the conversation and its "ways out" | — | the conflict resolver embedded in the screen |
| Gate | — | — | — | all of it: artifact summary, quiz, grading, assisted reading, diagram insertion, `GATE_QUIZ.md` |
| QA hand-off | "what changed" (already in the pre-daily turn) | — | — | test checklist, risks, environment, QA notice, `QA_CHECKLIST.md` |
| Retro | the period digest, what worked, rework | what got stuck | — | process improvement proposals |
| Release conflicts | — | "your MR now conflicts" | — | release sync, QA comment rewrite, in-app conflict resolution, push |

Two findings matter more than the table:

- **Priority has no home.** No card field, no decision kind, no effect, no prompt asks for it, and nothing can write it. Order is computed (blocked first, then pending, then ref as a string), cards carry neither labels nor milestone, so an agent cannot even read a priority the tracker has.
- **Order is decided twice and capped silently.** Today sorts by urgency; the call sorts by blockers, pending and ref; they can disagree for the same cards. The call takes the first 8 and says nothing about the rest, so the cap is the de-facto prioritization.

## What this issue delivers

### 1. Priority gets a home (the functional change)

- **The card shows its priority.** The tracker's priority signal (a label matching the workspace's priority labels, or the milestone) is part of the card, on screen and in what the agents read.
- **One order everywhere.** Today and the call use the same order: blocked first, then priority, then the rest by last update. The ref string is no longer a tie-break.
- **Nothing is dropped silently.** When the agenda has more cards than the call takes, the call says how many were left out and lists them at the end, as candidates to bring in.
- **The person can readjust priority in the call.** Saying it ("this one goes first", "leave #12 for next week", "raise #7") produces a priority decision for that card. Each decision is shown back before the call moves on.
- **A priority decision is persisted as a proposal.** It becomes a label change on the tracker, waiting in Actions for its own "yes", like every other external write. A test workspace refuses it. A tracker without priority labels configured keeps the decision in the minutes only, and the minutes say so.

### 2. Everything outside becomes an explicit item

One item per move, each its own issue once this spec is approved:

1. Gate → an artifact-study tool next to the card (or an agent task of the pipeline), not a ceremony.
2. QA hand-off → a QA tool that generates the checklist and the notice; the "what changed" paragraph stays in the pre-daily turn.
3. Release conflicts → the release tools (Actions); only "your MR conflicts" stays, as a blocker on the card.
4. Retro → keeps the digest and what got stuck; improvement proposals become an agent task.
5. Pre-daily → the effect verifier, minutes versions and time per issue are named as tools that read ceremony data, not parts of the call.
6. Unblock → the conflict resolver leaves the screen; the blocker links to it.
7. Blocker signals that live outside every ceremony today (two rejections in a row, a new blocker from the status check, a post-release conflict) arrive in unblock and in the pre-daily turn.

This issue does **not** move any of them; it names them so nothing is removed by accident.

## Out of scope

- Moving any of the items above (each is its own issue).
- Renaming or removing ceremony ids, toggles or prompt families (needs a config migration; belongs to the items).
- Priority on Bitbucket (its label write is unsupported today).

## Acceptance

- A card with a priority label shows it, and the turn of that card mentions it when it matters.
- Today and the call list the same cards in the same order.
- With more cards than the call takes, the call states the number left out and names them.
- "This one goes first" in the call produces a priority decision, visible before the next card, and after the call a label proposal for that issue waits in Actions; approving it changes the label on the tracker; a test workspace refuses it.
- Without priority labels configured, the same sentence produces a decision in the minutes only, with a line saying it was not written to the tracker.
- The seven "move out" items exist as issues linked from this one.
