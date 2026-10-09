import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_ID, RunError, isTerminal, parseRun, runVersionOf, type Run, type Transition } from '../shared/runs';

// The store of runs: one JSON file per run in <workspace>/runs/<id>.json, written atomically (temp file + rename), checked against the schema on
// every read. A file written by a newer app is neither used nor ever overwritten. Electron-free: the folder comes in as an argument.

export interface RunStore {
  /** The run, or null when there is no such file, it is not valid, or a newer app wrote it. */
  get(id: string): Run | null;
  /** Every usable run, the most recently changed first. */
  list(): Run[];
  /** Files the store cannot use, with the reason: shown to the person, never deleted. */
  unreadable(): { id: string; reason: 'newer' | 'invalid'; detail: string }[];
  /** The run in progress for an issue (one at a time), or null. */
  activeFor(issueRef: string): Run | null;
  /** Saves a new run. Refused when its id exists or another run of the same issue is still going. */
  create(run: Run): Run;
  /** Loads the run, applies a move, saves the result with `rev` + 1. Throws when the run is missing or unusable. The move's messages come back for the forum. */
  update(id: string, move: (run: Run) => Transition): Transition;
}

const file = (dir: string, id: string): string => {
  // The id becomes a file name: it must be one of ours, never a path.
  if (!RUN_ID.test(id)) throw new RunError('unknown-run', { id: id.slice(0, 40) });
  return join(dir, `${id}.json`);
};

function atomicWrite(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function createRunStore(dir: string): RunStore {
  const read = (id: string): ReturnType<typeof parseRun> | null => {
    const path = file(dir, id);
    if (!existsSync(path)) return null;
    try {
      return parseRun(JSON.parse(readFileSync(path, 'utf8')));
    } catch (e) {
      return { ok: false, reason: 'invalid', errors: [e instanceof Error ? e.message : String(e)] };
    }
  };
  const ids = (): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => RUN_ID.test(id)) : []);
  const save = (run: Run): void => atomicWrite(file(dir, run.id), `${JSON.stringify(run, null, 1)}\n`);

  const store: RunStore = {
    get(id) {
      if (!RUN_ID.test(id)) return null;
      const r = read(id);
      return r?.ok ? r.run : null;
    },
    list() {
      return ids()
        .flatMap((id) => store.get(id) ?? [])
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },
    unreadable() {
      return ids().flatMap((id) => {
        const r = read(id);
        return r && !r.ok ? [{ id, reason: r.reason, detail: r.errors.join('; ') }] : [];
      });
    },
    activeFor(issueRef) {
      return store.list().find((r) => r.issue.ref === issueRef && !isTerminal(r)) ?? null;
    },
    create(run) {
      const checked = parseRun(run);
      if (!checked.ok) throw new RunError('invalid', { id: run.id, detail: checked.errors.join('; ') });
      if (existsSync(file(dir, run.id))) throw new RunError('duplicate', { issue: run.issue.ref });
      if (store.activeFor(run.issue.ref)) throw new RunError('duplicate', { issue: run.issue.ref });
      const saved: Run = { ...structuredClone(run), rev: 1, version: runVersionOf(run) };
      save(saved);
      return saved;
    },
    update(id, move) {
      const r = read(id);
      if (!r) throw new RunError('unknown-run', { id });
      if (!r.ok) throw new RunError(r.reason === 'newer' ? 'newer-version' : 'invalid', { id, detail: r.errors.join('; ') });
      const result = move(r.run);
      // The version is stamped here, at the one place every save goes through: 2 only while the run holds a recording (see `runVersionOf`).
      const saved: Run = { ...result.run, id: r.run.id, rev: r.run.rev + 1, version: runVersionOf(result.run) };
      const checked = parseRun(saved);
      if (!checked.ok) throw new RunError('invalid', { id, detail: checked.errors.join('; ') });
      save(saved);
      return { run: saved, messages: result.messages };
    },
  };
  return store;
}
