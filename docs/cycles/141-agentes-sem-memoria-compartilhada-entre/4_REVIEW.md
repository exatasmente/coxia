# Shared memory of the activities: the review of this round

This round reviews the pass that treated the two findings the previous review raised as blocking. What is written here was checked again in this stage against the specification, the plan and the repository's rules; what was not exercised is said as not verified. Nothing was changed by this stage.

## What the delivery does

The app keeps a record of the activities of the workspace in a file of its own, outside every worktree, and an agent called anywhere reads a cut of it: the whole entry of the activity or the agent a message named, or, when nothing was named, a short line per activity in progress. An execution that starts leaves a trace of the activity before its worktree exists; a second execution of the same activity updates the same entry; the person corrects an entry on the runs screen without a model call.

The change of this round is small in size and concrete in effect: the sentence that tells a working agent that the record moved no longer rides glued to the person's message, and one line of a commit stopped failing the repository's untranslated-string check.

## The two findings of the previous round, checked again

### The notice to the working agent only when the message entered

The previous review held, as blocking, that the app wrote its own sentence into the person's text before the mailbox decided whether the message would be delivered. When a stage was already finishing, the mailbox refused the message and the thread's closing line carried the person's words with the app's sentence stuck at the end — exactly the path of the report the issue describes.

The code now writes the person's message first and, only when the mailbox accepted it, a second, separate message with the notice. A message that is refused returns in the closing line with the person's own words and nothing else. A test drives a real execution (the scripted engine, the fake host) to the stage that is working, puts the mailbox in its closing window and registers, from there, a person's message that names the working agent; it asserts that the closing line ends with the person's words. The test passes in this stage, and the author reported that restoring the previous line makes it fail.

### The commit line and the untranslated-string check

A commit line of the app carries the subject of a commit of the repository's history, in English. The previous round reproduced that this literal, written as an argument, counted as an untranslated string and left the repository's check red. The line now carries the same mark the three sibling lines of the same file already carried, and both the whole check and the check over that single file report zero untranslated strings in this stage.

## What was checked in this stage, and how

- The two corrected points in `src/main/runner/service.ts` (the order of the two mailbox calls; the mark above the commit line), read in the file's current state.
- The new case of `test/sharedMemoryRun.test.ts`, read, and run: it passes.
- `npx tsc --noEmit`: passes.
- `npm run i18n:lint`: passes, 4647 keys in both languages, 0 untranslated string. The check over `src/main/runner/service.ts` alone: 0.
- The repository's string check over the files of the change that were touched by it: 0 in each.
- `node scripts/theme-audit.mjs`: passes, 8 literal colors, all of them pre-existing in a file of the change's neighbourhood.
- `node scripts/public-audit.mjs`: passes, 1219 files, nothing of a company, a person, a host or a real issue number.
- `npx vitest run` of the whole suite: 4374 of 4375. The single failure is `test/voice-setup.test.ts` (two cases), which asks the app's own disk check to find enough room for a voice install; it fails for the machine being full, at 403 MB free, below the margin the app itself asks for. The same file run on its own fails the same way, and the whole suite run moments before reported 4375 of 4375, so the failure comes from the machine and not from the change.
- The suite of the files of this change and its neighbours (`sharedMemoryRun`, `sharedMemoryCall`, `activityIndex`, `runner-e2e`, `runner-inbox`, `run-web`, `runs-policy`): all pass, 48 cases together.
- Two probes of this stage, run against the module and the catalogs: a projection written and read back keeps its fields; and a rendering of a corrected entry writes the person's text under the heading that also speaks of where the work stopped.

## Findings

### Blocking

None. The two previous blocking findings are treated.

### Suggestion

**A person's message that already carries the notice sentence folds in a copy of it.** The flag travels as text inside the message handed to the agent. A message of the person that already carries that sentence now gets a second copy when it is delivered, because the guard that compared the two was replaced by the new order of the calls. Reproduced: the line of the test that asserts the closing line ends with the person's words uses that very sentence as the person's words, and with the mailbox accepting the message the delivered text would end in two copies of it. The consequence is text of the app twice in what the agent reads. It is not blocking: the text is a notice and not a rule, and losing the guard is part of what makes a refused message keep the person's words whole.

**A corrected entry drops the two fields that say where the work stopped.** When the person corrects an entry, the projection empties the field that says where the work stopped and the field that carries the last thing said to the activity, and shows the person's text under a heading that speaks of both. A reader of a corrected entry therefore cannot tell whether the activity never stopped anywhere or whether the person removed that line. The behaviour was pointed out in the previous round and stands unchanged.

**The thumbnails of the agents have no dedicated test of their cut.** The behaviour exists and is exercised indirectly; a test that pins the cut by itself is still missing.

## What was not reviewed

The application in execution: the section of the activities on the runs screen and the sheet that edits one were not opened, and no click was given in this review. The interface is checked at acceptance.

A real restart, and the whole path of the mentions module outside a run running against a real forum: not exercised here.

Several workspaces on the same machine and several computers sharing the record: out of the declared scope.

The state of the machine: the disk is full during this review, which is what makes the voice-setup file fail; it is not a finding of the delivery and is not counted as one.
