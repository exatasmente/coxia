// The persona's chat as plain functions: what the screen decides above the markup. DOM-free like activity.ts and dashboard.ts, because nothing renders a component in the tests.
// The live bubble (the text of an answer being written, assembled from events), the rule that the stored answer replaces it, the messages that wait their turn, the Work
// section found by the message it answers, and the words of a button.
import { ACT_VERBS } from './actVerbs';
import { type ActivityEntry } from '../../shared/activity';
import type { ForumMessage } from '../../shared/forum';
import { type LiveAnswer, type LiveEvent, applyLive, applyRead } from '../../shared/persona';
import { type PushTarget, parseTarget } from '../../shared/push';
import type { PersonaToolName } from '../../shared/personaTools';
import { type TreeItem, type TreeNode, hasWork } from './activityTreeModel';

// ---- the live answers of a device ---------------------------------------------------------------------------------------------------------------

/** The answers being written that this device knows of, by thread and the message each answers. */
export type LiveMap = ReadonlyMap<string, LiveAnswer>;

export const liveKey = (thread: string, to: number): string => `${thread}\u0000${to}`;

/** The state after an event. `resync`: the event could not be placed (this device joined in the middle, or missed one), so the caller reads the text so far. */
export function reduceLive(map: LiveMap, e: LiveEvent): { map: LiveMap; resync: boolean } {
  const key = liveKey(e.thread, e.to);
  const { state, resync } = applyLive(map.get(key) ?? null, e);
  if (state === (map.get(key) ?? null)) return { map, resync };
  const next = new Map(map);
  if (state) next.set(key, state);
  else next.delete(key);
  return { map: next, resync };
}

/**
 * The state after a read of one thread: what the read holds is taken when it is newer than what the device has, and an answer the device has that the read no longer
 * holds is dropped (its call died with no end event, or the end was missed).
 */
export function reduceRead(map: LiveMap, thread: string, read: readonly LiveAnswer[]): LiveMap {
  const next = new Map(map);
  const held = new Set<string>();
  for (const answer of read) {
    if (answer.thread !== thread) continue;
    const key = liveKey(thread, answer.to);
    held.add(key);
    next.set(key, applyRead(map.get(key) ?? null, answer));
  }
  for (const [key, answer] of map) if (answer.thread === thread && !held.has(key)) next.delete(key);
  const same = next.size === map.size && [...next].every(([key, answer]) => map.get(key) === answer);
  return same ? map : next;
}

/** The answers of one thread, oldest message first. */
export const liveOf = (map: LiveMap, thread: string): LiveAnswer[] => [...map.values()].filter((a) => a.thread === thread).sort((a, b) => a.to - b.to);

/**
 * The bubbles to draw: an answer being written shows until a stored message answers the same message of the person. The stored answer replaces the bubble in the render in
 * which it arrives, on every device, whichever of the message and the end of the stream comes first: no gap, no duplicate.
 */
export function bubblesOf(live: readonly LiveAnswer[], messages: readonly ForumMessage[]): LiveAnswer[] {
  const answered = new Set(messages.filter((m) => m.answersTo !== undefined).map((m) => m.answersTo));
  return live.filter((a) => !answered.has(a.to));
}

// ---- the messages -------------------------------------------------------------------------------------------------------------------------------

export type RowKind = 'person' | 'answer' | 'agent' | 'system' | 'act';

/** How a message of the conversation is drawn: the person's bubble, the persona's answer, another agent's (one the persona called), a line the app wrote, or the line of an act of the persona. */
export function rowKind(m: Pick<ForumMessage, 'kind' | 'author'> & { code?: string | null }, persona: string): RowKind {
  if (m.code === 'persona.act') return 'act';
  if (m.kind === 'system' || m.author.type === 'app') return 'system';
  if (m.author.type === 'person') return 'person';
  return m.author.id === persona ? 'answer' : 'agent';
}

/** The messages of the person that wait their turn behind an answer going on: their call line is still `queued`. */
export function queuedOf(entries: readonly ActivityEntry[], thread: string, persona: string): Set<number> {
  const lines = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    if (!e.call || e.call.thread !== thread || e.call.agent !== persona) continue;
    const list = lines.get(e.runId);
    if (list) list.push(e);
    else lines.set(e.runId, [e]);
  }
  const out = new Set<number>();
  for (const list of lines.values()) {
    const last = list.sort((a, b) => a.seq - b.seq).findLast((e) => e.kind === 'status' && e.state !== 'blocked');
    if (last?.state === 'queued' && list[0].call) out.add(list[0].call.message);
  }
  return out;
}

/** What the box says: an answer is going (so a message sent now waits its turn), or nothing. */
export interface ComposerState {
  going: boolean;
}

