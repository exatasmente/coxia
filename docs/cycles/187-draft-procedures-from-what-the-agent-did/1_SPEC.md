# Draft procedures from what the agent did, and offer to keep them when nobody saved one

Both gates are **waived by the maintainer (2026-10-09)**: the maintainer approved implementing directly. Every product choice the issue leaves open is answered below with the recommended answer and recorded as "decided at refinement (gates waived by the maintainer, 2026-10-09)". The plan is `2_PLAN.md`.

**verified 2026-10-09** marks a fact read in the code on `release/0.9.0` at `fcb0e76c` (0.9.0-beta.9), config schema 23, run format 6. Nothing was run: no test, no `tsc`, no app.

## What is asked

The learned procedures (#179) exist only when the model calls `procedures_save`, and it rarely does. The issue asks for four things:

1. **Commands:** the app drafts a `repo` (or `tool`) procedure from the commands of a stage or an answer: the path that worked, no failed attempts, no secrets, the failures offered as pitfall candidates.
2. **Screen:** the draft covers the whole screen from when it opened, not only the current answer.
3. **Offer:** at the end of the work, when there was trial and error and nobody saved or followed a procedure, the agent gets the draft and one last turn; if it does not save, the person sees a card "Keep this as a procedure?" and a yes saves it as reviewed.
4. **Safety:** nothing the person typed in a hand-off and nothing secret ends up in a record (#178 and #179 rules unchanged). Open question 13 of #179 asks the refinement to say how a command draft keeps secrets out.

## Where things stand (verified 2026-10-09)

| Piece | Today | Source |
|---|---|---|
| The screen draft | Built by `procedures_draft` from `ProcedureScreen.steps()`, which keeps only the steps **after the highest step number present when the call began**. In a screen kept between answers it therefore holds the current answer only. This is the bug the issue names, and two tests pin it | `src/main/procedures/screen.ts:52-53`, `test/procedures-screen.test.ts:14`, `test/procedures-gui-calls.test.ts:126` |
| Where the steps live | `Session.log` (a `StepLog`, up to 2,000 steps) in the screen session, exposed as `stepsOf(key)`; it dies with the screen. A stage's screen is new per stage; a conversation's stays open about ten minutes between answers | `src/main/browser/sessions.ts:137,175,663`, `src/main/browser/stepLog.ts:40` |
| The draft builder | `buildDraft(entries)`: one worded step per action, failures to pitfall candidates, a `type` step reads `<value>`, undone steps dropped, waits measured. Pure | `src/main/procedures/draft.ts:139` |
| Draft tool and save | `procedures_draft` is offered only to a call with the app's browser. `procedures_save` of kind `gui` takes a `draft` id and the numbers of the steps to keep (`{n}` or `{n, text}`); any other kind refuses a `draft` ("a draft is for kind gui only") | `src/main/procedures/session.ts:207,256,273,353`, `src/main/procedures/tools.ts:54,70-71` |
| Commands | Every command of the agent's shell is numbered in `SandboxSession.log` (`n`, `command`, `exitCode`, `timedOut`, `refused`) for a sandbox and for a host session. In a stage the first `ran.length` entries are the app's own pre-QA commands. The log of a session kept for a screen is cumulative over answers | `src/main/sandbox/session.ts:19-32,83,345`, `src/main/sandbox/host.ts:215`, `src/main/runner/executor.ts:666,672`, `src/main/mentions/kept.ts:36` |
| The validator | `checkContent` refuses, by field and without echoing the value: credentials, secret flag values (`--password x`, `mysql -p x`), emails, home path, URL query, digit runs, opaque tokens, invisible characters, anything `redact` would change | `src/main/procedures/record.ts:98-145,156,260` |
| Provenance | `origin` has `by`, `createdBy`, `surface`, `stage`, `ref`, `permission`, `shell`, `handoff`; `store.save` sets `reviewed` only for a writer named `person`, and `createdBy` to the writer unless replacing | `src/shared/procedures.ts:69-85`, `src/main/procedures/store.ts:279,295,313` |
| Hand-off rule | A record saved by a call whose screen had a hand-off gets `origin.handoff` and waits for review (no agent lists or reads it) | `src/main/procedures/session.ts:285`, `src/shared/procedures.ts:144` |
| Extra turns | `askAgain` (a repair round) and `wrapUpAnswer` (resume with `tools: []`, `maxTurns: 2`, no exec, no procedures) exist as precedents; the first runs under the stage's watchdog | `src/main/runner/executor.ts:685`, `src/main/agents.ts:1328` |
| Ask cards | `PendingAsk` (`hold`, `confirm`, `handoff`) belongs to an **open screen**: keyed by its key, listed in `OpenScreenInfo.pending`, a promise that waits (15 min, fail closed) with the agent's clocks paused; a paired browser answers only with the external-effects switch | `src/main/browser/asks.ts:131`, `src/shared/browser.ts:104`, `src/renderer/src/screens/cycle/AskCard.tsx:52` |
| Phone policy | `^procedures:` is denied except `list`, `get`, `stats`, by a pattern | `src/main/webPolicy.ts:84,87`, `test/procedures-policy.test.ts` |
| Switch | `runner.procedures`; off means `ProceduresPort.open` returns null: no tool, no prompt section, no write | `src/main/procedures/port.ts:65-67`, `src/shared/procedures.ts:167` |

## What changes for the person

- A developer agent that fought a script and got it working leaves a draft; if the agent does not keep it, a card in the run thread (or the conversation) shows the steps and asks "Keep this as a procedure?". Yes saves it, already reviewed. No, or silence, costs nothing.
- A site task spread over several answers is drafted whole.
- The thread says when the agent had a last turn, what it cost, and when a card was offered. Work with no trial and error is unchanged.

## Decisions

All of these are **decided at refinement (gates waived by the maintainer, 2026-10-09)**. The plan's decision log repeats them with the rejected alternative.

### A. The command draft

1. **Which commands count.** The commands the agent itself ran in its shell: in a stage, `session.log` entries with `n > ran.length` that ran; in a conversation answer, the entries added during that answer (the log length is read when the answer starts, because a kept session's log spans answers). Not counted: the app's own pre-QA commands, a refused command (`refused` set) or one that never ran (`exitCode` null and not timed out), commands run by an agent the stage called, git or other commands the app runs, and tool calls that are not the Shell tool.
2. **The path that worked** is built from the command text only; **output is never read**, because output is where secrets surface. In order:
   - Strip leading environment assignments (`VAR=x cmd`, `env VAR=x cmd`) and a leading `cd <path> &&`; keep the rest. A command that is only an assignment, or begins with `export`, `set`, `unset`, `source` or `.`, is left out.
   - **Noise is dropped silently** (it is not a step and not counted as left out): `ls cat pwd echo head tail wc grep rg find tree which whoami cd true false sleep date env printenv stat file du df less more sort uniq diff basename dirname realpath test [`, and read-only `git` subcommands (`status log diff show branch remote rev-parse ls-files blame`). The decision reads the first program of the first segment of a chain.
   - A command is a **failure** when `exitCode !== 0` or `timedOut`. A failure followed **later** by a success of the **same program** (first word after `sudo env time nohup exec command`) is not a step: only the success is kept, and the failure becomes a pitfall candidate (`Failed (exit 1): npm test`, `Timed out: ...`). A failure with no later success of its program is also a pitfall candidate and never a step.
   - A success repeated word for word keeps its **last** position. Order of the kept successes is the order they ran.
   - A step is `{ text: 'Run <program> [<subcommand>]', run: <command, whitespace collapsed> }`. The subcommand is the second word when it is plain (`/^[a-z][\w:-]*$/i`); otherwise only the program. The agent may reword `text`; `run` is the app's.
3. **How secrets stay out** (five layers, all on the command text):
   1. Environment assignments are dropped (rule 2); a multi-line command (heredoc, pasted script) is left out.
   2. **Carriers are left out**: a command that mentions `.env`, `.npmrc`, `.netrc`, `.aws`, `.ssh`, `id_rsa`, `.pem`, `credentials` or `secret`; the words `authorization`, `bearer`, `cookie`, `api-key`, `passw*` or `token`; a URL with credentials (`://user:pass@`); a heredoc or here-string (`<<`); or the payload flags of a network client (`-H/--header`, `-u/--user`, `-d/--data*`, `-F/--form`, `-b/--cookie`, `--oauth2-bearer`). This errs toward leaving out: `npm run test:token` is left out too.
   3. **Every step and pitfall runs through the existing validator** (`checkContent` rules, via a new exported `checkStep`): flag values, credentials, emails, home path, digit runs, tokens, invisible characters, `redact` changes. A refused step or pitfall is left out.
   4. The stage's exact test-environment mask: a command the mask would change is left out. In a call with a screen, text that holds something the person typed (`typedIn`) is left out.
   5. The draft says **how many** commands were left out ("2 commands were left out for safety"), never which, and never why per command.
   A command longer than the `run` cap (200) is left out, never cut.
4. **Key.** `repo` with the stage's repository id (a stage works in one); in a conversation, `repo` when the place has exactly one repository, otherwise `tool` with the slug of the program that has most steps (first on a tie). The person can change the key later in the Procedures view; the card edits only the title. A `tool` record is listed only to agents that have that program among their commands, so it is the weaker home.
5. **Default title:** the text of the last kept step ("Run npm test"), reduced to the title's character set. The card makes it editable; the agent's own title wins when it saves.
6. **Trial and error (commands):** at least one failure followed by a later success of the same program, and at least one kept step. At most 20 steps are kept; a draft of more is not offered as a card (the agent's turn may pick up to 20 by number).
7. **The agent may reword a step's `text` and leave steps out, never add one**, as for the screen draft. `procedures_draft` is now offered to a call that has the app's browser **or** a shell, and returns the screen draft (`d-N`) and the command draft (`c-N`) it has. `procedures_save` with a `draft` id works for kinds `gui` (screen draft) and `repo` or `tool` (command draft); a `repo`, `tool`, `cycle` or `request` save **without** a draft stays as in #179 (the agent may still write one from memory).

### B. The screen draft over the whole screen

8. **Scope.** The draft covers the screen from when it opened, across answers, until a mark. The call-level cut (`screen.ts:52`) goes away. The mark lives in the screen session beside its log (`ScreenSessions.mark(key, n)`), so it dies with the screen and a new screen starts at 0. `visited()` (the keys a `gui` record may have) is computed over the whole screen, not the window.
9. **The mark moves** (so no step is drafted twice): (a) when a `gui` save from a draft succeeds, or the person says yes to a screen card, to the last step of that draft; (b) when the person says no to a screen card, to the last step offered (the person said "not these"); (c) when the call reads (`procedures_get`) a `gui` procedure whose key was visited, to the screen's last step then: what came before is not the changed part. A card that is ignored or expires moves nothing, so the next draft is the bigger one.
10. **Trial and error (screen):** the draft body has at least **5 kept steps** (after folding undone steps and merging waits) and at most 20. Fewer is not worth a card; more than 20 cannot be stored whole.
11. **Key and title:** the visited site with most kept steps (first on a tie); title `Steps on <site>`.

### C. The offer

12. **When it is evaluated:** once, at the end of a **concluding** stage attempt (not one that ends in a question to the person, which resumes; not a failed, stopped or cancelled one), and once at the end of each conversation answer that produced an answer (a surface of `direct`, `channel`, `forum` or `run-thread`; not a ceremony, not an agent called by another). It needs the workspace switch on (`ProceduresPort.open` returned a session).
13. **Conditions, all of them:** the call saved no procedure (no `created`, no `replaced`) and followed none (no `procedures_get`); trial and error holds for commands (rule 6) and/or the screen (rule 10). A work with both can raise two offers, one per draft. A call that followed a procedure that then failed and was not replaced is **not** offered here (follow-up).
14. **The last turn (wrap-up).** The app calls the same agent once more with a small prompt: the task line (run reference and title, or the conversation's title), the agent's own closing words (its summary or answer text, clipped to 600 characters, fenced as data), the draft or drafts exactly as `procedures_draft` words them, and the instruction: save it with `procedures_save` and a draft id if it is worth keeping and the task is **done**; if the agent is still waiting for the person, or it was a one-off, save nothing and say nothing. Rules of the call:
    - **Only the procedure tools** (`list`, `get`, `save`, `stale`, `draft`): no shell, no files, no code host, no screen, no stage tools. It is a read-only call whatever the agent's permission (`agent-read-only` holds).
    - `maxTurns` is **3** (a read, a save, a closing word); the schema is a one-field object the app ignores.
    - **No resume** of the stage's session: a fresh call carries a few thousand tokens however long the work ran, a resume would re-read the whole context.
    - It runs under its **own 120-second limit** and the stage's abort signal (Cancel stops it), outside the stage's watchdog; a failure, a timeout or a budget refusal is logged and swallowed. It never fails a stage or an answer.
    - In a stage the turn is awaited before the stage's procedure uses are closed (so a record it creates gets its baseline and the stage's usage counts it). In a conversation it runs **after the answer is posted** and detached from the thread's queue, so the next message is not held up.
15. **Cost and label.** The turn's tokens are real spend. They go into the **stage's `usage`** like any other call of the stage (no new run field), and are **not** given to the procedure session's meter, so a baseline still means "what finding it cost". A conversation answer records no usage today and still records none; in both places a system line says "{agent} had one last turn to keep a procedure ({tokens} tokens)". No turn happens when no draft meets its threshold, so ordinary work pays nothing.
16. **The card.** After the turn, each draft that no save used (the app tracks saved draft ids) becomes an **offer**: an in-memory entry (never on disk) with the steps, pitfalls and waits as drafted, the key, a default title, the number left out, whether the person used the screen, the work's provenance and usage. It is raised only if the draft is still valid for a card (≤ 20 steps, every field passes the validator). A system line says "The app offers to keep {count} steps as a procedure ({title}). Answer on the computer." (visible everywhere, never reaches a prompt).
    - The card is in the **run thread** or **conversation** it belongs to, beside the ask cards, with: the title "Keep this as a procedure?", the agent, kind and key, the steps (`text`, `run` in monospace), the pitfalls, "N commands were left out for safety" when it applies, a warning when the person used the screen ("you used the screen in this work: check that no step holds what you typed"), an editable title (80 characters, the validator's character set), **Yes** and **No**.
    - **Yes** saves through the same store and validator with the writer `person`, the work's surface, stage and reference, the agent's permission and shell, `createdBy` the agent, `reviewed: true`, `stepsFrom: 'recording'` (`keyedBy: 'app'` for a screen), the offer's usage as the baseline, and moves the screen mark (rule 9). A refusal (duplicate title, a cap, a changed repository) is shown on the card with the validator's words and the card stays. A thread line says what was kept. After a hand-off a Yes is still "reviewed": the person is reading exactly the text that is saved; the agent's own save in that call keeps waiting for review (#179 rule 24).
    - **No** drops the offer, audits it and, for a screen, moves the mark.
17. **Never blocks, times out quietly.** An offer waits **24 hours** in memory, at most **10** per workspace (the oldest goes first), and one per (thread, agent, kind, key): a newer one replaces it. Expiry, replacement and an app restart remove it with no line and no audit. The agent's clocks and the screen's idleness are untouched (this is not an ask). A second wrap-up turn for the same screen and the same mark is not given: later answers only refresh the card.
18. **The phone.** The card is the computer's. A paired browser cannot see it or answer it: the three new channels (`procedures:offers`, `procedures:offer-keep`, `procedures:offer-decline`) fall under the existing `^procedures:` denial. The reason is the one of #179 rule 18: a record is read by every agent of the workspace, so a yes from a stolen paired browser would plant text in every prompt. Declining was kept off the phone too (unlike `runs:handoffDecline`) because an unanswered offer costs nothing, where a pending hand-off holds an agent. The phone sees the thread lines. The Yes channel works whatever the switch says, as the person's other writes do; offers are only raised with the switch on.

### D. Data

19. **No new record field, run field or config field.** Config stays at schema 23, the run format at 6. New in-memory types (offer, draft candidates); new optional **parameters** (`createdBy` on a save request, a `commands` getter on a session) and two audit operations (`offer`, `decline`; a Yes is the existing `save`). The offers are not part of the configuration export and not written to a run file.

## Out of scope

- A closing turn when a conversation's screen idles out (no call is running then, the shell and the typed-value memory are gone); the end of each answer is the turn.
- Offers for `cycle` and `request` kinds, and for agents called by another agent.
- Offering a replacement for a followed procedure that failed (a follow-up).
- Persisting offers across a restart, or a list of offers in the Procedures view.
- Phone access to offers; a switch that turns offers off while procedures stay on.
- Drafting from a command's output, or from the files the agent edited between commands.

## Acceptance criteria

Each is a test unless it says "on screen".

1. **Command draft.** Over a fake log: noise and refused and never-run commands vanish without a count; a failed `npm test` followed by a successful `npm test -- --runInBand` gives one step and one pitfall; a failure with no later success is only a pitfall; a repeated success keeps its last position; the app's pre-QA commands (`n <= ran.length`) are not counted; a kept session's earlier answers are not counted.
2. **No secrets.** A table of commands is left out and counted, never shown: an `export TOKEN=...`, `curl -H 'Authorization: ...'`, `cat .env`, a URL with credentials, `mysql -p secret`, a heredoc, a 20+ character token, an email, a digit run, a home path, a command the test-environment mask changes, a command holding a typed hand-off value. Environment assignments are stripped from a kept command. The draft text and the audit entry hold the count and no command text of a left-out one. A command over 200 characters is left out, not cut.
3. **Draft tool and save.** `procedures_draft` is offered to a shell-only call and returns `c-N`; `procedures_save` with `draft: 'c-N'` keeps the recorded `run`, accepts `{n}` and `{n, text}`, refuses a step number the app did not record and any `run` the agent supplies, marks `edited`; a save without a draft for `repo` still works.
4. **Whole screen.** Two calls on one screen: the second's draft has the first's steps; `visited()` spans the screen; after a draft is saved the next draft starts after it; after `procedures_get` of a `gui` record the draft starts after the read; a new screen starts at 0. The two tests that pinned the call-level cut are rewritten to this behavior.
5. **Offer conditions.** Offered: a stage with the trial-and-error pattern and nothing saved. Not offered: a procedure saved, replaced or read; the switch off (no session); a stage that ends in a question; a failed or cancelled stage; fewer than 5 screen steps; more than 20 steps; a ceremony; an agent called by another.
6. **The turn.** The wrap-up call has only the procedure tools (no exec, screen, files, code host) on both engines, `maxTurns` 3, no resume, and its prompt holds the drafts and the closing words fenced as data and no left-out command. Its tokens reach the stage's `usage` and not the session meter. A thrown error, a 120 s timeout and a refused budget leave the stage's result unchanged; Cancel aborts it. In a conversation the answer is posted first and the next message in the thread is not delayed.
7. **Cards.** An unsaved draft becomes one offer; a saved draft becomes none; a newer offer for the same (thread, agent, kind, key) replaces the old; 11 offers keep 10; a 24 h-old offer is gone; an offer lists with no step text in the audit.
8. **Yes and No.** Yes writes a record with `origin.by: 'person'`, `createdBy` the agent, `reviewed: true`, the work's surface and reference, a baseline, and moves the screen mark; a duplicate title or a cap is refused with the validator's words and the offer stays; after a hand-off the record is reviewed and the card showed the warning. No removes the offer, audits it, and moves the mark for a screen.
9. **Phone.** `procedures:offers`, `procedures:offer-keep`, `procedures:offer-decline` answer `deny` with and without the external-effects switch; the module-scan test lists them as classified; none is in `EXTERNAL_EFFECT` or `DESKTOP_ONLY` by name.
10. **Data.** No config migration step is added; `CONFIG_SCHEMA_VERSION` is 23 and the run format 6 after the change; no run file gains a field.
11. **On screen (checked by hand on a throwaway data directory):** an agent in a stage fails a script, fixes it and finishes; the thread shows the wrap-up line and, if the agent did not save, the card; Yes puts the procedure in the Procedures view as reviewed; a second run lists it in the prompt. A site task over three answers with a hand-off yields one card with the whole task and the warning.
12. **Gates:** `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint` (the card strings and the prompt texts are in both catalogs) and `node scripts/public-audit.mjs`, with neutral hosts only in tests.

## Risks

- **A command is more than its text.** A secret can sit in an argument the five layers miss (a custom flag, a base64 blob split by spaces). The guarantee is narrow: no output is read, carriers and validator classes are refused, and the person sees every step on the card before it becomes a record. A reviewed record is still read by every agent.
- **The agent's closing words go into the wrap-up prompt.** They are already in the thread, go only to the same agent and are fenced as data; they enter a record only if the agent writes them, and the validator reads that text.
- **Premature offers in a conversation.** The turn at the end of an answer may come before the task is done. The prompt tells the agent to save nothing if it is waiting on the person, the mark moves only on a save or a No, and a card is refreshed, not stacked. A partial save splits one task into two procedures; the person can edit or delete.
- **Same program, different intent.** "Failure then success of the same program" is a heuristic: `git push` failing then `git push` succeeding is fine, `node a.js` failing then `node b.js` succeeding hides the difference. The pitfall candidate keeps the failure visible to the person.
- **`tool` keys are the weaker home** in a place with several repositories: a record is listed only to agents that have the program among their commands.
- **The turn adds latency to a stage** (seconds, at most 120), only when a threshold is met. A detached conversation turn is awaited explicitly by tests.
- **Not verified here:** that the SDK accepts a call with `tools: []` plus only the procedure MCP server (the existing wrap-up does `tools: []` with no server); that the open engine honors `tools: []` with extra tools (read from `agents.ts:496` only); the real cost of a turn in tokens.
