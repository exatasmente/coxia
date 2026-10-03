# #8 — audit of the ceremonies against the three jobs

Read-only audit of the code on 2026-10-02. R = report, B = blocked, P = priority, C = consequence of one of them, O = outside.

## Pre-daily

| Capability | Evidence | Class |
|---|---|---|
| Loads assigned issues and their MRs into cards | `src/main/cards.ts:48-77`, `src/shared/types.ts:7-20` | R |
| Orders and caps the agenda (`compareCards`, `LIMIT = 8`, `orderAgenda`) | `cards.ts:40-46,75-76`, `src/renderer/src/ceremony.ts:24,71`, `src/shared/sameDay.ts:73-77` | P (automatic only) |
| One turn per card: `fala, andou, proximo, bloqueio, pergunta, opcoes` | `src/main/agents.ts:534-576` (schema `:556`), prompt `turn.main` | R, B |
| Same-day diff: unchanged card gets a short turn without a model call | `src/main/sameDay.ts:22-31,122-130,143-170` | R |
| Reply: `decisao{alvo: spec\|note\|ata}`, `efeito`, `desbloqueio` | `agents.ts:578-616` (schema `:591-597`) | C |
| Minutes, decisions written to the plan or the card note | `src/main/store.ts:140-235` | C |
| Team summary text | `agents.ts:653-664`, `src/renderer/src/screens/Ata.tsx:58-73` | C |
| Effect verifier job (classify, then GET-only checks every 30 min) | `src/main/efeitos.ts:140-246,304-313` | O |
| Minutes versions, diff, trash, history | `src/main/minutesStore.ts`, `src/renderer/src/screens/History.tsx` | O |
| Time per issue from ceremony spans | `src/main/tempo-core.ts:140-212` | O |

## Unblock

| Capability | Evidence | Class |
|---|---|---|
| Investigation chat on the card | `src/renderer/src/screens/Deep.tsx:59-85`, `agents.ts:618-633` | B (unbounded: not limited to the blocker) |
| Ways out (2-3 options with consequence) | `agents.ts:635-651` | B → C |
| Add to minutes (decision + effect) | `Deep.tsx:153-161` | C |
| Embedded conflict resolver | `Deep.tsx:233-238` | O |

Unblock never writes the tracker: no "remove blocked", no stage change (`Deep.tsx:158` only queues free-text effects).

## Gate

Artifact summary, quiz, grading, assisted reading, diagram insertion, new rounds, `GATE_QUIZ.md` (`src/main/gate.ts:101-348`). All O. The rejections watcher ("two rejections: decide with the reviewer", `src/main/watchers.ts:125-171`) is a B signal that lives outside every ceremony.

## QA hand-off

`prepareQa` (`src/main/qa.ts:50-109`): "what changed" (R, already in the pre-daily turn); checklist, risks, environment, QA notice, `QA_CHECKLIST.md` (`qa.ts:125-147`) are O.

## Retro

Digest of the window (`src/main/retro.ts:194-242`, R); `funcionou`, `retrabalho` (R); `travou` (B); `melhorias` (O, process proposals with no persistence, `src/renderer/src/screens/RetroScreen.tsx:15-24`).

## Release conflicts

Release detection and "your MR conflicts" (`src/main/actions.ts:208-287`, B); release sync, QA comment rewrite, in-app resolution, push (from `actions.ts:307` on, O). The Actions inbox (`proposeVcsAction`, `actions.ts:150-177`) is shared infrastructure and stays independent of any ceremony.

## Priority

No ceremony can change priority and persist it.

- Order is computed: `compareCards` (`cards.ts:39-46`: blocked, pending, then `ref.localeCompare`), the call cap `LIMIT = 8` (`ceremony.ts:24`, the total in `cards.ts:76` is never shown), `orderAgenda` for later meetings of the day.
- Today uses a second order, `sortByUrgency` (`src/renderer/src/dashboard.ts:248-261`, `src/shared/cycles/stages.ts:132-137`), which can disagree with the call.
- The call only offers next, skip and finish (`src/renderer/src/screens/Call.tsx:198-200`).
- Cards drop the tracker's labels and milestone: `VcsIssue` has them (`src/main/vcs/types.ts:19-36`), `ReportItem` (`src/main/report.ts:8-21`), `Card` and `CARD_FIELDS` (`src/shared/config/types.ts:239`) do not.
- No prompt or catalog mentions priority; no decision or effect kind reorders or defers a card.
- The write plumbing exists: `setIssueLabels` (`vcs/types.ts:171`; GitHub `src/main/vcs/github.ts:462-467`, GitLab `gitlab.ts:428-432`, Bitbucket unsupported `bitbucket.ts:406-407`) through `proposeVcsAction` and the per-action approval (`actions.ts:349-387`).

## Risks for moving things out

- The external-write guards of gate, QA and release (`assertExternalWrite`, per-action approval) move with them.
- Ceremony toggles feed the retro base (`retro.ts:250-252`), the scheduler (`src/main/scheduler.ts:125,131,148`), template `needs` (`src/shared/cycles/apply.ts:35-36`) and the prompt families (`PROMPT_ROLES`, `config/types.ts:235`); removing one needs a config migration and the prompt goldens (`test/golden/`).