export function composerState(live: readonly LiveAnswer[], roots: readonly TreeNode[], persona: string): ComposerState {
  return { going: live.length > 0 || roots.some((r) => r.call?.agent === persona && hasWork(r)) };
}

// ---- the work under an answer -------------------------------------------------------------------------------------------------------------------

/** The call that answered the message `seq` of the person: the root of the tree whose first line names that message and this agent. */
export function workOf(roots: readonly TreeNode[], seq: number, persona: string): TreeNode | null {
  return roots.findLast((r) => r.call?.message === seq && r.call.agent === persona) ?? null;
}

const subtree = (node: TreeNode): TreeNode[] => [node, ...node.children.flatMap(subtree)];

/** How long the call took (the first line to the last, anywhere under the root), how many steps it made (its tool lines) and whether it still works. */
export function workSummary(root: TreeNode): { ms: number; steps: number; working: boolean } {
  const lines = subtree(root).flatMap((n) => n.items.flatMap((i) => (i.type === 'line' ? [i.entry] : [])));
  const first = Math.min(...lines.map((e) => e.at));
  const last = Math.max(...lines.map((e) => e.at));
  return { ms: lines.length ? last - first : 0, steps: lines.filter((e) => e.kind === 'tool').length, working: hasWork(root) };
}

/** The root's own lines and levels without its closing `answer` line: the bubble under the section is that answer. */
export function workItems(root: TreeNode): TreeItem[] {
  return root.items.filter((i) => !(i.type === 'line' && i.entry.kind === 'answer'));
}

/**
 * Whether there is anything to show in the Work section: the call still works, or it took a step, thought, narrated or started something under it. A call that only said
 * it started and finished (an answer from what the persona already knew) has nothing to show, and a "0:00, 0 steps" line would only be noise.
 */
export function workShown(root: TreeNode): boolean {
  if (hasWork(root) || root.children.length > 0) return true;
  return root.items.some((i) => i.type === 'line' && (i.entry.kind === 'tool' || i.entry.kind === 'thought' || i.entry.kind === 'text'));
}

/** Whether the Work section is open when the person has not chosen: while the call works, and closed once the answer is complete. */
export const workOpenByDefault = (root: TreeNode): boolean => hasWork(root);

// ---- the acts of the persona --------------------------------------------------------------------------------------------------------------------

