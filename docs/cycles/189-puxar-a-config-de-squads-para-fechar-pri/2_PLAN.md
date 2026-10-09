# Plan: reissue the per-squad priority from the workspace's real squad config

## What this changes

Nothing in the code. The request is a cycle-conduction action: redo a priority
decision (per-squad allocation suggested at the 2026-10-08 retro, made without the
workspace's squad config in hand) using the real squad list the workspace
configuration holds, then set the tracker label by the priority-ordering rule.
No file under `src` is touched, so no commit applies.

## Inputs read before deciding, in order

1. `.claude/rules/priority-ordering.md` in the app checkout — the rule set: the
   tracker label is the first entry of `devCycle.priority.labels` (highest first)
   that matches an issue label; the repository and the card reference do not
   break ties; writing the priority to the tracker is an audited proposal.
2. The retro minutes of 2026-10-08, in the retro file of that date inside the
   workspace data folder — the original decision as taken (per-squad allocation;
   what the retro recorded: releases that needed many runs, unanswered questions
   that led to reclassification).
3. The workspace configuration the app holds as stages receive it — the squad
   list with `mission`, `scope` (repos, labels, paths, `unclaimed`) and
   `liaison`, as defined by `SquadDef`/`SquadScope` in `src/shared/config/types.ts`.
   This is a fresh read of the config itself; the summary quoted in the triage is
   superseded by what the config says.

Items 1 and 2 live outside the repository on purpose; item 3 is read from the
workspace's own config document.

## The analysis, step by step

1. **List the squads from the config.** For each squad: `mission`, `scope`
   (repos, labels, paths, whether it takes what nobody claims) and `liaison`.
   This list is copied into the output — the acceptance criteria require it as
   part of the reissued decision.
2. **Map each piece of work in the request to a scope.** The request has one
   piece of work: reissuing the per-squad priority itself, which is
   cycle-conduction over the app's configuration boundary — the model where
   squads and their fields live. The hook is the scope the squad declares:
   paths (`SquadPath.repo` + `prefix`) that match the config area
   (`src/shared/config`), and the team assignment that matches the squad's own
   team. Per the platform squad's declared scope, this lands on **platform**.
   If the real config shows a path or label that matches better, the config
   wins over this plan — the executor cites the matching entries, never a
   domain opinion.
3. **Check what nobody claims.** If a piece of work matches no scope at all, it
   goes to the squad with `unclaimed: true` in the config. If no squad has that
   flag, it stays open as a person decision and is recorded as undesignated,
   never as assigned.
4. **Propose the tracker label.** Take the issue's labels, look up the first
   entry of `devCycle.priority.labels` (highest first) that matches. Only a
   plain label qualifies — never a matching expression, even if an entry uses
   one. The card's reference never breaks a tie. The proposal from refinement
   (`priority:medium`) is the working hypothesis, not a decision — the config
   read decides.
5. **Stop before any write.** The label is proposed on the cycle conversation
   only. Nothing is written to the tracker until the person accepts. There is no
   code path to build for this, because the write goes through the audited
   proposal flow, which is outside this change.

## Output of the executing stage

One reissued decision recorded in the cycle conversation (and, per acceptance
criterion 6, carried into the next retro's minutes or the request itself) with:

- the squad list used — mission, scope, liaison per squad, read from the config;
- the per-squad adhesion analysis — the paths and labels from the config that
  matched, quoted;
- the designated squad and the reason for it;
- the proposed tracker label and the ordering entry that produced it;
- what changed versus the original 2026-10-08 decision, stated side by side.

## Order of changes

No code change. The sequence above (rule, minutes, config, allocation, label
proposal) is the execution order; the label proposal is last and gated.

## Risks and how this plan avoids them

- **Scope mismatch risk** (the reason the request exists): allocation by domain
  feeling rather than declared scope. Avoided by citing exact config entries
  (paths, labels) for every assignment, and refusing to designate anything the
  config does not cover.
- **Stale-record risk**: the only knowledge of the rule, the minutes and the
  config so far is a summary in the conversation, never read directly. Avoided
  by making a fresh read of all three the first act of execution; the summary is
  discarded in favor of what the files say.
- **Accidental tracker write**: the rule makes writing an audited proposal, and
  criterion 5 forbids a write without person acceptance. The plan stops at
  proposal; no write step exists in this change.
- **Label-expression risk**: `devCycle.priority.labels` could carry entries
  written as matching expressions, which must never become a tracker label.
  Avoided by proposing only plain labels; an expression match is reported as
  such and not turned into a label.
- **Scope-drift critique**: if the read shows the scopes themselves fit poorly,
  that is not fixed here — it becomes a separate request to redefine squad
  scopes, out of this change.

## Acceptance criteria not covered by this plan

None. All six criteria of the spec are covered by the sections above (list of
squads: step 1 and the output; per-work assignment with reason: step 2; no
adherence marked as such: step 3; valid label by ordering: step 4; no tracker
write: step 5; recorded decision comparable with the original: the output
section).

## Open questions

None that block. The two off-repository materials are read at execution from
the locations the requester gave.
