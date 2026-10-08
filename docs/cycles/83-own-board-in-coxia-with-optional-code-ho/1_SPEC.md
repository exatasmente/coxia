# A board of its own, where a code host is optional

## What is asked

Out of the issue, in its own words:

> ## What should happen
>
> The code-host integration (GitLab, GitHub, Bitbucket) becomes optional: a workspace runs with no host at all. Coxia gains its own board, which works on its own and, when a host is connected, stays in step with it.

> ## Acceptance
>
> - A workspace with no VCS configured creates, moves and lists cards on the Coxia board.
> - With a host connected, the same card appears on both sides and does not become two competing records.

The issue also names what had to be settled before the work:

> Which side is the source of truth: the Coxia board with the host mirrored, or the host with the board caching it. This is a scope decision and changes the rest of the item.

and, in the comment that keeps it out of the cycle for now:

> falta decidir qual lado é a fonte da verdade (o quadro do Coxia ou o host). Depois vira épico em duas partes: quadro local e sincronização com o host.

A comment inside the description says what is open today: opening a card ends with the host, listing the day already reads it, moving a card has more than one route, and the board itself is missing.

Two decisions were given from outside the code (support took the second from whoever opened the issue, and refinement relies on both without asking them again): the **code host is canonical** and the board is its **local mirror**, one card on both sides and never two records; and the host is read **together with the app**, at the rhythm the app already has, which today is on demand — when the day is built, when the board is opened, or when the person refreshes by hand. The mirror gets no clock of its own.

**What this change delivers is the first half**: the board on its own, for a workspace without a code host. The step with a connected host — a card opened here reaching the host, the board following what the host does, the waiting that reveals a new blocker on its own clock — is the second half and a delivery of its own. The rules below are the fence the second half will have to respect; none of them is built here.

## What changes for the person

In a workspace with no code host configured, the day stops being empty. A card can be opened on the board itself: a title, a description to explain it, and a column to start in. Once it exists it can be moved between the columns, prioritised, given to a squad, commented on and closed. Everything works from the machine: it leaves nothing and waits for no host.

Cards opened this way appear where cards have always appeared — the day, the ceremonies, the squads' view, and the count of the cards that did not fit in the list — and they carry an address of their own, which never looks like a code-host address. What is commented, prioritised, moved or closed is reflected at once, because it is stored with the workspace and does not have to travel.

"Open a card" is **saving without leaving the machine**, not a second board beside the host's. In a workspace that has a host, writing a card on the board goes through the mirror, so nothing in a workspace with a host changes with this delivery.

Between one read and the next the board already answers with what exists today: the time the day was last checked and, when the cards come from a code host, the photograph of the previous day and the lines saying what moved and what is blocked since then. None of that is invented, and nothing new reads on a clock of its own.

What is said about a card without a host uses the neutral words the app already has for a workspace with no integration, and no blocker comes from a card that makes no such claim.

## Rules

- **A card opened here is a card of this board, and a host's card is the host's.** A board card has no address outside the board, carries no leading zeros in its reference, and is not offered an action that would take it to a code host. A card that only exists on the board does not start a run: starting a run still begins from a card read from the host.
- **The name a column goes by is the workspace's.** The columns are the stages the workspace already configured, shown in the workspace's own language. A column the board cannot back is not offered as a destination and the board says why instead of pretending the move happened.
- **Nothing leaves the machine without a person saying yes.** A card opened, moved, prioritised, commented or closed on the board is the workspace's own data, and it is refused in a test workspace exactly as it is outside one. Anything meant for a code host stays a proposal that waits for the person's yes.
- **A card is stored with the workspace, never in a repository.** Cards of a board with no host are not committed, not shared, not backed up to a host and not part of the code.
- **The card's own vocabulary exists.** Blocker texts carry a host variant ("pipeline" and "checks") because the host was the only place they came from; a card born on the board has no host to take words from, so the neutral text is used and the variant is not guessed. The same goes for the word the app shows for the source of the cards and for the details of a card that carries the host's data (the labels, the milestone) only when it came from a host.
- **One board, not two.** An opened card and a card read from a host are never two records of the same thing, and a workspace that has a host is not given a local board beside it.

## Acceptance

Each of these is something a person can check. The first five are this delivery; the last two say what must still hold, and stay marked as **not verified here**: no screen was opened in this stage.