/** The line an act of the persona leaves in its conversation, as the window draws it: the app's words, in the language of whoever reads, and the two places it can lead to. */
export interface ActLine {
  text: string;
  /** The handler refused, or the act failed: the line says so, and the reason. */
  refused: boolean;
  /** The configuration fields a raise of reach named, or null. */
  raised: string | null;
  /** The id of the act in the audit (the link scrolls to it), or null when the line carries none. */
  auditId: string | null;
  /** The screen the act was about, validated as every button is, or null. */
  target: PushTarget | null;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The catalog key of the name of a tool's area, as the line of an act words it. A record over the names of the tools: a twelfth tool does not compile until it has one. */
export const ACT_TOOL_KEY: Record<PersonaToolName, string> = {
  Overview: 'ui.chat.act.tool.Overview',
  Runs: 'ui.chat.act.tool.Runs',
  Actions: 'ui.chat.act.tool.Actions',
  Board: 'ui.chat.act.tool.Board',
  Conversations: 'ui.chat.act.tool.Conversations',
  Memory: 'ui.chat.act.tool.Memory',
  Settings: 'ui.chat.act.tool.Settings',
  Secrets: 'ui.chat.act.tool.Secrets',
  Plugins: 'ui.chat.act.tool.Plugins',
  Asks: 'ui.chat.act.tool.Asks',
  Ceremonies: 'ui.chat.act.tool.Ceremonies',
};

/** The target an act line carries (a JSON string in the stored params): parsed with the vocabulary of the notifications, so a line cannot open what a button could not. */
export function actTarget(raw: unknown): PushTarget | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return parseTarget(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The words of a `persona.act` line. The message stores only the facts (tool, op, a short masked subject, the result, the audit id), so the sentence is made here, in the viewer's
 * language: a language change translates the lines already in the thread. An unknown tool is shown by its name.
 */
export function actLine(m: Pick<ForumMessage, 'params'>, say: Say): ActLine {
  const p = m.params ?? {};
  const tool = text(p.tool);
  const area = Object.hasOwn(ACT_TOOL_KEY, tool) ? say(ACT_TOOL_KEY[tool as PersonaToolName]) : tool;
  const op = text(p.op);
  const refused = p.result === 'refused';
  const subject = text(p.subject);
  const reason = text(p.reason);
  const verb = Object.hasOwn(ACT_VERBS, `${tool}.${op}`) ? ACT_VERBS[`${tool}.${op}`] : null;
  // Said from the tool, the operation and the subject, with no code in it: the area, then what was done. An operation this version has no words for reads as its name.
  const sentence = refused
    ? say(subject ? 'ui.chat.act.refused.on' : 'ui.chat.act.refused', { area, subject, reason: reason || '—' })
    : verb
      ? say('ui.chat.act.did', { area, did: say(verb, { subject: subject || '—' }) })
      : say('ui.chat.act.ok', { area, op, subject: subject || '—' });
  return { text: sentence, refused, raised: text(p.raised) || null, auditId: text(p.id) || null, target: actTarget(p.target) };
}

// ---- the buttons --------------------------------------------------------------------------------------------------------------------------------

/** The catalog key of the words of a button, by the screen it opens. The model writes no label: the app words the button from its target. */
export const BUTTON_KEY: Record<string, string> = {
  chat: 'ui.chat.button.chat',
  overview: 'ui.chat.button.overview',
  today: 'ui.chat.button.today',
  board: 'ui.chat.button.board',
  procedures: 'ui.chat.button.procedures',
  memory: 'ui.chat.button.memory',
  call: 'ui.chat.button.call',
  deep: 'ui.chat.button.deep',
  gate: 'ui.chat.button.gate',
  qa: 'ui.chat.button.qa',
  quick: 'ui.chat.button.quick',
  reentry: 'ui.chat.button.reentry',
  discussions: 'ui.chat.button.discussions',
  retro: 'ui.chat.button.retro',
  ata: 'ui.chat.button.ata',
  history: 'ui.chat.button.history',
  settings: 'ui.chat.button.settings',
  actions: 'ui.chat.button.actions',
  conflict: 'ui.chat.button.conflict',
  custo: 'ui.chat.button.custo',
  radar: 'ui.chat.button.radar',
  saude: 'ui.chat.button.saude',
  auditoria: 'ui.chat.button.auditoria',
  help: 'ui.chat.button.help',
  glossario: 'ui.chat.button.glossario',
  run: 'ui.chat.button.run',
  runs: 'ui.chat.button.runs',
  forum: 'ui.chat.button.forum',
};

type Say = (key: string, params?: Record<string, string | number>) => string;

/** The words of a button: "Start the pre-daily", "Open the board", "Open the QA hand-off for #123". `ceremony` is what the workspace calls its pre-daily. */
export function buttonLabel(target: PushTarget, say: Say, ceremony: string): string {
  const key = target.to === 'forum' && target.id ? 'ui.chat.button.forumThread' : (BUTTON_KEY[target.to] ?? 'ui.chat.button.other');
  return say(key, { ceremony, ref: target.ref ?? '', id: target.id ?? '' });
}

// ---- the accessibility attributes of the box and the menu ---------------------------------------------------------------------------------------

/** The combobox attributes of the box: only a box that completes `@agent` is a combobox; the persona's chat is a plain text box and must not announce a list it does not have. */
export function composerAria(mentions: boolean, listId: string, options: number, active: number): Record<string, string | boolean | undefined> {
  if (!mentions) return {};
  return {
    role: 'combobox',
    'aria-expanded': options > 0,
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-activedescendant': options ? `${listId}-${active}` : undefined,
  };
}

/** What the menu button points at: the desktop's menu exists in the page only while it is open; the phone's is a dialog and names nothing. */
export function menuControls(open: boolean, phone: boolean): string | undefined {
  return open && !phone ? 'chat-menu' : undefined;
}

// ---- the ceremony card on a small screen --------------------------------------------------------------------------------------------------------

/** Whether the pinned ceremony card shows in full: on a phone it is one line until the person opens it, on the computer it is open until they close it; their choice wins. */
export const cardOpen = (phone: boolean, chosen: boolean | null): boolean => (chosen === null ? !phone : chosen);

/**
 * What the pinned card draws of itself. On a phone the chip above it already says "Now", the ceremony's name and its progress, so an open card is only its body (the hint and the
 * buttons) and does not repeat them; on the computer there is no chip and the card is whole.
 */
export function cardParts(phone: boolean): { head: boolean } {
  return { head: !phone };
}

// ---- the focus of the box ---------------------------------------------------------------------------------------------------------------------

/**
 * Whether the box takes the focus back once a message has left. The computer's box always does (the button took the focus, and the person writes again at once); a phone's box
 * only if it had it, because a keyboard that was down is not to be raised over the conversation.
 */
export const refocusAfterSend = (phone: boolean, hadFocus: boolean): boolean => !phone || hadFocus;
