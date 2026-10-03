import { runThreadId } from '../shared/forum';
import type { Run, Transition } from '../shared/runs';
import type { ForumStore } from './forum-core';
import type { RunStore } from './runs-core';

// A run and its thread move together: the run is saved first, then what the move says is appended to the run's thread. A crash in between
// loses a message and never duplicates one, and the history of the run keeps the facts either way.

export interface RunForum {
  runs: RunStore;
  forum: ForumStore;
}

const titleOf = (run: Run): string => `${run.issue.ref} ${run.issue.title}`.trim().slice(0, 120);

/** Saves a new run (refused when its issue already has one going) and opens its thread with what starting it said. */
export function beginRun(d: RunForum, started: Transition): Run {
  const run = d.runs.create(started.run);
  d.forum.ensureThread({ id: runThreadId(run.id), kind: 'run', runId: run.id, title: titleOf(run) });
  d.forum.append(runThreadId(run.id), started.messages);
  return run;
}

/** Applies a move to a stored run and records its messages in the run's thread (opening it if a crash left it unopened). */
export function moveRun(d: RunForum, id: string, move: (run: Run) => Transition): Run {
  const done = d.runs.update(id, move);
  d.forum.ensureThread({ id: runThreadId(id), kind: 'run', runId: id, title: titleOf(done.run) });
  d.forum.append(runThreadId(id), done.messages);
  return done.run;
}
