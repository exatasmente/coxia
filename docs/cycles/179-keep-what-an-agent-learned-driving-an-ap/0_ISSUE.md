# 179 Keep what an agent learned driving an app or a site, and follow it the next time

- Endereço: https://github.com/exatasmente/coxia/issues/179
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

An agent that drives an app or a site through its virtual screen explores it every time: where the menu is, which button saves, how the form behaves. The same task a week later costs the same exploration, the same tokens and the same mistakes.

## What you would like to happen

- **Every GUI task leaves a record** of its steps and what was learned (the path that worked, what to avoid, waits and pitfalls), per app or site and per kind of action.
- **The next time, the agent reads it first** for the same or a similar action, and follows it, exploring only what changed. When the app changed and a step no longer works, the record is updated, not appended forever.
- **The person can see, correct and delete** these records, per agent or shared, the way the cycle memory is shown today.
- **No secret in a record**: a record never holds what the person typed during a hand-off (#178), passwords, tokens or personal data read from the screen.

## Notes

- Depends on #177. Related to the shared memory of the agents (#141) and to the cycle memory.
- Whether a record is per agent, per workspace or shared across workspaces, and how "similar action" is found, is for the refinement.


