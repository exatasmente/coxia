# 143 Let a stage that runs on the computer keep its evidence, instead of losing it with the temp folder

- Endereço: https://github.com/exatasmente/coxia/issues/143
- Estado: open
- Rótulos: bug, coxia, priority:high
- Autor: exatasmente

## Descrição

## What happens today

A stage whose agent runs commands on the computer (`shell: host`) cannot keep evidence at all, and everything it made for an interface test is deleted when the stage ends.

Seen in a real run, a QA stage sent back to redo only its evidence in host mode:

- The agent took its screenshots in `$COXIA_OUT` (a `coxia-host-*` folder under the system temp dir), as the prompt tells it.
- The evidence tools were not offered: the executor offers `SaveEvidence` / `AnnotateImage` only when the session has a `stageDir` (`session?.stageDir && d.keepEvidence`), and `openHostSession` returns none. The prompt never mentioned `SaveEvidence`.
- To look at two of the screenshots the agent copied them into the worktree, read them, and removed the copy.
- `close()` of the host session removes the whole temp folder (`rmSync(outDir)`), so every screenshot was lost. The run shows "No evidence in this stage", the scenarios came back as `read`, and nothing reached the code host.

#142 covers the same loss for a stage with a sandbox; this one is the host mode, which #142 leaves out.

## What should happen

1. **A host session keeps evidence like a sandbox one.** A host session that tests an interface exposes its output folder (`$COXIA_OUT`) as the folder evidence is read from, and the stage gets `SaveEvidence` and `AnnotateImage` with the same rules: only files inside that folder, no `..`, no links, kind read from the bytes, same size cap, ids `ev-<n>`.
2. **Nothing is lost before it can be kept.** Whatever #142 decides for images the agent looked at and did not keep (kept at the close, or listed in the run's conversation) also runs for a host session, before its folder is removed.
3. **The prompt says the same thing in both modes.** A host stage that tests an interface is told about `SaveEvidence` and the evidence ids exactly as a sandbox stage is.

## Acceptance

- A host stage with an interface test is offered `SaveEvidence` and `AnnotateImage`, and a file kept from `$COXIA_OUT` shows in the run and can be cited by a QA scenario; a test covers it.
- A path outside the host output folder is refused, as in the sandbox; a test covers it.
- The handling #142 adds for viewed-but-not-kept images runs before the host folder is removed; a test covers it.
- A host stage without an interface test (no output folder) behaves as today.

## Notes

- Builds on #142: start it after #142 is merged, since both change the evidence wiring in `src/main/runner/executor.ts`.
- The host session is in `src/main/sandbox/host.ts`; the evidence tools in `src/main/evidence/`.

## Comentários

(sem comentários)
