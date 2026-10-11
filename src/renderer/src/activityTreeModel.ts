// The live activity as a tree: a run or conversation, the agents working in it, their sub-agents and the agents they called. DOM-free like activity.ts, so every decision
// above the markup is tested as a plain function; the React side is ActivityTree.tsx.
import type { ActivityCall, ActivityEntry } from '../../shared/activity';
import { mentionJob } from '../../shared/activity';
import { stepText } from './activity';

export { stepText };

export type NodeState = 'queued' | 'waiting' | 'working' | 'finished' | 'failed';
export type TreeItem = { type: 'line'; entry: ActivityEntry } | { type: 'node'; node: TreeNode };

/** An activity run: an agent's own, a sub-agent it started (`sub`) or an agent it called (`call`). */
export interface TreeNode {
  id: string;
  /** The run id it hangs under; null for a root. */
  parent: string | null;
  type: 'agent' | 'sub' | 'call';
  role: string;
  /** The words that head a sub-agent or a call (its kind and task, the topic); empty for an agent's own run. */
  label: string;
  call: ActivityCall | null;
  state: NodeState;
  since: number;
  /** Its own lines and its child nodes, in the order they began. */
  items: TreeItem[];
  children: TreeNode[];
  /** Its newest own line. */
  latest: ActivityEntry | null;
}

/** What the dock counts: a run, a conversation or an activity with neither, with the roots of it that still have work. */
export interface TopEntry {
  /** Stable across lines arriving: the bucket for a run or conversation, the root's run id for an agent. */
  key: string;
  kind: 'run' | 'conversation' | 'agent';
  /** The run id, the thread, or the root's run id. */
  id: string;
  nodes: TreeNode[];
  since: number;
  /** The newest line anywhere in its nodes. */
  latest: ActivityEntry | null;
  /** Whether a node anywhere in it waits for the person: a closed entry says so on its own line. */
  waits: boolean;
}

const bySeq = (a: ActivityEntry, b: ActivityEntry): number => a.seq - b.seq;

/** The state a node is in, from its newest status line that is not a refusal (the rule `runActive` has): a node that said nothing of the kind is not working. */
function stateOf(lines: readonly ActivityEntry[]): NodeState {
  const last = lines.findLast((e) => e.kind === 'status' && e.state !== 'blocked');
  if (!last) return 'finished';
  if (last.state === 'queued') return 'queued';
  // Its turn limit was reached and the person is asked: alive, and not the same as waiting its turn behind another sub-agent.
  if (last.state === 'waiting') return 'waiting';
  if (last.state === 'finished' || last.state === 'failed') return last.state;
  return 'working';
}

/** The roots of the lines given, oldest first: lines grouped by run, nodes linked by `parent`, and in each node its lines and children by the order they began. */
export function buildTree(entries: readonly ActivityEntry[]): TreeNode[] {
  const byRun = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const list = byRun.get(e.runId);
    if (list) list.push(e);
    else byRun.set(e.runId, [e]);
  }
  const nodes = new Map<string, TreeNode>();
  const began = new Map<string, number>();
  for (const [id, lines] of byRun) {
    lines.sort(bySeq);
    const first = lines[0];
    began.set(id, first.seq);
    nodes.set(id, {
      id,
      parent: first.parent && first.parent !== id ? first.parent : null,
      type: first.node?.type ?? 'agent',
      role: first.role,
      label: first.node?.label ?? '',
      call: first.call ?? null,
      state: stateOf(lines),
      since: first.at,
      items: lines.map((entry) => ({ type: 'line', entry })),
      children: [],
      latest: lines[lines.length - 1] ?? null,
    });
  }
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const up = node.parent ? nodes.get(node.parent) : undefined;
    // A node whose parent is not here (a backfill that missed it) is a root: nothing lands outside the tree.
    if (up) {
      up.children.push(node);
      up.items.push({ type: 'node', node });
    } else {
      node.parent = null;
      roots.push(node);
    }
  }
  const at = (item: TreeItem): number => (item.type === 'line' ? item.entry.seq : (began.get(item.node.id) as number));
  for (const node of nodes.values()) {
    node.items.sort((a, b) => at(a) - at(b));
    node.children.sort((a, b) => (began.get(a.id) as number) - (began.get(b.id) as number));
  }
  return roots.sort((a, b) => (began.get(a.id) as number) - (began.get(b.id) as number));
}

// The store hands back the same array for a bucket that did not change, so the tree of a bucket is built once per change and not once per incoming line.
const treeCache = new WeakMap<readonly ActivityEntry[], TreeNode[]>();

/** `buildTree`, remembered by the identity of the array: the nodes are shared between calls, so a reader must not change them. */
export function buildTreeOnce(entries: readonly ActivityEntry[]): TreeNode[] {
  let tree = treeCache.get(entries);
  if (!tree) {
    tree = buildTree(entries);
    treeCache.set(entries, tree);
  }
  return tree;
}

/** Whether the node or anything under it still has work: it is working, it waits its turn, or it waits for the person. */
export function hasWork(node: TreeNode): boolean {
  return node.state === 'working' || node.state === 'queued' || node.state === 'waiting' || node.children.some(hasWork);
}

