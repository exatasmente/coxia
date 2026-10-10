# 187 Draft procedures from what the agent did, and offer to keep them when nobody saved one

- Endereço: https://github.com/exatasmente/coxia/issues/187
- Estado: open
- Rótulos: enhancement
- Autor: exatasmente

## Descrição

## The problem

The learned procedures (#179) are written only when the model decides to call `procedures_save`, and in practice it rarely does:

- **Commands.** A developer agent that runs scripts, fails and adjusts until it works leaves no procedure: the app sees every command and its exit code, but drafts nothing from them, and the agent has to remember to write the steps itself. The next run explores again.
- **The screen.** `procedures_draft` sees only the steps of the current answer. In a conversation a site task spans several answers (navigate, the person logs in, type, send), so no single answer holds the whole task and a draft at the end holds only the last click.
- In the first real use of 0.9.0-beta.8, a site task in a direct conversation and the first runs left no procedure at all.

## What you would like to happen

- **The app drafts a `repo` (or `tool`) procedure from the commands of a stage or an answer**: the path that worked (the commands that succeeded, in order), without the failed attempts and without secrets (the same refusals a record already has: credentials, flag values, tokens), with the failures offered as pitfall candidates.
- **The screen's draft covers the whole screen**, from when it opened, not only the current answer, so "keep what you did as a procedure" works at the end of a long conversation.
- **At the end of a stage, or when a screen closes**, when there was trial and error (commands that failed and then one that worked, or several browser steps) and no procedure was saved or followed, the agent is given the draft and one last turn to save it; if it does not, the person sees a card "Keep this as a procedure?" with the steps, and a yes saves it as reviewed.
- Nothing the person typed during a hand-off, and nothing secret, ends up in a record (#178, #179 rules unchanged).

## Notes

- Builds on #177, #178 and #179 (in 0.9.0-beta.7/8).
- Open question 13 of #179 deferred drafting from commands because commands can carry secrets in arguments and environment; the refinement must say how the draft keeps them out.


