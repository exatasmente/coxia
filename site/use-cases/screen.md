# A login on a virtual screen

An agent has to reach a page behind a login. It must not see the password, and the person must not
have to type it into a chat.

**The screen.** The agent works on a virtual screen the app opens for it — 1280×800, on the machine,
never the person's own display — and drives the app's browser on it. The person can watch that
screen from the run's card, and the app records it while a window is drawn on it.

**The request.** When the agent reaches the login, it calls the handing-over tool with one sentence
about what it needs. It cannot ask for a password in the conversation and cannot accept one in a
tool's text. A card appears where the agent works, and the phone is notified that the agent is
waiting *on the computer*.

**The handing over.** The person takes the screen after a warning that says the interval is recorded.
Control is on with no switch, and what they type becomes XTEST events on the virtual screen: the
agent's browser sees the field filled, and the person's password never passes through the model, the
conversation, the audit log or the step log. No picture of the screen goes to a paired reader while
the person holds it.

**Giving it back.** The person gives the screen back, and from then on what they typed reads as
`[secret]` in every read of the app's browser and in the output of the agent's commands. The limit is
said plainly: the mask lasts as long as the stage or the answer that took the interval, so a value
still on the page afterwards can be read by the next one — submit or clear it before giving the
screen back.

The whole of it, including what the app cannot promise, is in
[The runner](/reference/runner#a-virtual-screen-for-any-agent-177).

<!-- site:image-placeholder -->
> **Screenshot (pending).** The warning before a person takes a screen an agent handed over. Taken
> from the app over a seeded workspace with fictitious data, refreshed with each release.