/** Whether something under the node waits for the person, and the node itself does not: what its collapsed line says so that closing it hides nothing. */
export function waitsBelow(node: TreeNode): boolean {
  return node.state !== 'waiting' && node.children.some(anyWaitingNode);
}

const anyWaitingNode = (node: TreeNode): boolean => node.state === 'waiting' || node.children.some(anyWaitingNode);

/** Whether any of these nodes, or anything under them, waits for the person. */
export function anyWaiting(nodes: readonly TreeNode[]): boolean {
  return nodes.some(anyWaitingNode);
}

/** The newest line of a node that waits for the person, anywhere in these nodes: the reason, in the words the main process wrote it. */
export function waitingLine(nodes: readonly TreeNode[]): ActivityEntry | null {
  let best: ActivityEntry | null = null;
  const visit = (node: TreeNode): void => {
    if (node.state === 'waiting') {
      const own = node.items.findLast((item) => item.type === 'line' && item.entry.state === 'waiting');
      if (own?.type === 'line' && (!best || own.entry.seq > best.seq)) best = own.entry;
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return best;
}

/** The newest line of a node and everything under it. */
export function newestLine(nodes: readonly TreeNode[]): ActivityEntry | null {
  let best: ActivityEntry | null = null;
  const visit = (node: TreeNode): void => {
    for (const item of node.items) if (item.type === 'line' && (!best || item.entry.seq > best.seq)) best = item.entry;
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return best;
}

/**
 * What the dock lists and counts, one entry per run (`run:<id>`) or conversation (`mention:<thread>`) with something working, and one per root agent for any activity
 * with neither (a ceremony answer, a scheduler call). A bucket a running renderer job owns is the job's. An entry shows the roots that still have work, with everything under
 * them: a child that ended stays while its parent does, and leaves with it. The length of the result is the badge: children never add to it, at any depth.
 */
export function topEntries(all: ReadonlyMap<string, readonly ActivityEntry[]>, owned: ReadonlySet<string>): TopEntry[] {
  const out: TopEntry[] = [];
  const make = (key: string, kind: TopEntry['kind'], id: string, nodes: TreeNode[]): TopEntry => ({ key, kind, id, nodes, since: Math.min(...nodes.map((n) => n.since)), latest: newestLine(nodes), waits: anyWaiting(nodes) });
  for (const [bucket, entries] of all) {
    if (owned.has(bucket)) continue;
    const roots = buildTreeOnce(entries).filter(hasWork);
    if (!roots.length) continue;
    if (bucket.startsWith('run:')) out.push(make(bucket, 'run', bucket.slice('run:'.length), roots));
    else if (bucket.startsWith(mentionJob(''))) out.push(make(bucket, 'conversation', bucket.slice(mentionJob('').length), roots));
    else for (const root of roots) out.push(make(`agent:${root.id}`, 'agent', root.id, [root]));
  }
  return out.sort((a, b) => a.since - b.since || a.key.localeCompare(b.key));
}

/**
 * The numbers of the floating button: the renderer's own jobs that are shown plus the top-level entries. Every entry is working (it exists only while something in
 * it does), and nothing inside an entry adds to the count, so a run with two sub-agents and a called agent is one.
 */
export function dockCounts(shown: readonly { status: string }[], tops: number): { total: number; running: number; failed: number } {
  return {
    total: shown.length + tops,
    running: shown.filter((j) => j.status === 'running').length + tops,
    failed: shown.filter((j) => j.status === 'failed').length,
  };
}

/** The roles of the agents working at the top of an entry, each once: how a conversation is titled. */
export function workingRoles(entry: TopEntry): string[] {
  return [...new Set(entry.nodes.filter(hasWork).map((n) => n.role))];
}

/** What heads a node: an agent by its name, a sub-agent by its kind and task, a called agent by its name and the topic. */
export function nodeTitle(node: Pick<TreeNode, 'type' | 'role' | 'label'>, nameOf: (role: string) => string): string {
  if (node.type === 'agent') return nameOf(node.role);
  if (node.type === 'sub') return node.label || nameOf(node.role);
  return node.label ? `${nameOf(node.role)}: ${node.label}` : nameOf(node.role);
}

/** What a node is when the person has not chosen: an agent's own run is open, a sub-agent or a called agent is closed. */
export const defaultOpen = (node: Pick<TreeNode, 'type'>): boolean => node.type === 'agent';

/**
 * Which levels the person opened or closed, held outside any component so that it survives the panel closing and new lines arriving. An explicit choice per id (a node's
 * run id, an entry's key, a thought line's `runId:seq`); without one the default the caller gives.
 */
export function createTreeView() {
  const chosen = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    open: (id: string, def: boolean): boolean => chosen.get(id) ?? def,
    toggle(id: string, def: boolean): void {
      chosen.set(id, !(chosen.get(id) ?? def));
      version++;
      for (const l of [...listeners]) l();
    },
    /** Changes with every choice: what a component reads to know it must draw again. */
    version: (): number => version,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type TreeView = ReturnType<typeof createTreeView>;
