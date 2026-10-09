import { isRef } from './allowlist';

// What the app reads of the page before it lets a step through: the page's own snapshot (the role and name of a ref, which element has the focus) and one fixed question
// asked of the element (is it in a form, would activating it submit, is it in a frame of another site). Both are made with tools the agent is never offered, through the
// same server, so the reading is of the page the step will act on. The question is a constant: nothing the agent wrote is ever part of it.

/**
 * The question asked of an element, as the body of a function that has the element in `el`. It reads names and kinds, never what a person typed: the value of a field
 * is not read (a button's own label is), and the text of a field is not read. A frame of another site cannot be asked about its parent, which is how it is told apart.
 */
const PROBE_BODY = `
  const clean = (v) => (typeof v === 'string' ? v.replace(/\\s+/g, ' ').trim().slice(0, 120) : '');
  const tag = el.tagName.toLowerCase();
  const field = tag === 'input' || tag === 'textarea' || tag === 'select';
  const type = tag === 'input' || tag === 'button' ? String(el.type || '').toLowerCase() : '';
  const label = type === 'submit' || type === 'button' || type === 'reset' || type === 'image';
  let frame = 'top';
  if (window !== window.top) {
    try { void window.top.location.origin; frame = 'same'; } catch { frame = 'other'; }
  }
  return JSON.stringify({
    tag,
    type,
    form: !!el.form || !!el.closest('form'),
    submit: !!el.form && ((tag === 'button' && type === 'submit') || (tag === 'input' && (type === 'submit' || type === 'image'))),
    editable: !!el.isContentEditable,
    texts: [clean(el.getAttribute('aria-label')), field ? '' : clean(el.innerText), label ? clean(el.value) : '', clean(el.title), clean(el.alt)],
    frame,
    origin: location.origin,
  });
`;

/** Asked of the element a ref names (`browser_evaluate` with `target`). */
export const PROBE_ELEMENT_FN = `(el) => {${PROBE_BODY}}`;
/** Asked of the element that has the focus (`browser_evaluate` with no target). */
export const PROBE_FOCUS_FN = `() => { const el = document.activeElement; if (!el) return JSON.stringify({ tag: '', type: '', form: false, submit: false, editable: false, texts: ['', '', '', '', ''], frame: 'top', origin: location.origin });${PROBE_BODY}}`;

export interface Probe {
  tag: string;
  type: string;
  /** Inside a form (as its owner or a descendant). */
  form: boolean;
  /** Activating it would submit its form. */
  submit: boolean;
  editable: boolean;
  /** The names the element has besides the snapshot's: aria-label, its text, a button's own label, title, alt (each at most 120 characters). */
  texts: string[];
  /** In the top page, in a frame of the same site, or in a frame of another site. */
  frame: 'top' | 'same' | 'other';
  origin: string;
}

/** What the evaluate tool answered, as a probe; null for an error, or an answer that is not the shape asked for. */
export function parseProbe(answer: string): Probe | null {
  const at = answer.indexOf('### Result');
  if (at < 0 || answer.includes('### Error')) return null;
  try {
    const outer: unknown = JSON.parse(answer.slice(at + '### Result'.length).trim());
    const raw: unknown = typeof outer === 'string' ? JSON.parse(outer) : outer;
    if (typeof raw !== 'object' || raw === null) return null;
    const p = raw as Record<string, unknown>;
    const text = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 200) : '');
    if (p.frame !== 'top' && p.frame !== 'same' && p.frame !== 'other') return null;
    return {
      tag: text(p.tag),
      type: text(p.type),
      form: p.form === true,
      submit: p.submit === true,
      editable: p.editable === true,
      texts: Array.isArray(p.texts) ? p.texts.slice(0, 5).map(text) : [],
      frame: p.frame,
      origin: text(p.origin),
    };
  } catch {
    return null;
  }
}

export interface SnapNode {
  ref: string;
  role: string;
  /** The accessible name; '' when the node has none. */
  name: string;
  /** The node the snapshot marks as having the focus. */
  active: boolean;
}

// `- button "Send" [ref=e15]`, `- textbox "Cell A1" [active] [ref=e6]: hello`, `- generic [ref=e1]:`. The text after the colon is the page's (a field's value too) and is dropped.
const NODE = /^\s*- ([A-Za-z][\w-]*)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]*\])*)/;
const REF = /\[ref=([A-Za-z0-9]+)\]/;

