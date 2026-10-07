# Language and name open the setup, and the model choice that follows is where the app says nothing runs without it

## The request, in the words of the issue

> "A fresh install configures the LLM integration first, before any other integration, so the onboarding happens with Coxia's built-in agents rather than through a form of code-host settings."
>
> "Today the wizard has nine steps and the models step is skippable. Change it so the first thing the person does is choose how the app talks to a model, and so the wizard says in one sentence that without a model no agent runs."

The issue also asked the app to ship its own skills in a catalog. That part was moved out of this cycle by the person who opened the issue, and is not described here.

The person also settled where the model choice sits: language and name come first, the model choice comes right after, and the rest of the setup depends on it, because nothing in the app can be used without a model. That decision shapes everything below.

## What changes for the person

A fresh install still opens on language and what the agents call the person. The very next question is the choice of how the app talks with a model — the providers, the connection test, the key and the model of each job — answered before any code-host, project, documentation, cycle or voice question.

That step is where the app says, in one sentence, that without a model provider no agent runs. Skipping it stays possible, and the sentence stays on screen for those who skip it. Continuing from it without a provider stays blocked, as today: the sentence explains why, and it does not replace the block.

The buttons around a first step follow from that: since language and name is now the opening step, it keeps the way of leaving a fresh install unanswered ("Set up later"), and the model step that opens right after it offers only "Skip this step".

Where the assistant explains what can be skipped, it now says that the first step is language and name, that the steps which can be skipped are the ones after it, up to the review, and that the model choice is the one that decides whether the app is usable.

Nothing else changes: no new screen, no new provider, no new engine, no new skill content.

## The screens

### Language and name, the opening step

- It is the first step of a fresh install, as it is today: the language pills, what the agents call the person and the import of an exported configuration.
- It offers "Set up later", which leaves the assistant without answering anything, and it carries no "Skip this step" and no "Back".
- Its content is untouched.

### The model choice, the step right after it

- It is the second step of the sequence, reached from language and name, and it carries no "Set up later".
- It can be skipped and it shows "Skip this step"; skipping it does not end the assistant, and the sentence about running without a model is still shown on it.
- It carries the one-sentence statement about a workspace with no provider, next to the notice that already says a claude.ai subscription is not offered.
- Leaving it with "Continue" is still blocked when there is no provider, as today.

### The sentence about running without a model

- It is shown on the model step, and it is the only text this change adds.
- It says plainly that no agent runs without a model provider, and it does not instruct: where to add a provider is already on the screen.
- It is a sentence, not a paragraph: it is read in one line.
- It is written in both catalog languages, through `t()`, with the same key, and it uses the theme tokens like the rest of the screens.
- It does not replace the existing texts: the subscription notice, the provider warnings and the "Add at least one model provider" message on "Continue" stay as they are.

## Rules

1. Language and name stays the first step, and the model choice becomes the second: the step order changes only by that move, and the Claude Agent SDK step keeps its place (third) and its rule of only appearing when a provider runs on that engine.
2. The rest of the order is unchanged: the SDK step (when it appears), projects, integrations, agent documentation, cycle, voice, review.
3. A fresh install opens on language and name, and a stored progress that points at a step keeps pointing at that step, whatever the order.
4. Steps after the model choice, up to the review, can be skipped, as today; the model choice keeps being skippable.
5. A "Skip this step" is offered only on steps that can be skipped; language and name is not one of them, and the model choice is.
6. "Set up later", the way of leaving a fresh install without answering anything, lives on the opening step, which is language and name; no other step offers it, and skipping the model choice does not end the assistant.
7. The one-sentence statement appears on the model step whenever a fresh install is being set up. It describes the consequence, not a control: it adds no new way of asking for a provider and changes no test of "is there a provider".
8. The progress counter follows the sequence: on a fresh install the first step reads "Step 1 of 9: Language and name" and the model step reads "Step 2 of 9: Models"; the count of the steps that are shown does not change from today.
9. The sentence about skipping in the assistant's subtitle follows the new order: the first step is language and name, and skipping applies to the steps after it, up to the review. The subtitle stops saying that the setup can be finished later in Settings, which is no longer how a fresh install leaves the assistant.
10. No provider, engine or connection-test behavior changes. A workspace with no provider keeps failing an agent call the way it does today; what changes is that the person was told, at the step that asks for it.
11. Nothing about the skills catalog, skill content or the agents' documentation folders is changed. The "Agent documentation" step keeps its "Skills" list of folders exactly as it is today.

## Out of scope

- The catalog of Coxia skills, ready or preview, and any skill content shipped by the app. It was moved to its own issue by the person who opened this one, and it waits on the decision of where the content comes from; it is under the same out-of-scope note in the issue.
- Which engine (the Claude Agent SDK or the open loop) and which providers exist, how the connection test works, and which models are recommended. Unchanged.
- The content of the other steps: language and name, SDK, projects, integrations, agent documentation, cycle, voice and review.
- Making the model choice unskippable. It is possible on purpose, and the person is told what follows from that.
- Wording changes beyond the one sentence and the skipping sentence of the subtitle.
- Redoing the assistant for workspaces that already finished their setup: what changes for them is only the order of the steps and where a resume starts.

## Acceptance

A person can check each of these in the app, on a data folder of their own and never on a real workspace:

1. **A fresh install opens on language and name.** With nothing configured yet, the assistant opens on the step that asks for the language and what the agents call the person; the step list and the counter put it first, and the header names it.
2. **The model choice is the step right after it.** "Continue" from language and name goes to the model step, and nothing about a code host, a project, documentation, a cycle or voice is asked before it.
3. **The model choice is skippable and skipping does not close the assistant.** From the model step, "Skip this step" moves on and the step list marks it as skipped; the assistant is still there.
4. **The statement is there.** On the model step the one sentence saying that without a model provider no agent runs is visible, in the language chosen for the interface, next to the notice about the subscription.
5. **Skipping still blocks "Continue".** With the step skipped and no provider, "Continue" from the model step shows "Add at least one model provider"; adding a provider and choosing the model of every role lets it through, and the statement stays true and does not contradict what is on screen.
6. **The way out of a fresh install sits on the opening step.** Language and name offers "Set up later" and no "Skip this step"; the model step offers "Skip this step" and no "Set up later".
7. **The order of the rest is the order of today** — Claude Agent SDK (when a provider uses that engine), projects, integrations, agent documentation, cycle, voice, review — and review still edits any step and finishes the setup.
8. **The assistant's subtitle about skipping matches.** It says that the first step is language and name and that the steps that can be skipped come after it, up to the review; it no longer points at finishing the setup in Settings.
9. **A half-finished setup resumes where it stopped,** including on a step saved before this change, and the step counts read correctly in the header.
10. **Nothing else moved:** no new screen, no new provider type, no change to the connection test, and the "Agent documentation" step still lists skill folders the way it does today.
11. **An old workspace is untouched:** a workspace whose setup is already finished keeps its configuration and only sees the new order when the assistant is opened from Settings.

## Questions left to the person

- **How "preview" would be marked in a skills catalog** is not decided, because the catalog is out of this cycle. It belongs to the issue that waits on where the content comes from; nothing here depends on it.

## Not verified in this specification

The current behavior was checked by reading the code and the two text catalogs: the nine steps in order and which of them may be skipped, the first step's closing button and the blocking test of the model step, the provider editor living inside the model step, the review listing each role's provider and model, the subtitle about skipping, and the absence of any sentence about running without a model. Nothing was run, and no screen was seen working: the checks above are what a person does to verify the change afterwards.
