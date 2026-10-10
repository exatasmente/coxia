# #178 Let an agent hand its screen to the person: test plan and review against the spec

What proves each acceptance criterion of [`1_SPEC.md`](1_SPEC.md) as amended by gate 1 (the recording keeps the interval and marks it; a hand-off recording plays on a paired browser too), and what a person checks by hand. Criterion 11a does not apply: the plan masks in the app's intermediary and does not use `--secrets`, so no file is made.

## What the suite proves

| Criterion | Covered by |
|---|---|
| 1. Offered only with a live screen, in both engines, stage and conversation; `unavailable` for a second request, or after a decline or expiry | `test/browser-engine-tools.test.ts` (the row, the names, offered only with the port, both engines), `test/runner-stage-screen.test.ts` and `test/mentions-screen.test.ts` (a stage and an answer begin the call and offer the tool; not for an agent without the screen, a ceremony or a person who cannot take it), `test/handoff-service.test.ts` ("what answers unavailable") |
| 2. Clocks stand still and resume with what was left, however it ends | `test/handoff-service.test.ts` ("the pause of the clocks"), `test/runner-stage-screen.test.ts`, `test/mentions-screen.test.ts` (the answer's clocks) |
| 3. 15 and 30 minute limits, restarted by delivered input; on expiry control off, keys up, interval closed, nothing fails | `test/handoff-service.test.ts` ("the results": expired before and after the take; an undelivered event does not restart the limit) |
| 4. Four fixed sentences; cancel or abort removes the record with no result | `test/handoff-service.test.ts` ("the end with no result"), `test/browser-engine-tools.test.ts` (the sentences through both engines, no image) |
| 5. Commands and browser calls refused with the fixed text, no host approval asked, both run again after | `test/sandbox-session.test.ts`, `test/host-session.test.ts` (queued command refused again, no approval asked), `test/sandbox-handoff-wiring.test.ts`, `test/browser-handoff.test.ts` (every call of the app's browser, the confirmation and a second hand-off) |
| 6. The three screen channels denied to a paired browser by the pattern, the decline open and listed, the card readable | `test/screen-policy.test.ts`, `test/runs-policy.test.ts` (`MOVES`), `test/handoff-channels.test.ts`, `test/runs-screen-channels.test.ts`, `test/browser-asks.test.ts` (`show` lists the card in the screen's `pending`, which `runs:screens` hands out), `test/handoff-ui.test.ts` (the paired browser's card) |
| 7 (amended). `held` before control is on, caches dropped at both ends, the recorder keeps being fed and one `handoff` mark covers the interval; Take control outside an interval still marks per burst | `test/screen-hub.test.ts` ("a hand-off interval"), `test/screen-recorder.test.ts` ("the interval of a hand-off"), `test/handoff-ui.test.ts` and `test/live-screen-ui.test.ts` (the viewer's `held` and the marks apart in the player: `test/recording-player-ui.test.ts`) |
| 8. A marker typed through the input channel is in nothing the app wrote; the thread has exactly the lines of rule 16 | `test/handoff-scan.test.ts` (the real forum, audit log, run store and evidence store over an empty data folder, the recording's metadata, the tool result, the console and the error context of every channel; then every file under the data folder is searched), `test/handoff-service.test.ts` ("are in nothing the app writes") |
| 9. No tool the app offers a model returns a frame, the recording or the typed text | `test/handoff-scan.test.ts` ("the tools the app offers a model": the typed values have no reader, the modules that define the tools never reach the hub's pictures or the recording), `test/browser-engine-tools.test.ts` (the tool's results carry no image), `test/screen-policy.test.ts` (the one picture read under `screen:` is the person's) |
| 10. The notice has fixed text, no `what`, and honours notifications | `test/handoff-service.test.ts` ("the request") |
| 11, 11b. Browser path masks every read in the three forms, on the first and later reads; under 4 characters not masked; not on disk, not in a step; a picture of a page that shows it refused. Shell path: output masked | `test/browser-handoff.test.ts`, `test/typed-values.test.ts`, `test/browser-intermediary.test.ts`, `test/sandbox-session.test.ts`, `test/host-session.test.ts`, `test/handoff-scan.test.ts` (nothing on disk) |
| 12, 12b. The prompt text in both languages when offered and absent otherwise; the warning composed from what the agent has, in both catalogs | `test/prompts-screen.test.ts`, `test/handoff-warning.test.ts` (the composer, every key in both catalogs), `test/live-screen-ui.test.ts` (the viewer shows the composed lines) |
| 15. Every string in both catalogs, tokens only, public audit | `npm run i18n:lint`, `node scripts/theme-audit.mjs`, `node scripts/public-audit.mjs` |

Also covered: the card for the run and the conversation, Decline and Give back, the phone's text (`test/handoff-ui.test.ts`); the viewer's warning, banner and Give back, the person's frame channel (`test/live-screen-ui.test.ts`); the post of a conversation's recording that keeps a hand-off (`test/attachments-video.test.ts`); the run file format 4 (`test/runs-store.test.ts`).

## What the suite cannot prove: by hand

Both need a Linux machine with Xvfb. Use a throwaway data folder and no real site, account or credential:

```bash
export CERIMONIAS_DATA_DIR=$(mktemp -d)
export CERIMONIAS_SPECS_DIR=$(mktemp -d)
npm run dev
```

Serve a page of your own (a form with a field and a password field) and give a test agent the screen, the page's host and a shell; paired phone or browser: pair one against the same throwaway folder.

### Criterion 13, in the sandbox and then with the agent set to `shell: host`

1. The agent calls the tool: the card shows at the top of the run and on the phone; the phone's notice says the agent waits on the computer and does not carry what it asked.
2. **Take the screen** opens the viewer with the warning; nothing reaches the screen before the click (move the pointer and press keys: the page does not change). On `shell: host` the warning has the extra sentence about the computer.
3. After **I understand, take the screen**, typing reaches the page. The phone's viewer shows "held" and no picture; the desktop shows the picture.
4. **Give back** ends it. The agent goes on, finds itself logged in, and the page it reads through the app's browser shows what was typed as `[secret]`.
5. The thread has the lines of asked, taken, the one interval line and back. The recording shows the interval marked as a hand-off, and the evidence list says it holds one.

### Criterion 14

1. **Decline** from the phone, and from the desktop: the agent is told, the card goes.
2. An unattended request: after 15 minutes the card goes and the agent is told it was not answered (shorten the wait in a build for the check, or wait it out).
3. The exit chord, then closing the viewer, in the middle of a hand-off: the phone still shows "held", the card stays, control can be turned on again with no warning, and **Give back** still works.
4. Restart the app in the middle: the card is gone and the stage starts over.

## Not verified when this was written

- A whole stage or conversation with a real model, in a real sandbox, up to the recording appearing in the app.
- The real `@playwright/mcp` server: the masking was tested against a fake server that returns the shapes the intermediary already normalises, and a Claude SDK server given the tool's own call bound; no real page was read after a real hand-off.
- Other keyboard layouts and dead keys (the typed text is rebuilt from the keys; a value the page reformats is not matched, and one under 4 characters is not masked).
- The shell path is best effort by design: a program the agent had already started can still capture the screen.