const unquote = (s: string): string => s.replace(/\\(["\\])/g, '$1');

/** The nodes of a snapshot that have a ref, by ref. */
export function snapshotNodes(snapshot: string): Map<string, SnapNode> {
  const nodes = new Map<string, SnapNode>();
  for (const line of snapshot.split('\n')) {
    const m = NODE.exec(line);
    if (!m) continue;
    const ref = REF.exec(m[3])?.[1];
    if (!ref) continue;
    nodes.set(ref, { ref, role: m[1], name: m[2] === undefined ? '' : unquote(m[2]).slice(0, 200), active: /\[active\]/.test(m[3]) });
  }
  return nodes;
}

/** The snapshot's own text out of what the snapshot tool answered (the fenced block), or '' when it is not there. */
export function snapshotText(answer: string): string {
  const m = /```yaml\n([\s\S]*?)\n```/.exec(answer);
  return m ? m[1] : '';
}

/** The address of the page the answer says it is about (`- Page URL: ...`), or ''. */
export function pageUrl(answer: string): string {
  const m = /^- Page URL: (\S+)/m.exec(answer);
  return m ? m[1] : '';
}

/** The node the snapshot says has the focus, if any. */
export function focusedNode(nodes: Map<string, SnapNode>): SnapNode | null {
  for (const n of nodes.values()) if (n.active) return n;
  return null;
}

/** What is known of the element a step acts on: from the snapshot, and from the question asked of it (null when it could not be asked). */
export interface TargetInfo {
  ref: string;
  role: string;
  name: string;
  active: boolean;
  probe: Probe | null;
}

/** The two tools the app asks the page with. */
export interface ProbeClient {
  callTool(name: string, args: Record<string, unknown>, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>;
}

const textOf = (r: { content: { type: string; text?: string }[] }): string => r.content.map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('\n');
const PROBE_MS = 10_000;

export interface PageRead {
  /** The address of the page, with whatever the server said it is. */
  url: string;
  nodes: Map<string, SnapNode>;
  /** The page's snapshot text as the server gave it (kept for the result that follows an action). */
  snapshot: string;
  answer: string;
}

/** The app's own snapshot of the page. Null when the server did not answer or the answer holds no snapshot. */
export async function readPage(client: ProbeClient, signal?: AbortSignal): Promise<PageRead | null> {
  try {
    const r = await client.callTool('browser_snapshot', {}, { timeoutMs: PROBE_MS, signal });
    if (r.isError) return null;
    const answer = textOf(r);
    const snapshot = snapshotText(answer);
    if (!snapshot) return null;
    return { url: pageUrl(answer), nodes: snapshotNodes(snapshot), snapshot, answer };
  } catch {
    return null;
  }
}

/** Asks the element a ref names the fixed question. null when it cannot be asked (the step is then unclassifiable). */
export async function probeRef(client: ProbeClient, ref: string, signal?: AbortSignal): Promise<Probe | null> {
  if (!isRef(ref)) return null;
  try {
    const r = await client.callTool('browser_evaluate', { target: ref, function: PROBE_ELEMENT_FN }, { timeoutMs: PROBE_MS, signal });
    return r.isError ? null : parseProbe(textOf(r));
  } catch {
    return null;
  }
}

/** Asks the focused element the fixed question. */
export async function probeFocus(client: ProbeClient, signal?: AbortSignal): Promise<Probe | null> {
  try {
    const r = await client.callTool('browser_evaluate', { function: PROBE_FOCUS_FN }, { timeoutMs: PROBE_MS, signal });
    return r.isError ? null : parseProbe(textOf(r));
  } catch {
    return null;
  }
}

/** What is known of a ref, or `stale` when the page's last snapshot has no such ref (the page changed since the agent looked). */
export async function readTarget(client: ProbeClient, page: PageRead, ref: string, signal?: AbortSignal): Promise<TargetInfo | 'stale'> {
  const node = page.nodes.get(ref);
  if (!node) return 'stale';
  return { ref, role: node.role, name: node.name, active: node.active, probe: await probeRef(client, ref, signal) };
}

/** What is known of the element that has the focus: its place in the snapshot when the snapshot marks one, and the answer to the question. null: nothing has the focus. */
export async function readFocus(client: ProbeClient, page: PageRead, signal?: AbortSignal): Promise<TargetInfo | null> {
  const node = focusedNode(page.nodes);
  const probe = await probeFocus(client, signal);
  if (!node && !probe) return null;
  return { ref: node?.ref ?? '', role: node?.role ?? '', name: node?.name ?? '', active: true, probe };
}
