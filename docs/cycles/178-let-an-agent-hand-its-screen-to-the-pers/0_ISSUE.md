# 178 Let an agent hand its screen to the person for a login or a confidential input, and go on after

- Endereço: https://github.com/exatasmente/coxia/issues/178
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## The problem

An agent working a site on its virtual screen will meet a login, a second factor, a payment form or any field the person should fill and the model should never see. Today it can only guess, give up, or ask for the secret in the conversation, where it would be written and read by the model.

## What you would like to happen

- **The agent hands the screen over**: it stops, says what it needs ("log in to this site", "type the code that reached your phone"), and the viewer asks the person to take control of the screen, on the computer.
- **The person fills it and gives it back**; the agent continues from there. A notice on the phone says the agent is waiting for the person on the computer.
- **What the person typed is never the agent's**: no keystroke reaches the model, the conversation or the audit log (only "the person used the screen from … to …"), and the frames of that interval are kept out of what the model sees (the recording keeps them marked, or blurs them: the refinement decides).
- **A wait, not a failure**: the hand-off is a question to the person, with the same waiting and answering the runner already has; a stage or a conversation that waits too long says so.

## Notes

- Depends on #177 (a screen for any agent) and builds on Take control of #157.
- Whether the agent may also read the screen while the person controls it, and whether it is told what changed, is for the refinement.


