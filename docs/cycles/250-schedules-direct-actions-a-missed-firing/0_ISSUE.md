# 250 Schedules: direct actions, a missed-firing rule and the system schedules in one place

- Endereço: https://github.com/exatasmente/coxia/issues/250
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

Part of #245. Builds on #275.

## Where things stand

#275 added the app's own schedules: kept on disk per workspace, listed and edited in the Schedules screen and from the persona's chat, with three recurrences (every N minutes, a time of day on some weekdays, once at a date), a working-days-only option, a question at start before anything fires, and a missed firing that runs once, marked late, when the app opens. Every firing is a persona turn with a prompt, audited by the `schedule` door.

This issue covers what #275 left out.

## What should happen

### Direct actions

A schedule can do something without a persona turn:

- **Start a run** of a cycle model for an issue or card.
- **Run a ceremony** that is available in the workspace.
- **Call an agent** of the team with a prompt, answering in a chosen conversation.
- **Wake the persona** with a prompt, as today.

A direct action does not call a model to decide what to do: it is cheaper, predictable, and still fires when the persona's provider is down. It goes through the same doors, autonomy policy and audit as the same action taken by the person or the persona; a schedule gains no permission of its own. The result, or the failure, is posted in the schedule's conversation.

### Missed firings

Each schedule says what happens to a firing missed while the app was closed or the scheduler was off: **run once when the app opens** (today's behaviour, the default) or **skip** to the next time. A skipped firing is still noted in the schedule's conversation.

### The system schedules in one place

The app's own timed jobs (pre-daily reminder, retro day, work window) are shown in the Schedules screen next to the person's schedules, read-only, with a link to where they are set. Whether they become editable schedules is decided in refinement; the existing settings and their behaviour do not change.

### Activity

Every firing, direct or persona, appears in the activity tree, not only in the audit. Check first what #275 already records there.

## Out of scope

- Arbitrary cron expressions and time zones other than the computer's.
- Event triggers ("when a card changes stage").
- Firing with the app closed or on another machine.

## Acceptance

- A schedule that starts a run, one that runs a ceremony and one that calls an agent each fire at their time with no persona turn, and leave an audit line and a line in their conversation.
- A direct action that needs approval waits for it like the same action taken by hand.
- A schedule set to skip does not fire after the app was closed past its time; one set to run once fires once, marked late.
- The Schedules screen lists the system schedules, read-only.
- Every firing appears in the activity tree.
- Tests use a fake clock and fakes for the model and the doors; the standard checks pass.

## Comentários

(sem comentários)
