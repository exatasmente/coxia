// The path grammar of the persona's settings tool (#248): dot-separated keys, and a segment may be `name[id]` to pick the element with that `id` of an array of objects
// (`agents.team[me].shell`, `squads[ops].members`). `set` replaces the value at a path (creating a key of an object that exists, never an object in between), `append`
// pushes onto an array, `remove` deletes a key or an element. Applied to a clone: the document that comes back is the whole next configuration, for the app to validate and save,
// so a long document never goes through the model. Pure.

export class PathError extends Error {
  constructor(
    readonly code: 'syntax' | 'forbidden' | 'missing' | 'type',
    readonly path: string,
  ) {
    super(`${code}: ${path}`);
  }
}

export type PathMode = 'set' | 'append' | 'remove';

type Segment = { key: string; id?: string };

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const SEGMENT = /^([A-Za-z_][A-Za-z0-9_-]*)(?:\[([A-Za-z0-9][A-Za-z0-9._-]{0,63})\])?$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The segments of a path, or a PathError for a path that does not parse or names a key that can reach the prototype. */
export function parsePath(path: string): Segment[] {
  if (!path || path.length > 300) throw new PathError('syntax', path);
  return path.split('.').map((part) => {
    const m = SEGMENT.exec(part);
    if (!m) throw new PathError('syntax', path);
    if (FORBIDDEN.has(m[1]) || (m[2] && FORBIDDEN.has(m[2]))) throw new PathError('forbidden', path);
    return { key: m[1], ...(m[2] ? { id: m[2] } : {}) };
  });
}

/** The value of a segment inside its parent: the property, and for `name[id]` the element of that array with that id. */
function step(parent: unknown, seg: Segment, path: string): unknown {
  if (!isObject(parent)) throw new PathError('missing', path);
  const value = Object.prototype.hasOwnProperty.call(parent, seg.key) ? parent[seg.key] : undefined;
  if (seg.id === undefined) return value;
  if (!Array.isArray(value)) throw new PathError('type', path);
  return value.find((e) => isObject(e) && e.id === seg.id);
}

/** What is at a path, or undefined. A path that cannot be followed (through a value that is not an object) is undefined too. */
export function readPath(doc: unknown, path: string): unknown {
  let at: unknown = doc;
  for (const seg of parsePath(path)) {
    try {
      at = step(at, seg, path);
    } catch (e) {
      if (e instanceof PathError && e.code !== 'forbidden') return undefined;
      throw e;
    }
    if (at === undefined) return undefined;
  }
  return at;
}

/** The document with the change made at the path. The input is not touched. */
export function applyPath(doc: unknown, path: string, value: unknown, mode: PathMode = 'set'): unknown {
  const segs = parsePath(path);
  const next = structuredClone(doc);
  let parent: unknown = next;
  for (const seg of segs.slice(0, -1)) {
    parent = step(parent, seg, path);
    if (parent === undefined) throw new PathError('missing', path);
  }
  if (!isObject(parent)) throw new PathError('missing', path);
  const last = segs[segs.length - 1];
  const own = Object.prototype.hasOwnProperty.call(parent, last.key);

  if (last.id !== undefined) {
    // An element of a list: replaced, appended (when it is new) or removed; the list has to be there.
    const list = own ? parent[last.key] : undefined;
    if (!Array.isArray(list)) throw new PathError(own ? 'type' : 'missing', path);
    const at = list.findIndex((e) => isObject(e) && e.id === last.id);
    if (mode === 'remove') {
      if (at < 0) throw new PathError('missing', path);
      list.splice(at, 1);
    } else if (mode === 'append') {
      throw new PathError('type', path);
    } else if (at < 0) list.push(value);
    else list[at] = value;
    return next;
  }

  if (mode === 'remove') {
    if (!own) throw new PathError('missing', path);
    delete parent[last.key];
    return next;
  }
  if (mode === 'append') {
    const list = own ? parent[last.key] : undefined;
    if (!Array.isArray(list)) throw new PathError(own ? 'type' : 'missing', path);
    list.push(value);
    return next;
  }
  // `set` creates a key of an object that exists; it never creates the object in between (checked above by `step`).
  parent[last.key] = value;
  return next;
}
