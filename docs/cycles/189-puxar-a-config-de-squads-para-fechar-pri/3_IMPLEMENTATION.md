# Reissuing the per-squad priority from the real squad config

Nothing in the code changed: the request is a cycle-conduction action, and the
plan was a reading-and-allocation procedure, not a code change. This note
records the reissued decision, the materials it rests on, and what was and was
not executed.

## Materials read first, as the plan ordered

1. **The priority-ordering rule** (`.claude/rules/priority-ordering.md` in the
   app checkout). Confirmed against the plan's summary: the tracker label is
   the first entry of `devCycle.priority.labels` (regular expressions, highest
   first) that matches one of the issue's labels; the card reference does not
   break ties; a priority write is an audited proposal (`setIssueLabels`) that
   waits for the person's acceptance, and several cases do not write at all
   (unconfigured workspace, default level, label already present, unidentified
   card, unsupported host).
2. **The retro minutes of 2026-10-08** (the retro file of that date in the
   workspace data folder, plus the day's ceremony minutes). Confirmed content:
   reclassifications of priority at that day's triage, releases of several
   issues that needed many skipped runs before completing, days of 8
   activities carrying 5 to 8 unanswered questions, and two pull requests
   stuck in conflict. The retro file records two priority reclassifications at
   the triage; the per-squad allocation question that originated this request
   is the one this stage reissues. Issue numbers from those minutes are the
   workspace's own; none is repeated here.
3. **The workspace's real squad config** (fresh read of the config document —
   the triage summary is superseded by this read). `devCycle.priority.labela`
   reads, in order: `^priority:high$`, `^priority:medium$`, `^priority:low$`.
   All three are plain labels, so all three are writable.

## The squad list used, from the config

**plataforma** — mission: the app runtime (runner, sandbox, agent engines,
code providers, config and the security boundary). Scope: labels
`area:plataforma`; paths `src/main/runner`, `src/main/sandbox`,
`src/main/engine`, `src/main/vcs`, `src/main/actions.ts`, `src/main/webPolicy.ts`,
`src/shared/config`, `src/shared/runs`; `unclaimed: false`. Liaison:
tl-plataforma. Autonomy: on.

**experiencia** — mission: what the person sees and hears (screens,
ceremonies, voice and the text catalogs). Scope: labels `area:experiencia`;
paths `src/renderer`, `src/shared/i18n`, `sidecar`; `unclaimed: false`.
Liaison: tl-experiencia. Autonomy: on.

## Adhesion analysis, piece by piece

The request carries one piece of work: reissuing the per-squad priority
itself, a decision conducted over the app's configuration boundary — the
model where squads and their fields live.

- Matching entries quoted from the config (platform): path
  `src/shared/config` (the model `SquadDef`/`SquadScope` lives there), and the
  mission's own words ("config") cover the squad list being read.
- No entry of the experiencia scope matches: none of its paths or labels touch
  the config area.
- Fallback: not needed — the work matched a declared scope; besides, neither
  squad carries `unclaimed: true`, so had nothing matched, the work would
  stand as undesignated for the person's next round.

## Designation

- **Reissuing the per-squad priority → plataforma**, because the config's
  platform scope declares the path `src/shared/config` and the label
  `area:plataforma`, and the work operates on exactly that area. Citation of
  the config entries, not a domain opinion: this is the same squad the
  refinement proposed, now confirmed by a fresh config read rather than by the
  triage summary.

## Tracker label proposal

The issue carries no labels today, so strictly by the ordering rule no
priority entry matches and the card's priority is unset. The refinement's
working hypothesis therefore stood as the proposal, not as a derivation:
**`priority:medium`** — a valid plain label, listed in
`devCycle.priority.labels` (second entry), so a `setIssueLabels` proposal
would be legal. A comparison check: the label is an exact plain label, not a
matching expression. The write was proposed only; the write step in the
tracker was carried out by the tech-lead step, which recorded the label on
the issue as an audited label proposal. **The literal rule-alternative (no
label match on a label-less issue → leave the tracker untouched) was noted,
and the accepted choice is `priority:medium`.**

## Acceptance (2026-10-09)

The label proposal was answered in the cycle conversation: the tech lead
confirmed the designation and accepted **`priority:medium`**, and recorded the
label on the issue as a label proposal on the tracker. Nothing else was
written to the tracker. This closes criterion 5's gate: the proposal was
accepted before going on the card, and the recorded decision stands.

## What changed versus the original 2026-10-08 decision

| | Original (retro of 2026-10-08) | Reissued |
|---|---|---|
| Basis | Priority handled ad hoc at the day's triage, without the squad config in hand | Fresh read of the rule, the retro minutes and the squad config |
| Allocation | Domain proximity, never checked against declared scopes | By scope: the config paths and labels cited above; platform matched, nothing assigned outside a scope |
| Fallback | Not considered | Defined by the config: neither squad claims what nobody claims, so uncovered work stays with the person |
| Label | Reclassifications recorded in the minutes, tracker write handled by the audited flow | `priority:medium`, second entry of `priority.labels`, valid plain label — proposed, accepted and recorded on the issue |
| Designation | Suggested (platform) without config evidence | Confirmed by config entries (`src/shared/config`, `area:plataforma`) |

## Criteria coverage

1. Squad list from the real config, with mission, scope and liaison — listed
   above (fresh read, not the triage summary). ✔
2. Each piece of work with a designated squad and cited config entries —
   above. ✔
3. Unmatched work marked as undesignated — not triggered, and the fallback is
   recorded (neither squad takes unclaimed work). ✔
4. Proposed label is a valid priority label from the config, chosen under the
   highest-first ordering; plain label only. ✔ (as proposal: the issue has no
   labels today, so the ordering rule alone yields no match — see above.)
5. Nothing written to the tracker without acceptance; the label went out only
   after the proposal was accepted in the cycle conversation. ✔
6. The reissued decision is recorded here with its reasons, side by side with
   the original. Carrying it into the next retro's minutes is the person's
   ceremony act, not this stage's. ✔ (partial — recorded here; minutes belong
   to the next retro.)

## Gates

No `src` file changed, so `npx tsc --noEmit`, `npx vitest run`,
`theme-audit`, `i18n:lint` and the public audit were **not run** for this
stage — there is no code to gate. Unverified items: none beyond tracker
writes carried out outside this stage (the label recording, done by the tech
lead; not re-verified on the tracker by this stage).
