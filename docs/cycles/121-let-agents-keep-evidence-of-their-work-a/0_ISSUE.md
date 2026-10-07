# 121 Let agents keep evidence of their work and mark up images

- Endereço: https://github.com/exatasmente/coxia/issues/121
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## What should happen

An agent of a run can **keep** what it captured while it worked (a screenshot of the app, a page of the web UI, a log, a short report) as **evidence** of its stage, and can **mark up an image** to show what matters (a box around a field, an arrow to a button, a short label). QA uses it to back its scenarios, the product owner to record an exploratory validation, any agent to show what it saw. The person sees the evidence in the run, and it can go to the code host.

Today an agent with a sandbox saves captures in `/coxia/out` and looks at them with `ViewImage` (`src/main/sandbox/session.ts`, `readOutputImage`), but the folder is removed when the stage ends: nothing is kept, nothing is shown to the person, and nothing points at a capture from a QA scenario.

Builds on #120 (the attachment storage and the way a message carries files).

### 1. Keeping evidence

- A tool, **`SaveEvidence`**, takes a file the stage made in its output folder (never a path elsewhere, never through a link; kind checked by content; size capped) with a title and an optional description, and keeps it as evidence of the stage. It answers with an evidence id.
- Evidence is a message attachment of the run's conversation, posted by the agent, so the person sees it live, and it is listed on the stage in the run's screen.
- Where it is kept is a workspace choice in Settings › Runner:
  - **App data only** (default): kept with the run in the workspace's data, never in the repository.
  - **Also in the cycle folder**: also copied to `docs/cycles/<n>-<slug>/evidence/` and committed with the stage, so it reaches the pull request.

### 2. Marking up an image

- A tool, **`AnnotateImage`**, takes an evidence image (or an image of the output folder) and a list of marks, and makes a **new** image; the original is kept. Marks: rectangle, arrow, ellipse, text label, numbered marker, and a blur box (to hide what should not be seen). Coordinates in pixels of the image, colour from a short fixed list, line width capped.
- The agent can look at the result (`ViewImage`) and annotate again; each version is its own evidence, linked to the one it came from.
- Drawing happens in the app's main process from data (no program of the agent runs on the host).

### 3. Using it

- A QA scenario can cite evidence ids next to command numbers; the run's QA view shows the evidence by scenario. An `executed` scenario still needs a command; evidence alone does not make it executed.
- The stage output of any agent can cite evidence ids (the product owner's exploratory validation, a review finding).
- The person can open, download and delete evidence from the run's screen and the paired browser.

### 4. To the code host

- A stage comment (QA's, the product owner's) or the pull request description can carry the evidence it cites: the images are uploaded to the code host and embedded in the comment.
- That goes through the door of Actions like any other write: an autonomous agent's goes out by itself and is audited, any other waits in Actions with the images shown. A test workspace refuses it. The comment check applies to the text; the person sees every image before a "yes".
- Each provider uploads in its own way (GitHub, GitLab, Bitbucket): the spec must say what each one supports and what happens where it cannot (the comment says how many evidence files there are and that they are in the app).

## Out of scope

Video and screen recordings; editing evidence by hand in the app.

## Acceptance

- A QA agent in the sandbox takes a screenshot of the app, keeps it with `SaveEvidence`, draws a box and an arrow on it with `AnnotateImage`, and cites it in a failing scenario; the person sees both images in the conversation and under the scenario.
- With "also in the cycle folder", the evidence files are in the stage's commit; with the default they are not.
- The QA comment of an autonomous QA agent goes out with the annotated image embedded; with a non-autonomous one it waits in Actions showing the image.
- A path outside the output folder, a link, an oversized file or a file whose content is not the declared kind is refused.
- Evidence of a run is removed with the run.

## Notes

Functional specification only; the solution design belongs to refinement and planning. The repository may be public: the spec must say what keeps a capture of private data out of a commit and out of a comment (the blur mark, the review before a "yes", the default of app data only).

## Comentários

(sem comentários)
