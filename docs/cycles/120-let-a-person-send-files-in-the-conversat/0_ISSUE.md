# 120 Let a person send files in the conversations and the agents open them

- Endereço: https://github.com/exatasmente/coxia/issues/120
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## What should happen

A person can send files in any conversation of the forum (a run's conversation, a general conversation, a channel, the direct conversation with an agent), from the app and from a paired browser, and the agents that take part in that conversation can open them.

Today a message only points at files of the run's cycle folder (`ArtifactRef`, `src/shared/forum.ts`); a person has no way to attach anything, so a screenshot of a bug, a log or a design reference has to be described in words.

### 1. Attaching

- The message box takes files: a button, drag and drop on the computer, paste of an image, the file picker on the phone. Several files per message, each shown before sending with its name and size, and removable.
- Limits, set in the workspace (with defaults): size per file, size per message, and the kinds accepted (images, text and logs, PDF, JSON/CSV; anything else refused with the reason). The kind is checked by the content, not by the name.
- A file is kept in the workspace's data, by conversation (`workspaces/<id>/…`), never in a repository and never in the run's worktree. A file the person removes from a message is deleted.

### 2. Showing

- An image shows as a thumbnail in the message and opens full size; any other file shows as a chip with name, kind and size, and opens or saves.
- The paired browser shows and downloads them through the same web policy as the rest of the forum.

### 3. The agents read them

- An agent called in that conversation (a mention, the answer to a question, the stage that resumes after the person's message) is told which files the message carries and gets a read-only tool to open them: an image goes to the model as an image (on both engines: the open engine's `Read` refuses binary files today), text as text, capped.
- An agent never gets a path on the computer; it only reaches the files of the conversation it was called in.
- What is sent to a model provider leaves the computer: the attach box says so once, and a workspace may turn attachments to agents off.

## Out of scope

Agents creating files of their own (the evidence work is a separate issue that builds on this one), and sending attachments to the code host.

## Acceptance

- A person attaches an image and a log to a message in a run's conversation, from the computer and from a paired phone; both are shown and open.
- A file over the limit, or of a refused kind (checked by content), is refused before sending, with the reason.
- An agent called with `@` in that message describes what the image shows and quotes the log, on both engines.
- An agent called in another conversation cannot open those files.
- Deleting the message deletes its files from disk.

## Notes

Functional specification only; the solution design belongs to refinement and planning. The storage and the attachment model built here are reused by the agent evidence issue.

## Comentários

(sem comentários)
