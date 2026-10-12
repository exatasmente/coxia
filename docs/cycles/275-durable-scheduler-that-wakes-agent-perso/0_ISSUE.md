# 275 Durable scheduler that wakes agent personas between turns

- Endereço: https://github.com/exatasmente/coxia/issues/275
- Estado: open
- Rótulos: coxia
- Autor: exatasmente

## Descrição

Problem: no durable schedule wakes a persona. Each persona turn runs in a fresh Claude session (about 75 session files in roughly 3 hours for one conversation), and session-scoped jobs (CronCreate, ScheduleWakeup) die with the session. Observed: a recurring job and a one-shot wakeup were created, neither fired, and the job list came back empty.

Proposal: an app-owned scheduler (recurring ceremony and/or event trigger) that starts a persona turn durably, independent of any Claude session. Optionally reuse the session across turns where it makes sense.

Acceptance:
- A recurring schedule created in the app fires with the app running and no session open.
- The fired turn receives the persona and a prompt, and its result appears in the conversation.
- Schedules persist across app restarts.
- Tests use fakes, no real model or network.

Not verified: the app code that opens sessions, and how the session-driving work in #262 (PR #274) reuses sessions. Check that before designing.

## Comentários

### exatasmente, 2026-10-11T20:56:55Z

Refinement notes from the team lead:

- PR #274 (#262) was read by the persona (description and start of the diff only). It adds only a budget fallback to the signed-in Claude Code CLI (off by default, config schema 29). It does not manage, resume or keep sessions alive, so it does not cover this issue.
- Before designing, someone should read the app code that opens sessions and answer: can the app open a persona turn without a live session? Suggested owner: tl-plataforma. Not yet verified by anyone.
- Ready for refinement with the product owner. Priority is still to be set.
- Unverified: the rest of the #274 diff, and whether schema 29 collides with another in-flight change.
