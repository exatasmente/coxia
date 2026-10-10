# 177 Let any agent have a virtual screen, and watch it from the conversation it works in

- Endereço: https://github.com/exatasmente/coxia/issues/177
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

Only a QA stage gets a virtual screen, and only that stage's screen can be watched (#157). A person who asks an agent in a conversation, in the forum or in its direct conversation, to "open the browser and update the spreadsheet" has no way for that agent to get a screen, and no way to watch it work.

## What you would like to happen

- **Any agent can have a virtual screen** when its work needs one: in a stage of any kind, in its direct conversation, in a squad channel or in a run's thread when it is mentioned. Never the person's own screen.
- **Live screen wherever the agent is talking**: the conversation that started the work shows the same viewer as the stage card (watch on the phone, take control on the computer), and the recording is kept as evidence of that conversation's work.
- **Network, per agent** (maintainer decision): an agent in the sandbox reaches only the hosts the person allows for it, through the existing proxy; or the agent is set to run on the computer (`shell: host`) and uses the network as the person does. The person chooses per agent.
- **A logged-in browser, per agent** (maintainer decision): the agent's browser profile (cookies, local storage) is kept between uses in the app's data folder, mode 0600, never in a worktree and never in what the model reads. Settings show which sites hold a session for each agent, and the person can revoke one or all.
- **Authorisation** (maintainer decision): the person's request in the conversation authorises the task; before an irreversible step (send, save to an external service, delete, publish, pay) the agent stops and asks; everything it does on the screen is recorded and audited.

## Notes

- Builds on #157 (virtual display, live screen, recording) and is a prerequisite of the screen hand-off (#178) and of the GUI memory (#179).
- This touches the rule that the only door to an external effect is the approval in Actions: the refinement must say how the stop-before-irreversible rule is enforced and audited, not only asked of the model.
- One live screen per run today; a conversation that is not a run needs its own key.


