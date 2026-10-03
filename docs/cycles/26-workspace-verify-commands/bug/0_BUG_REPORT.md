# #26 Conflict verification commands belong to the workspace — bug report

## What happens

Settings › "Conflict verification" (`ui.verify.title`) lists, in every workspace, the projects of every other workspace, and the commands typed there apply to all of them. The Help screen says so ("what applies to all workspaces" lists the verification commands next to paired devices and the glossary).

- In a workspace that keeps two repositories (`projects.repos`) the screen shows neither of them. It shows whatever projects have a stored command (from any workspace), plus the projects of the release tool's mirrors folder.
- A person who works in two workspaces with the same project path (a real one and a test one, two employers) cannot give the project a different command in each.
- Exporting a workspace configuration does not carry its verification commands, and importing one cannot set them.

## Expected

- A verification command is part of the workspace configuration: validated, migrated, exported and imported with the rest, and shown in the import preview like the other commands the config makes the app run.
- The screen lists the active workspace's own repositories and its release mirrors, nothing else.
- The conflict flow runs the command of the active workspace.
- An install that already has commands keeps them: each goes to the workspace(s) that own the project, and what no workspace owns is not lost.
- Writing stays desktop-only (a browser must not choose what Apply executes).

## Scope

In: where the commands are stored and read, the listing, the one-time move of the existing global file, export/import, the Help and docs texts. Out: how a verification runs (`runVerify`), the suggested Node command itself, and anything about the conflict resolution.
