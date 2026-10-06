// The evidence of a rule: where in the repository it rests. Pure, so the screen, the delivery and the tests share it with the header parser.

export interface Evidence {
  /** Relative to the repository root, no trailing slash. */
  path: string;
  /** True for "folder/": the whole folder. */
  dir: boolean;
  from: number | null;
  to: number | null;
}

const LINES = /^(.*?):(\d+)(?:-(\d+))?$/;

/** One entry of `evidence`: "path", "path:12", "path:12-20" or "folder/". Null when it is not a path of the repository (absolute, `..`, `~`, empty parts). */
export function parseEvidence(entry: string): Evidence | null {
  let text = entry.trim();
  let from: number | null = null;
  let to: number | null = null;
  const m = LINES.exec(text);
  if (m) {
    text = m[1];
    from = Number(m[2]);
    to = m[3] === undefined ? from : Number(m[3]);
    if (from < 1 || to < from) return null;
  }
  const dir = text.endsWith('/');
  // a folder has no lines
  if (dir && from !== null) return null;
  const path = dir ? text.slice(0, -1) : text;
  // eslint-disable-next-line no-control-regex
  if (!path || path.startsWith('/') || path.startsWith('~') || /^[A-Za-z]:/.test(path) || /[\\\u0000-\u001f]/.test(path)) return null;
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return { path, dir, from, to };
}

const clean = (path: string): string => path.replace(/^\.\//, '').replace(/\/+$/, '');

/** Whether the entry names the path: the same file, or a folder that holds it. Lines do not matter here: a file that changed anywhere is a change. */
export function coversPath(entry: string, path: string): boolean {
  const e = parseEvidence(entry);
  if (!e) return false;
  const p = clean(path);
  return p === e.path || (e.dir && p.startsWith(`${e.path}/`));
}

/** The paths of the entries that parse, for a command that compares them with the repository. */
export function evidencePaths(entries: string[]): string[] {
  return [...new Set(entries.flatMap((entry) => parseEvidence(entry)?.path ?? []))];
}
