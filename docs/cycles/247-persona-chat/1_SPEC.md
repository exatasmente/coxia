# Persona: the agent type, its wizard and a chat home in place of Today and the ceremony screen

## What is asked

Issue #247, the first of the five that make up #245 (a persona of the person that acts in the app on their behalf). This one is the foundation; the others build on it:

- **A persona agent type.** One persona per workspace, the person's representative in the app, with its own editor. The name must not clash with today's `agents.persona` (the tone appended to prompts).
- **A wizard to build it**, reusing the agent creator with AI (#145): rounds of questions, a draft that cannot act, a test conversation. It asks who the person is, how they decide, what matters to them and what they never want done.
- **A chat as the home**, replacing Today (the home) and the Call screen (the pre-daily) as the place the app opens on: full screen, text, on the computer and on the paired phone, answers streaming as they are written, the activity tree of the persona's work under its messages.
- **A new place for what leaves the home** (tiles, jobs bell, "needs you", activities, ceremonies), and ceremonies that keep working.

## What the maintainer settled

These came out of the conversation that opened the epic. They are product decisions, not proposals. Most land in the sibling issues; they are recorded here so that this one leaves room for them.

1. **No fixed limits for the persona.** It approves its own proposals, changes its own permissions, answers the browser's holds and the plugins' permission requests, and sees secrets. (#248, #251.)
2. **The chat works on the paired phone from the first version.**
3. **What is kept is visibility.** Every action of the persona is audited as the persona's, and a control stops it at once. (#248.)
4. **One persona per workspace**, not per person.
5. **Before #248 the persona can only chat** (and open ceremonies and screens). Its tools come in #248, voice in the chat in #249, schedules in #250, plugins, MCP and secrets by reference in #251.
6. **Gates keep their autonomy.** Nothing here changes how a gate is decided.

## What changes for the person

- Opening the app lands on a **chat with the persona**: a header, the conversation, a box to write in. On the phone the chat is the whole screen.
- The person writes; the persona's answer **appears as it is written**, with a **Work** section above it (the activity tree of what it did to answer: sub-agents, agents it called, its reasoning as closed lines) that is open while it works and closed once the answer is complete.
- In a workspace **with no persona yet**, the home opens the **wizard** instead: a few questions about who the person is, how they decide, what matters and what they never want; a draft the person adjusts and tries out in a test conversation; **Save and open the chat** ends it. "Not now" shows the Overview instead.
- Everything Today offered is still there: a **status strip** at the top of the chat counts what is blocked, what asks, what waits in Actions and what needs the person, and opens the **Overview**, a screen that holds Today's content unchanged. The menu carries the screens the Today header listed.
- Asking the persona "start the pre-daily" or "show me the board" gives a reply with a **button** that opens it. The ceremonies are also in the menu, so none depends on the model understanding the request.
- The pre-daily notice opens the chat, which shows a **ceremony card** pinned above the box: start it, go back to it, or open its minutes.
- The ceremony screens (the pre-daily, Deep, Gate, QA hand-off, Retro, Re-entry, Conflict, minutes) look and behave as before; their "back" lands on the chat.

## Where things stand today

Checked against this tree (release `0.9.0-beta.19`, schema 28); every line number below was read again for this spec.

| Piece | What it does today | Where |
|---|---|---|
| Home and screens | The screen union has `today` and `call`; the app starts on `today`; `deep` remembers whether it came from either. Both are drawn by `App`, which also draws the bottom bar, the jobs dock and the update prompts | `src/renderer/src/App.tsx:48-51,91,180-184,243-250` |
| Setup first | A workspace whose setup never finished lands in the setup wizard before any screen | `App.tsx:94-97,240-241` |
| Today | One screen with: greeting and the nav buttons of the desktop (`:109-150`), the jobs bell (`:145`), the Agora card (`:153`), the tiles (`:154`), the needs-you list, run needs and the module banners (`:155-161`), the day's time (`:162-164`), the activities with filters and refresh (`:166-234`), and the four ceremonies with the squad picker (`:237-289`). It also prepares every card's turn as soon as the cards are there (`:65-67`) | `src/renderer/src/screens/Today.tsx:31` |
| Call | The pre-daily: the moderator's opening, one turn per card, replies (`api.reply`), decisions and effects queue, the end and the minutes. It is the only producer of the ceremony's log, decisions, effects and call index | `src/renderer/src/screens/Call.tsx:39,68-82,193-230,277,286` |
| Ceremony state | `useCeremony` lives in `App`: cards, turns, decisions, effects, log, call index, deep dives, minutes. It is restored from disk and saved after every change; Deep, Gate, QA hand-off, Re-entry, Retro, Discussions, Minutes, Conflict and the run screen read it | `src/renderer/src/ceremony.ts:38,74,113-122,150-154`; `App.tsx:185-237` |
| Where a notice leads | The pre-daily notice (`call`), the tray's "ceremony now" (`call`); status changes, feedback, watchers and the push burst (`today`); `PUSH_SCREENS` and `parseTarget` accept both names; a tapped notification on a phone goes through `targetToScreen`, which falls back from `call` to `today` when no cards are loaded | `src/main/scheduler.ts:101,106,110,127`; `src/main/index.ts:131,139`; `src/main/watchers.ts:293-294,331`; `src/main/feedback.ts:206`; `src/main/webPush.ts:247,265`; `src/shared/push.ts:27,37`; `src/renderer/src/pushTarget.ts:7-8`; `src/renderer/src/jobNotify.ts:10`; `App.tsx:145-146`; `src/shared/types.ts:465` |
| Phone navigation | The bottom bar has Today, Call (live dot, disabled without cards), Actions, History, More; it is hidden on conversations (where a composer lives) | `src/renderer/src/screens/BottomNav.tsx:95-96`; `src/renderer/src/dashboard.ts:273-296` |
| The agent creator | A side panel in four steps (request, questions, review, test). The model (role `deep`) is called with no tool and a schema; the draft agent is an ordinary team entry marked `draft`, inert by construction; its test conversation is the direct conversation `agent-<id>` rendered by `Thread`; concluding empties it, discarding removes agent and conversation. Every channel is the window's alone | `src/renderer/src/screens/team/AgentAssist.tsx:24,86-138,152,254-263`; `src/main/agentAssist.ts:106,110,150,204,218,230`; `src/main/agentAssist-core.ts:48,87,266`; `src/shared/agentAssist.ts:16,179,319`; `src/main/webPolicy.ts:74` |
| Direct conversation | One thread per agent of the working team, `agent-<id>`, made when the forum is listed; a person's message in it calls its owner with no `@`; one answer at a time per thread | `src/shared/forum.ts:117,176`; `src/main/forum.ts:103-106`; `src/main/forum-channels.ts:21,33`; `src/main/mentions/module.ts:42,49,96-135` |
| How an answer is made | The prompt carries the last 40 messages; the call's schema is `{text}` (plus `proposals` when the agent's tracker setting is `read`, which is the default of a reading agent); the engine returns the whole object, and the answer is posted once, whole | `src/main/mentions/call.ts:209,214-217`; `src/main/mentions/answer.ts:171,399-403,502` |
| Streaming today | The open engine already receives the text piece by piece (`onText`) and uses it only as a sign of life; the Claude SDK loop reads whole assistant messages and requires `structured_output`, and never asks for partial messages (the option exists). A call with no schema is already supported by the open engine's loop (the text is the answer) | `src/main/engine/open/client.ts:98-107`; `src/main/agents.ts:707,515,938-951`; `src/main/engine/open/loop.ts:578,654`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1863` |
| Activity | The activity tree (#239) is built from lines carrying the `call` (agent, thread, the message that named it) and a parent link; `useActivityTree` builds it per job, `ActivityTree` draws it. In a conversation the job is `mention:<thread>`. `Thread` shows one flat call line under the message instead, with "watch" and "stop". Lines go to the window and to every paired browser | `src/shared/activity.ts:10,41`; `src/renderer/src/useActivity.ts:43`; `src/renderer/src/ActivityTree.tsx:118`; `src/renderer/src/screens/cycle/Thread.tsx:64-89,135,539-548`; `src/main/index.ts:63-66,284` |
| The composer | Text, `@agent` completion, files by button, drop or paste; Ctrl or Cmd plus Enter sends; at most 20,000 characters per message | `Thread.tsx:301,346,463`; `src/shared/forum.ts:164` |
| The team in config | `AgentDef` with the optional `draft`; `workingTeam` keeps drafts out of whoever works, is called or is offered; `stageAgent` and the template export check `isDraft` directly; validation of the team | `src/shared/config/types.ts:626,674`; `src/shared/config/team.ts:106,109,121-125`; `src/shared/cycles/apply.ts:109`; `src/shared/config/validate.ts:87` |
| The tone | `agents.persona` and `roles[].persona` mean "tone appended to prompts"; neither is shown to the person under the word "persona" | `types.ts:580,735`; `src/main/agents.ts:449` |
| Schema | Version 28; 27 steps; the last one (`v27ToV28`) added `runner.showReasoning` | `types.ts:5`; `src/shared/config/migrations.ts:407-416` |
| What the phone may change | `agents.team` is one editable path, with field-by-field refusals for what raises reach; everything not listed is refused. `agentAssist:` is denied by a pattern; forum channels are open | `src/main/configScope.ts:17,70,124`; `src/main/webPolicy.ts:13,62,74,101-105` |
| Tests | The renderer is not rendered by any test (`environment: 'node'`); the logic above the markup is tested as plain functions | `vitest.config.ts:12`; `test/dashboard.test.ts` |

## Rules

### The persona

1. **One persona per workspace, found by its kind.** It is a member of `agents.team` with a new optional `kind: 'persona'`; absent is an ordinary agent. It is not found by id: an existing team may already have an agent with any id. A workspace with no persona has none until the wizard saves one (Q1).
2. **It takes no part in the cycle.** It works no stage, is not offered as someone to turn to, is not called by another agent, is not in a squad, is not on the list of agents the creator proposes, and is left out of a cycle template (shared or exported). Everything that already keeps a draft out of the cycle keeps the persona out as well; the plan lists the sites, which include the ones that test `isDraft` directly.
3. **It is inert in the cycle by validation.** A saved configuration with a persona that has stages, a squad, a `turnsTo`, `autonomous: true` or `system: true` is refused; so is a second persona. The permission fields are not constrained by this issue: the editor does not offer them, and a file that sets them is honoured as it is for any agent.
4. **Its starting access is that of a reading agent.** `permission: read`, `tracker: read`, `shell: none`, no screen, hosts or browser profile, the workspace's tools; its model starts as the `deep` role's, as every new agent's does (Q9). It has the learned procedures and the shared memory under the switches that already govern them.
5. **Its own editor, in Settings.** A Persona section: name, the sentence that says what it is, its instructions, its model, **Adjust with AI**, **Clear conversation** and **Delete**. It is absent from the Team list and from **Create with AI**. Editing, adjusting, clearing and deleting are done from the computer and from a paired phone alike (rule 38).
6. **Deleting and clearing ask first.** Deleting removes the agent and its conversation (files and the memory folder of the conversation go with it, as a draft's do); until a new one is made the home is the invitation of rule 13. Clearing empties the conversation and keeps the persona.
7. **What the persona's text can hold.** Its instructions describe the person (who they are, how they decide, what they never want). They are never in a cycle template, and nothing here puts them anywhere the other agents' instructions are not (Risks lists what to check in the configuration export).

### The wizard

8. **The creator's machinery, a persona's questions.** The same steps and limits: the request (here: who the person is and what they do, in their words), at most four rounds of three to six questions (open, single choice, multiple choice, "Other" on every choice), a review, a test conversation, a conclusion. The model is the `deep` role's, called with no tool, through the same path as the creator; it proposes questions and a draft and decides nothing else.
9. **The questions cover four themes.** Across the rounds the model is told to cover: who the person is, how they decide, what matters to them, and what they never want done. A round may be skipped by the person, and the model may say it has nothing more to ask. Texts the person reads come out in the workspace's language; the persona's instructions come out in English with a heading per theme, as the creator's do; the persona answers in the language the person writes in.
10. **The draft carries no settings from the model.** The review shows name, the sentence and the instructions, and says, in a line of fixed text, what the persona can do now (read, chat, open screens). The model proposes no permission, tool, stage or shell, and never `host`, autonomy or commands; the starting access of rule 4 is set by the app.
11. **The test uses a draft persona that cannot act.** It is saved as `kind: 'persona'` with `draft: true`, with the inert fields of the creator's draft, its direct conversation `agent-<id>`, and **none of the persona's own tools** (the buttons of rule 22 are not offered in a test, and #248's tools will not be either). The test is rendered by the chat view itself, in a compact form, so the person tries exactly what they will use. If a persona already exists, **Adjust with AI** tests a copy and the original does not change until the person saves.
12. **The wizard never saves silently.** Nothing becomes the persona before **Save and open the chat** (or the editor's Save when adjusting). Closing the wizard discards the draft and its test conversation, with a confirmation when there is progress. A draft left by a closed app shows in Settings with a **Discard** button, as the creator's does. The computer and a paired phone run the wizard alike (rule 38).

### The home

13. **The home is the chat; with no persona it is the invitation.**
    - With a persona: the chat.
    - With none, on the computer or on a paired phone: the wizard, full screen, as the first step of the home, with a **Not now** that shows the Overview for this session (nothing is stored; the wizard is offered again at the next opening). Finishing it saves the persona and opens the chat. The phone runs the same wizard through the same channels (rule 38).
    - This applies equally to a new workspace (after its setup) and to a workspace that existed before the update (Q6).
14. **The layout.** Header: the persona's name, the date, the test-workspace chip when it applies, the update badge, the voice toggle, the jobs bell, the menu. Then the **status strip**, the conversation, the **ceremony card** when there is something to say, and the box. The conversation keeps to the bottom while the person has not scrolled up, and shows what arrived while they were away as the forum does today (`markThreadSeen`).
15. **The box.** Enter sends and Shift plus Enter breaks the line on the computer; on the phone Enter breaks the line and a button sends. Files attach as in conversations today (button, drop, paste, the same limits and notice). `@agent` is not completed and not resolved here: other agents are not addressed from this chat, and a `@name` stays plain text (the persona calls agents through its tools in #248). A message written while an answer is going waits its turn, as in any conversation, and says so.
16. **One continuous conversation.** There is no "new chat" and no list of conversations. The persona is told the last 40 messages, as every conversation answer is, plus the shared memory and the procedures; what it must remember beyond that is what it keeps in its memory. The persona's thread is not in the Forum list (the home is its one door); its messages remain in the forum store.
17. **Messages.** A person's message and a persona's answer are drawn as bubbles with the rendering that conversations use today for text and diagrams. System lines the app writes (a failed answer, a stopped one, a held provider) appear in the flow as they do in conversations. The chat does not offer to delete a single message.
18. **The status strip.** Four counts, each a button, computed as Today computes them: blocked, asking, waiting in Actions, and needs-you (the list of Today's "needs you" with the run needs and the watcher alerts). A count of zero is quiet, not hidden. Each opens the Overview at its section, or Actions for the third. The strip needs no model call and is the same on the phone.
19. **The ceremony card.** Pinned above the box when the Agora plan has something to say: the pre-daily is ready (start), in progress (back to it, with the live dot), ended (minutes), the retro is due, or a same-day meeting exists. It is the Agora card of Today (`agoraPlan`), drawn once, and its buttons do what they did. It does not appear when the cycle has no pre-daily.

### What Today becomes

20. **The Overview.** A screen, reached from the strip and the menu, that holds Today's content as it is: the Agora card, the tiles, the needs-you list and run needs, the module banners, the time of the day, the activities with their filters and refresh, the four ceremonies with the squad picker and the footer. It is Today with the greeting and the nav buttons moved out. Its back lands on the chat. The cards are still loaded and every card's turn still prepared when the app opens, as Today did, now from the app and not from this screen (Risks). Nothing Today offered is lost; nothing new is added to it.
21. **Where each piece went.**

    | Today | Now |
    |---|---|
    | Greeting, date, update badge, test chip, voice toggle | The chat header |
    | The nav buttons of the desktop; the "More" sheet of the phone | The menu of the chat (desktop: the same buttons; phone: the sheet, with Actions and History added) |
    | The jobs bell | The chat header (same event, same dock) |
    | Tiles | The status strip, and the Overview |
    | Needs-you, run needs, watcher alerts, module banners | The Overview, counted in the strip |
    | Activities with filters, refresh, footer | The Overview |
    | Agora card | The ceremony card of rule 19, and the Overview |
    | The four ceremonies and the squad picker | The Overview, the menu, and the persona's buttons (rule 22) |
    | Time of the day | The Overview |

### Opening ceremonies and screens

22. **The persona opens things by buttons.** The persona has one app tool that offers to open a ceremony or a screen. It does not navigate: its result is zero or more buttons attached to its answer ("Start the pre-daily", "Open the board", "Open the QA hand-off for #123"). A button is a target of the vocabulary notifications already use (`to` plus an optional `ref`, `id`, `mr`, validated by `parseTarget`), stored with the message so it survives a restart and shows on every device; tapping it opens the screen on that device only. A target the cycle does not have (a ceremony the cycle turned off, a card that is not loaded) is refused to the model with the reason, and no button is made. This is the only tool of the persona in this issue.
23. **The ceremonies keep their screens.** The pre-daily (Call), Deep, Gate, QA hand-off, Retro, Re-entry, Discussions, Conflict and the minutes are the same screens over the same ceremony state, with the same voice. A ceremony started from the chat, from a button or from the menu, runs as before. The state is not touched: restoring from disk, the debounce, the save before an update, the reset when a day is deleted. The Call screen stays the place the pre-daily is held; conducting it inside the chat is not part of this issue (Q7).
24. **Back lands on the chat.** Every "back to Today" (about twenty screens) goes to the chat, and says "Home" or "Back", not "Today". `deep` remembers whether it was opened from the chat or from the pre-daily.

### Notices and targets

25. **New targets, old names kept.** `chat` (the home) and `overview` are added to the vocabulary. `today` is still accepted and means the Overview; `call` is still accepted and means the pre-daily screen. A notification, push payload or URL made before the update still opens something sensible.
26. **Who sends what.** The pre-daily notice sends `chat`, and the chat then shows the ceremony card; its push keeps the high urgency it has today (the urgency list names `call`, and must name `chat` too). The tray's "ceremony now" keeps `call`: it is an explicit request to hold it. The notices about cards (new blockers, a changed stage, feedback returns, watcher alerts, the push burst, the fallback of a finished job) send `overview`, and their wording ("click to see the activities") keeps being true. The navigate event gains the two new names; the phone follows the same mapping, and `call` with no cards loaded lands on the chat, where it landed on Today.
27. **The bottom bar of the phone.** Chat replaces Today and Call as the first item; the live dot of a running pre-daily moves to it. The chat itself has no bottom bar (it has a box at the bottom), so its header menu carries what the bar carries. The other screens keep the bar, whose first item returns to the chat.

### Answers that stream

28. **The answer appears as it is written.** From the first piece the model sends, the text grows in a bubble in the conversation, on the computer and on the phone, with no wait for the end. The pieces arrive in order; a device that connects or reconnects in the middle shows what has been written so far and goes on from there. The bubble marks that it is still being written, and the box says an answer is going.
29. **What streams is what will be stored.** The text of the turn that is the answer, with the same treatment the stored message gets; streaming adds no masking and removes none. A turn that ends in tool calls is not the answer: the text written so far moves to the activity as narration, as it is shown today, and the bubble starts again for the next turn.
30. **Stored once, whole, replacing the bubble.** The live text is never a message of its own. When the answer is complete it is posted as today and replaces the bubble with no flicker or duplicate on any device. If the app restarts mid-answer there is no message, and the failure is said as a failed answer is today.
31. **Stop.** The answer can be stopped from the bubble, as a call can be stopped today. Stopping posts what was written so far as the persona's message, marked as partial in the way a partial answer is marked today, and a line says it was stopped. A failure posts the failure line and not the partial text (Q10).
32. **Plain text, no write proposals.** For the persona the answer is plain text and not an object with a `text` field, and its answers carry no write proposals in this issue. That is what makes the text streamable by the two engines without taking it out of a JSON object piece by piece (Q3). The persona's writes come with its tools in #248.
33. **Other conversations do not change.** Every other answer (a mention in a thread, a channel, a direct conversation, a stage) is posted whole, as today; this issue does not stream them.

### The work shown under the messages

34. **The tree above the answer.** The activity of the call that answered a message (the persona's own work, the sub-agents it started, the agents it called, its thoughts) is drawn above the answer with the component of the activity tree, open while the call works, and closed once the answer is complete, with a line that says how long it took and how many steps. It is the same tree, the same masking and the same switch for reasoning as everywhere else, on the computer and on the phone.
35. **Which tree belongs to which answer.** The call is identified by the message that started it; each persona answer records the message it answers, so the tree is found for any answer, and queued messages each get their own. The activity is memory only, as it is today: after a restart the older answers have no Work section, and say nothing about it.
36. **No watch or stop of a screen here beyond the existing ones.** If the persona's call has a screen open, the "watch" and "stop" of the call line are offered on its Work section as they are on a call line today; this issue adds no new control.

### Configuration and the phone

37. **A schema step.** The version goes to 29 with one step, `28 → 29`, that raises nothing and writes nothing but the version: the new field is optional, and its absence is an ordinary agent. An older app refuses a file written by the new one instead of reading a team it cannot place. The generated JSON Schema carries the field.
38. **The phone does everything the computer does with the persona** (gate 1, the maintainer's parity decision). A paired browser chats, and also makes, adjusts, tests, deletes and clears the persona. The persona wizard's channels get a prefix of their own, open to a paired browser and pinned by a policy test (the agent creator's `agentAssist:` channels stay as they are). A change of the persona entry in `agents.team` from a paired browser is accepted. The live-text read is a read. Every change records whether it came from the window or a paired browser.
39. **Updates wait for an answer.** An answer in progress counts as work an update restart would cut, like a running call or a speech does.

## Out of scope

- **Any tool of the persona beyond opening a screen:** acting as the person in the app, approving in Actions, changing settings, the browser and the network, creating plugins and MCP servers, secrets, schedules and priorities as actions (#248, #250, #251).
- **Its own audit origin and the control that stops it at once** (#248). The Stop of an answer in progress (rule 31) is the one that exists for every call and stays as it is.
- **Voice in the chat** (#249). The voice of the ceremonies stays in their screens; the voice toggle in the header is the same one.
- **Conducting a ceremony inside the chat**, or any ceremony turn written by the persona. The persona opens ceremonies; it does not hold them.
- **A briefing the persona writes** at the start of the day, a side panel docked beside the chat, and anything that calls a model to build the home.
- **Several conversations, search in the history, a new chat, editing or regenerating a message, deleting one message from the chat.**
- **Several personas**, one per person, or a persona per squad.
- **Streaming of any other answer**, of the wizard's rounds or of reasoning (reasoning stays one closed line per turn).
- **Changing how a mention is answered** for any other agent, or the structured answer other conversations use.
- **The persona answering from the phone with a different persona** or the phone editing it.
- **Documentation of the plugin and MCP surfaces** (#251) and anything under the app's settings other than the Persona section.

## Acceptance criteria

Each one is a check a person makes on screen or by test, with the data folder pointed at an empty one and a fake model.

1. **First step.** A workspace with no persona opens the wizard, full screen, after its setup. **Not now** shows the Overview; a reopen shows the wizard again. On the phone the same workspace opens the same wizard, with the same **Not now**, and the wizard's channels answer a paired browser as they answer the window.
2. **The wizard.** The request asks who the person is; a round has three to six questions, each open, single or multiple choice with "Other"; there are at most four rounds; the prompts cover the four themes (a golden prompt test pins that the four are named); an out-of-shape answer from the model keeps the valid questions. The review shows name, sentence and instructions with a heading per theme and no setting proposed by the model.
3. **The test persona cannot act.** Testing saves a persona draft with no stage, no squad, `autonomous: false`, `turnsTo: null` and `draft: true`; it appears nowhere in the Team list; no execution chooses it; `CallAgent` does not reach it; the open-screen buttons are not offered in the test conversation.
4. **Save and open.** **Save and open the chat** removes the draft mark, empties the test conversation and opens the chat on the saved persona; the saved agent has `kind: 'persona'` and the starting access of rule 4. Closing the wizard before that leaves no persona, no draft and no conversation.
5. **One persona.** A configuration with two personas, or a persona with stages, a squad, `turnsTo`, `autonomous: true` or `system: true`, fails validation. A second persona cannot be made from the wizard or the editor.
6. **Out of the cycle.** The persona is not offered as `turnsTo` or as a squad member, is not in the agents the creator is told about, is not in a template made from the workspace, and `stageAgent` does not return it for a stage whose `agentId` names it.
7. **The home.** With a persona the app opens on the chat on the computer and on the phone; the header, the strip and the box are there; the bottom bar is not on the phone's chat and its header menu lists everything the bar and the More sheet list.
8. **Nothing lost.** Every control of Today exists in the Overview or the menu with the behaviour it had: the tiles' filters, the needs-you items and their dismissals, the activities' refresh, the four ceremonies, the squad picker, the Agora card, the bell. The strip's four counts equal the counts Today shows for the same data.
9. **Streaming.** With a fake model that sends five pieces, the bubble shows the pieces in order as each arrives on the open engine, and, with a fake stream of partial messages, on the Claude engine; a second device connected after the third piece shows the first three and then the rest; the final post replaces the bubble once, on every device, with the stored text equal to the last streamed text.
10. **Tool turns.** A turn with text and then a tool call does not leave that text in the bubble: it appears as narration in the Work section, and the bubble holds only the next turn.
11. **Stop and failure.** Stop on a streaming answer stops the model, posts the partial text marked as partial and a stopped line, and the box accepts a message again. A failed call posts the failure line and no partial text; the bubble is gone on every device.
12. **Queued messages.** A second message sent while an answer streams shows as waiting, then is answered after, with its own bubble and its own Work section.
13. **The work.** During an answer the Work section shows the tree with the sub-agents and called agents of the call; after the answer it is closed with the duration and step count; two answers have two sections, each with its own lines; after a restart the answers have no section and no error.
14. **Plain text.** The persona's call has no schema and no write proposals; an answer that is plain Markdown is stored as written; another agent's direct conversation still answers with the structured text and its proposals.
15. **Buttons.** Asking for the pre-daily gives an answer with a button that opens the Call screen; asking for a ceremony the cycle has turned off gives no button and an answer that says why; a button made for a card that is not loaded is refused to the model; the buttons are stored with the message, show after a restart and on the phone, and a tap navigates only the device it was tapped on. A button's target passes `parseTarget`.
16. **Ceremonies run as before.** From the chat, the menu and a button: the pre-daily runs, its log, decisions and effects accumulate, and the minutes are generated; Deep, Gate, QA hand-off, Retro, Re-entry, Conflict and Discussions open on their cards and return to the chat; the ceremony state is restored after a restart, and flushed before an update.
17. **Targets.** `parseTarget` accepts `chat`, `overview`, `today` and `call`; `targetToScreen` maps `today` to the Overview, `call` to the pre-daily screen (the chat when no cards are loaded), `chat` to the chat; the pre-daily notice sends `chat`, the tray keeps `call`, and each notice about cards sends `overview`; a push payload made before the update with `today` or `call` still opens a screen; the push of the pre-daily notice keeps its high urgency.
18. **The ceremony card.** On a day the pre-daily is due, the notice opens the chat with the card pinned; starting from it opens Call; with a running pre-daily the card says so and the phone's chat item shows the live dot; a cycle with no pre-daily shows no card.
19. **The bar.** On the phone every screen but the chat has the bottom bar; its first item opens the chat; Actions, History and More are where they were.
20. **Configuration.** The schema is 29; a file at 28 migrates with only the version changed; a file at 29 is refused by the previous version of the app; an agent with no `kind` is an ordinary agent; the JSON Schema carries the field.
21. **The phone's reach.** A paired browser reads and writes the persona's conversation and makes, edits, tests, deletes and clears the persona; a policy test pins the persona wizard's channels and the chat's channels as open to a paired browser and not as external effects.
22. **Clear and delete.** Clear conversation asks first, empties the thread, its files and its memory folder, and keeps the persona; Delete asks first, removes both, and returns the home to the invitation.
23. **Updates.** With an answer in progress the app reports itself busy to the updater.
24. **Wording and theme.** Every new string is in both catalogs through `t()`; the prompts of the wizard are in both catalogs; the chat uses theme tokens only; `Today`'s labels that named the screen ("Back to Today") say "Home" or "Back"; no screen has a label that still names a screen that is gone.

## Open questions

Answered at gate 1 (2026-10-10): every question is settled with its recommendation, except the phone: it does everything the computer does with the persona, the wizard included (rules 38 and acceptance 21 say so).

Each has a recommendation; the maintainer decides at this gate.

**Q1. The shape of the configuration: an `AgentDef` kind or a section of its own.**
*Recommendation: a kind, `kind?: 'persona'` on the team entry.* The persona is found everywhere an agent is found by id: its name on every message and on its activity, its direct conversation, the answer pipeline (which resolves the agent from the team), its usage and cost, its memory and its procedures, and, from #248, its permissions and its audit origin. A separate section would need a synthetic agent at each of those places. The price is that every site that keeps a draft out of the cycle must keep the persona out too (the plan lists them, and a test walks the team readers with a persona in the team), and that `agents.team` is editable from a paired browser by default, which rule 38 closes by name for this entry. The alternative, a top-level `persona` section, is closed to the phone by default (an unlisted path is refused) and cannot be confused with a cycle agent, but it duplicates the permission fields and breaks the id-based lookups; it would be the choice if the persona were never to share the agent machinery. The name `kind` is free (no field of the agent or the roles uses it), and `agents.persona` (the tone) is not renamed: nothing shows it to the person under that word.

**Q2. What the persona's chat thread is.**
*Recommendation: the direct conversation of the persona, a forum thread `agent-<id>` of the kind that already exists, hidden from the Forum list.* It brings the append-only store, unread tracking, attachments, the call pipeline, the activity job `mention:<thread>`, the queue of one answer at a time and the clearing of a conversation with its files and memory, all of which exist and are tested. The home is its one door, so the list does not show two. The alternative, a store of its own, would duplicate those and would need its own way to run the answer pipeline, which only answers forum threads.

**Q3. How the answer streams: the surface between the engines and the screens.**
*Recommendation: a plain-text call for the persona, a per-call text sink fed by both engines, a module event to the window and to the paired browsers, and a read to resynchronise.*
- **Engines.** The open engine already receives the pieces (`onText`) and already supports a call with no schema; the sink is fed from `onText`, and the text of a turn that ends in tool calls is reported as narration through the existing interim path. The Claude SDK needs partial messages requested (an option the SDK has and the loop never sets), the text deltas of its stream events passed to the same sink, and a successful result with no structured output accepted for this call.
- **Event.** One event type, carried by the channel activity lines already use to reach the window and every paired browser, with the thread, the message it answers, an offset and the new text; throttled so a long answer is not hundreds of events a second. A read returns the text so far for a device that joined late or whose stream dropped (the same recovery the activity uses after a reconnection).
- **Not stored.** The post stays what it is; the bubble is a client-side view of the event until the post arrives.
- **Plain text.** Taking the `text` field out of a JSON object piece by piece would have to be done three times (the response format of the open engine, its final-tool strategy, and the SDK's structured output), and breaks on any model that writes the object badly (`answerText` exists for that today). Plain text for the persona avoids it, at the price that its answers carry no write proposals in this issue; a direct conversation with the persona's settings would otherwise propose. Writes return with the tools of #248.
- The Claude path is the unverified part (Risks).

**Q4. Where Today's data goes: a briefing message, a side panel, or something else.**
*Recommendation: a status strip in the chat and the Overview as a screen.* A briefing the persona writes at the top of the day costs a model call each time the app opens, varies between openings, and before #248 the persona has little to say beyond what the screen already counts; it is better once it has tools. A docked side panel needs a second presentation for narrow windows and the phone, and cannot be a target of a notification. A strip (four counts, no model) plus the Overview (Today's components moved, not rewritten) keeps every control, has a route that notices can target, and is the same on the phone. A docked panel on wide windows can follow later without changing the Overview.

**Q5. The phone's layout.**
*Recommendation: a full-screen chat with no bottom bar.* The box lives at the bottom, as a conversation's does today (the bar is already hidden on the conversations for that reason). The header carries the menu, which opens the sheet with what the bar and the More sheet hold, and the strip sits under it. The Overview and every other screen keep the bar, whose first item is the chat. The alternative, keeping the bar over the box, costs a third of a small screen.

**Q6. What an existing workspace without a persona sees after the update.**
*Recommendation: the wizard first, with Not now, for new and old workspaces alike (rule 13).* One rule, no second home to maintain, nothing blocked: Not now leads to the full Overview and is asked again at the next opening, which is what makes the persona the home without forcing it. The alternative, keeping Today as the home until a persona exists, leaves two homes alive for as long as people delay, and the first-run acceptance (a new workspace sees the wizard first) would need a different rule from an old one. If Not now being asked at every opening is too much, the answer to remember is one stored flag per device, which is a decision of its own.

**Q7. Does the Call screen survive as the place the pre-daily is held?**
The issue says the chat replaces the ceremony screen "as the home", and the ceremonies "keep working", but lists Call neither among the screens that stay nor among the ones that go. This spec reads it as: Call stops being a home, a tab and a notification destination, and stays the only place the pre-daily is held, because it is the only producer of the ceremony's log, decisions, effects and minutes.
*Recommendation: keep it, reached from the chat's card, the menu, the Overview and the persona's button.* Holding the pre-daily inside the chat is a feature of its own (the ceremony state would have to come from a conversation) and belongs with the voice of #249. If the intent was to remove Call in this issue, the minutes of the pre-daily would have nothing to record them, and that needs the maintainer's word.

**Q8. Opening a ceremony: buttons or direct navigation.**
*Recommendation: buttons stored with the message (rule 22).* A navigation event is delivered to every window and paired browser, so a persona that navigated would move the phone when the person asked on the computer. A button moves the device that taps it, survives a restart, and a tap is a visible act of the person. The cost is a tap. Opening it directly only on the device that asked is possible and can be added with the persona's tools in #248.

**Q9. The persona's starting access.**
*Recommendation: `permission: read`, `tracker: read`, `shell: none`, no screen, in line with "it answers with the app's read access".* `tracker: read` lets it answer about issues and merge requests, which a chat that is the home will be asked all day. It cannot propose writes in this issue (rule 32). If the maintainer prefers the minimum of a blank agent (no tracker), the persona answers from the activities in progress and the memory only.

**Q10. Partial text when an answer stops or fails.**
*Recommendation: keep it on Stop, drop it on failure (rule 31).* A person who stops an answer usually wants what is there; a failure leaves a half sentence of unknown status. The alternative is to drop it in both cases, which is simpler and loses what the person watched being written.

**Q11. The persona's instructions are personal.**
They hold what the person says about themselves. A paired browser can read the configuration (reading is open), a configuration export is a file the person may share, and the usage and error logs may quote a prompt.
*Recommendation: keep the persona out of templates (certain: rule 2) and out of the configuration export, and say in the Persona section where its text is read.* How the export and import treat it is the plan's to settle against `src/shared/config/transfer.ts`, which was not read for this spec; the phone reading it is the same trust the maintainer gave the phone for the chat.

## How it was checked

By reading, in this stage: the issue and the epic, the specs of the agent creator (#145) and of the activity tree (#239) for structure and for what they settled, and, in this tree against the lines cited above: the app shell and its screen union, Today and Call in full, the ceremony state, the conversation view and its composer, the creator's panel and its main-process module, the forum types and the direct conversation, the mention pipeline's answer and call, the engines' text path and the structured-output requirement, the activity wire type and the tree hooks, the schema version and the last migration step, the team helpers and what keeps a draft out, the phone's policy and configuration scope, the notification senders and targets.

Not verified: nothing was executed and no behaviour was seen working. Not read: `src/shared/config/transfer.ts` (what the export carries), the settings screens' own layout, the renderer's CSS, and the service worker. Not checked: whether the Claude SDK version in use yields text deltas for a call with no structured output and ends it with a plain result (the option exists in its declarations; the loop never uses it); how the open engine's pool and wrap-up interact with a call with no schema (`wrapUp` resumes a session with no tool and expects the structured shape); whether setting `replyTo` on a persona's post disturbs the grouping of questions in a thread (the plan can use another link); whether every site that keeps a draft out of the cycle is found by `isDraft` and `workingTeam` alone; the cost of preparing every card's turn at app open once Today is not the screen that triggers it; whether another branch aimed at the same release already takes schema 29; the wording of the notices whose click target changes.

## Risks

- **Streaming on the Claude engine** is the least known part. If the SDK cannot give text deltas without a structured output, the persona streams on the open engine only, and the Claude engine posts the whole answer; the plan states which, and the acceptance for streaming on that engine becomes a decision.
- **Many readers of the team.** Some thirty lines go through `workingTeam` and others test `isDraft`. A site missed gives the persona a stage, a squad seat or a place in a template. The plan lists them, and a test builds a configuration with a persona and walks the readers.
- **The home changes for everyone at once.** Twenty screens return to Today and notices lead there; a missed one leaves a dead target. The plan lists them from a search, not from memory.
- **Preparing every card's turn** is done by Today when it appears. Moving it keeps the behaviour and its cost at app open; if the chat should not pay for it, the preparation could wait for the first time the pre-daily or the Overview is shown. A product choice, not made here.
- **A long conversation.** The persona is told the last 40 messages; the older ones are in the store but not in the prompt, so continuity beyond them is what the persona keeps in its memory.
- **Personal text in logs.** The persona's instructions are part of every prompt, and so of whatever stores a prompt (the usage records and the error log). Q11 concerns the export; the logs are checked at the plan.
- **No render test.** The chat, the strip and the Overview are drawn by components that no test renders; the decisions above the markup (the counts, the targets, the stream assembly, the mapping of answers to trees, the card plan) must be plain functions with tests.

## Priority and milestone proposed

- **Priority: `priority:high`.** It is the foundation of the epic: the four other issues have nowhere to stand until the persona and its chat exist, and it changes the screen every person sees first. A proposal; the person accepts or refuses.
- **Milestone: the next beta of `0.9.0`**, the release the work is based on. The schema goes from 28 to 29 there; a person who saves with the new build cannot go back to the previous one. The release note says what the person sees: the app opens on a chat with a persona; Today's content is the Overview; the pre-daily notice opens the chat; the ceremonies are unchanged.
