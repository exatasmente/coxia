// Which lines of a file's unified diff a review comment can be anchored to, and where each one is in the old and the new file. Pure.

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  /** Line number in the old file; null for an added line. */
  old: number | null;
  /** Line number in the new file; null for a removed line. */
  new: number | null;
}

export interface PatchIndex {
  /** The lines the diff shows of the new file (added and context), by line number. */
  new: Map<number, DiffLine>;
  /** The lines the diff shows of the old file (removed and context), by line number. */
  old: Map<number, DiffLine>;
  /** The first line the change touches (added or removed), or the first line shown when there is none. */
  first: DiffLine | null;
}

/** The lines of a patch (the part of a file's diff from the first `@@`), in order. A patch the host left empty has none. */
export function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of (patch.endsWith('\n') ? patch.slice(0, -1) : patch).split('\n')) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (head) {
      oldNo = Number(head[1]);
      newNo = Number(head[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('\\')) continue;
    const c = line[0];
    if (c === '+') out.push({ kind: 'add', old: null, new: newNo++ });
    else if (c === '-') out.push({ kind: 'del', old: oldNo++, new: null });
    // An empty line inside a hunk is a context line whose leading space a host trimmed.
    else if (c === ' ' || line === '') out.push({ kind: 'ctx', old: oldNo++, new: newNo++ });
  }
  return out;
}

export function indexPatch(patch: string): PatchIndex {
  const lines = parsePatch(patch);
  const index: PatchIndex = { new: new Map(), old: new Map(), first: null };
  for (const l of lines) {
    if (l.new !== null) index.new.set(l.new, l);
    if (l.old !== null) index.old.set(l.old, l);
  }
  index.first = lines.find((l) => l.kind !== 'ctx') ?? lines[0] ?? null;
  return index;
}

/** Whether every line from `from` to `to` (both inclusive) of a side is in the diff, so a comment on that range has somewhere to stand. */
export function covers(index: PatchIndex, side: 'new' | 'old', from: number, to: number): boolean {
  const lines = side === 'new' ? index.new : index.old;
  for (let n = from; n <= to; n++) if (!lines.has(n)) return false;
  return true;
}
