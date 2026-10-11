# Your first workspace

A workspace is one project's configuration: which repository it works on, which model the agents
talk to, and where the issues come from. The setup wizard walks you through it on the first launch.

1. **Choose the language.** Portuguese (Brazil) or English; the app is written in both.
2. **Point it at a repository.** The wizard finds the checkouts you already have and reads their
   origin. Nothing of the repository is written at this step.
3. **Pick a model.** Either a Claude model or an OpenAI-compatible server, including a local one.
   The connection test tells you whether the model takes tool calls and structured answers.
4. **Name the code host.** A token with the scopes the app asks for; the wizard shows which ones and
   offers to test the token. Reading is all the app needs until you approve a write.

The whole of it is written down in
[Configuration](/reference/configuration), including what lives where on disk and how to export a
workspace as a file.

**What you should see:** the Today screen with the repository's open tasks as cards, each with the
stage it is at.

<!-- site:image-placeholder -->
> **Screenshot (pending).** The Models step of the wizard, with the connection test. Taken from the
> app over a seeded workspace with fictitious data, refreshed with each release.
