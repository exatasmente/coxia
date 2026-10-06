# 91 Create and keep a standard harness documentation for the agents of a workspace

- Endereço: https://github.com/exatasmente/coxia/issues/91
- Estado: open
- Rótulos: enhancement
- Autor: exatasmente

## Descrição

## The problem

The agents of the app work from whatever documentation the workspace points them to, and today that is documentation written for something else.

- **The sources are Claude Code's.** `docs` in the workspace config (`claudeMdRoots`, `skillsDirs`, `rulesDirs`, `agentsDirs`, `knowledgeDirs`) lists Claude Code style folders, and `autoDetect` adds `~/.claude` and every `<project>/.claude` by itself (`resolveDocs`, `src/main/config-resolve.ts`). A project that keeps notes for its Claude Code sessions hands them to every agent of the app as they are.
- **Rules meant for another harness are followed as the agent's own.** A real case: a developer agent asked in a run's thread where the pull request was read the workspace's Claude Code rules ("push, pull request and merge only from the main session; a subagent never pushes") and answered that opening it was not its job. Those lines describe a person's Claude Code sessions, not the app's runner, which proposes the push and the pull request itself. The only way out was to turn `autoDetect` off and empty the lists, which also took away the domain rules the developer and the reviewer could use.
- **Nothing says whether a document is still true.** A rule that describes code as it was two versions ago (an operation that "does not exist" and now does) is read with the same weight as a fresh one.
- **A workspace with no such documentation starts with none.** The person writes it by hand, in whatever shape, or the agents work from the code alone.

## What you would like to happen

- **One standard layout for the documentation the agents of the app read, kept in the repository.** A folder of its own (the name is for refinement), versioned with the code and reviewed like it: what the project is and how it is built, the rules of each domain (each with the evidence it rests on, `file:line`, the tests that guard it, and the commit it was checked against), the procedures an agent follows (skills), and notes per role of the team. A workspace with several repositories gets one per repository.
- **An agent drafts it and the person approves.** From the code and the documentation that already exists, an agent proposes the layout filled in, as a change that goes through the usual path (a branch, a pull request, the person's yes). After a run, the agent that knows what changed proposes the updates the documentation needs, and a rule whose evidence moved is marked as not checked until someone checks it again.
- **Claude Code's documentation stays Claude Code's, and can be imported.** The agents of the app read only the standard layout; `.claude/` and `CLAUDE.md` remain for Claude Code. The app offers to import from them what is a fact about the project (architecture, domain rules, commands) and leaves out what is a rule of a session or of another harness (who pushes, subagent roles, merge procedures), saying what it left out and why.
- **The agents get what fits them.** Each agent reads the project overview and the rules and procedures that concern its stage and the paths it touches, within a budget, rather than every file of every folder.
- **Settings show where the documentation comes from.** Settings › Documentation shows the layout found in each repository, what is stale, and offers to create it when there is none.

## Alternatives you considered

- **Keep reading `.claude/` and tell the person to curate it.** The same files serve two harnesses with different rules, so one of them is always told something false.
- **Keep the documentation in the workspace's data, outside the repository.** It would stay private, but only on one machine, unreviewed and invisible to whoever clones the project.
- **Only a template to fill in.** It standardizes the shape but leaves the work, and nothing keeps it true.

## Notes

- To settle in refinement: the folder's name and format (Markdown with a small header per file, and whether to also write an `AGENTS.md` that other tools read); how staleness is detected (the commit and paths a rule cites, compared with what changed since); how documentation is chosen per agent and its budget; what happens in a public repository (the draft must carry no secret, host or private name; the secret filter and, where the project has one, its own audit); and how this meets #85 (Coxia ships its own skills) and #86 (skills behind one plugin structure).
- Today's workaround in a workspace: `docs.autoDetect: false` and only the repository's own `CLAUDE.md` and a knowledge folder in `docs`.


## Comentários

(sem comentários)