1. A workspace with no code host configured opens a card on the board and sees it there, without an error.
2. That card can be moved between columns, commented, prioritised, given to a squad and closed, and each of those does what it says on the card.
3. The day, the ceremonies, the squads' view and the count of the cards that did not fit include the cards opened on the board, and that count grows when one is opened.
4. The card says where it came from: the board's own address, with no path that looks like a code-host address, and the board offers it no action that would take it to a host.
5. A test workspace refuses opening, moving, commenting, prioritising and closing a card, and says the refusal.
6. With a code host connected, the board reads, lists and refreshes exactly as it does today: order, the day's photograph, what moved, what is blocked, the partial list and which thread entry is hidden are unchanged; this is the guard for the second half and was not exercised here.
7. With a code host connected, a card that exists on the host is never shown as a second record of the same thing; this was not exercised here.

## Out of scope

- **The board is not published anywhere.** Cards opened on a workspace without a host stay in the workspace's own data, and the list of what is published nowhere is the first thing the second half inherits.
- **No card of any kind starts a run.** The run still begins with an issue read from a code host; a card opened on the board starting a run is a separate change (it needs the second half, because the run also has to publish its result).
- **A workspace with a host is not given a second board.** There is one board, and with a host it mirrors; this delivery changes nothing there.
- **The mirror invents no clock.** No new background reading of the host, no scheduled re-scan of the board, no automatic comparison that turns a card into a blocker, and no waiting that re-reads the board behind the person's back.
- **Writing comments back to a code host from the ceremonies.** The daily note stays with the host's own tool where there is one; with no host it stays in the minutes, as today.
- **The daily note is not stored on a board card.** What a note says about a card closed or moved on the board stays in the minutes; the cycle already records decisions there.
- **Agents do not complain about the cards they cannot see.** An empty day does not become an error when the workspace has no cards: that behavior stays as it is.

## Open points for the plan

- **Where a card opened on the board lives, and what it carries.** The plan decides. Required of that answer: an identity that does not clash with a host's reference, a column, a place to belong to, a time to order by, and a history that can be read back.
- **How the board finds and serves those cards.** The cards of the day come from a source that today returns items for a day report. Plugging the workspace's own cards into that source, or reading them beside the report, is the plan's decision; the party that builds it also has to answer what an empty day shows before the first card is opened — nothing, or the invitation to open one.
- **How the host maps the board's columns.** The rules above allow any of them; which pattern a host uses for a stage is the plan's, and the first thing to settle before the second half.
- **The command by which a card is opened, moved, closed or given to a squad, and how the paired browser may reach it.** A command that changes the workspace's own board is not an external write; the plan says how it is classified and keeps the path that changes nothing outside the machine.
- **Which rule text this change makes false, and where.** The project's own documentation says a card carries priority and milestone "from the tracker" and that a run starts from a card read from the host; whichever sentence the delivered behavior makes wrong is corrected in the same change, and those corrections are part of the plan.

## What was verified

Checked by reading the code of this working tree, not by running it:

- The day's cards are empty when the workspace has no code host: the daily report asks the integration first and the internal source returns nothing when it is not usable, which the screens show as a day with no activities, not as an error.
- Nothing in the app opens, moves or stores a card that does not exist on the host, and the only plan of a card's note that exists is the external command's.
- After today's reading, the delivery has to cover more than storing a card: a run is only ever started for a card whose content was read from the host; the party that decides which squad a card belongs to reads the host's labels and the host's project, the repository link being the one that can see a card that belongs to nobody is a weak clue and not relied on here; and the party that decides what a card says while it is blocked has its per-host variants.
- What a card carries for priority and milestone comes from the tracker; the board's shape in storage will have to say how its own card fills them (for instance, a milestone none, a priority one of the labels the workspace already has).
- Blockers of a card exist in two wordings, "pipeline" and its on-GitHub form "checks", and the umbrella word for a workspace with no integration is the one the app already carried.
- The count of the cards that did not fit the list is shown from the day's report, so cards the board adds enter it by themselves.
- Nothing in the read of the ceremonies or of the runner changes with this delivery: with no integration the reading policy is empty, and the runner's own door is untouched.

Nothing was executed and no screen was opened for this document.
