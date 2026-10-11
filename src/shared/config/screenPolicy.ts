import { SENSITIVE_CATEGORIES, STEP_KINDS, type StepKind } from '../browser';
import { squadOf } from './squads';
import type { AgentDef, SquadDef, WorkspaceConfig } from './types';

// The screen step approvals (#269): for each kind of step the app holds, whether it asks the person (held) or runs without asking (autonomous). Set on three levels, the
// agent, its squad and the workspace (`runner.screenPolicy`), decided kind by kind: the agent's word wins, then the squad's, then the workspace's, and with nobody's word the
// step is held, as it always was. Pure, so the settings screen shows exactly what the screen of a call applies. Not to be confused with the autonomy of the cycle (whether
// stages start and pass by themselves): this is only about the steps the persona takes on its screen. A payment, a sending to people, a secret and card data are not kinds
// and have no key here: no policy can express letting them through (`src/main/browser/sensitive.ts`).

export type ScreenMode = 'held' | 'autonomous';
/** A level's word, kind by kind; a kind it does not name is left to the next level. */
export type ScreenPolicy = Partial<Record<StepKind, ScreenMode>>;
/** Where the mode of a kind comes from. The audit of autonomous steps (#268) uses the same names. */
export type PolicyLevel = 'agent' | 'squad' | 'workspace' | 'default';
export type ResolvedScreenPolicy = Record<StepKind, { mode: ScreenMode; source: PolicyLevel }>;

export const SCREEN_MODES: readonly ScreenMode[] = ['held', 'autonomous'];

type PolicyView = Pick<WorkspaceConfig, 'squads'> & { runner: { screenPolicy?: ScreenPolicy } };

/** Everything held, from nobody's word: what a call with no policy applies. */
export const HELD_POLICY: ResolvedScreenPolicy = Object.fromEntries(STEP_KINDS.map((k) => [k, { mode: 'held', source: 'default' }])) as ResolvedScreenPolicy;

/** The mode of each kind for an agent, and the level it comes from. */
export function resolveScreenPolicy(c: PolicyView, agent: Pick<AgentDef, 'squad' | 'screenPolicy'> | null): ResolvedScreenPolicy {
  return resolveLevels({ agent: agent?.screenPolicy, squad: agent ? squadOf(c, agent.squad)?.screenPolicy : undefined, workspace: c.runner.screenPolicy });
}

/** The same over the three levels' words as given: what the settings screen shows for a draft that is not saved yet. */
export function resolveLevels(words: Partial<Record<Exclude<PolicyLevel, 'default'>, ScreenPolicy | undefined>>): ResolvedScreenPolicy {
  const levels: [PolicyLevel, ScreenPolicy | undefined][] = [
    ['agent', words.agent],
    ['squad', words.squad],
    ['workspace', words.workspace],
  ];
  const out = {} as ResolvedScreenPolicy;
  for (const kind of STEP_KINDS) {
    const hit = levels.find(([, p]) => p?.[kind] === 'held' || p?.[kind] === 'autonomous');
    out[kind] = hit ? { mode: hit[1]?.[kind] as ScreenMode, source: hit[0] } : { mode: 'held', source: 'default' };
  }
  return out;
}

/** The kinds that run without asking, in the order of the list. */
export const releasedKinds = (p: ResolvedScreenPolicy): StepKind[] => STEP_KINDS.filter((k) => p[k].mode === 'autonomous');

/** Whether a kind runs without asking under a resolved policy; none (no policy) holds everything. */
export const runsAlone = (p: ResolvedScreenPolicy | null | undefined, kind: StepKind): boolean => p?.[kind].mode === 'autonomous';

/**
 * A level's policy as a file or an import brings it: the kinds the app knows with a mode it knows. Anything else is dropped and named in `dropped`, so the caller warns; a
 * key that names one of the categories always held (`payment`, `people`, `secret`, `card`) is dropped the same way, since no policy can let them through.
 */
export function sanitizePolicy(raw: unknown): { policy: ScreenPolicy; dropped: string[] } {
  const policy: ScreenPolicy = {};
  const dropped: string[] = [];
  if (raw === undefined || raw === null) return { policy, dropped };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { policy, dropped: ['*'] };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if ((STEP_KINDS as readonly string[]).includes(key) && (value === 'held' || value === 'autonomous')) policy[key as StepKind] = value;
    else dropped.push(key.slice(0, 40));
  }
  return { policy, dropped };
}

/** The kinds a level lets run without asking. */
export const releasedIn = (p: ScreenPolicy | undefined): StepKind[] => STEP_KINDS.filter((k) => p?.[k] === 'autonomous');

/** A level's policy with only its holds: what a file someone hands over may bring (a release is the person's choice, on the computer). Undefined when nothing is left. */
export function heldOnly(p: ScreenPolicy | undefined): ScreenPolicy | undefined {
  const kept = Object.fromEntries(Object.entries(p ?? {}).filter(([, m]) => m === 'held')) as ScreenPolicy;
  return Object.keys(kept).length ? kept : undefined;
}

/** Whether a key names one of the categories that are always held. */
export const isSensitiveKey = (key: string): boolean => (SENSITIVE_CATEGORIES as readonly string[]).includes(key);

/** One kind whose word changed on one level. `owner` is the agent's or the squad's id; empty for the workspace. `inherit`: the level had no word. */
export interface PolicyChange {
  level: Exclude<PolicyLevel, 'default'>;
  owner: string;
  kind: StepKind;
  before: ScreenMode | 'inherit';
  after: ScreenMode | 'inherit';
}

type ChangeView = Pick<WorkspaceConfig, 'squads'> & { runner: { screenPolicy?: ScreenPolicy }; agents: { team: Pick<AgentDef, 'id' | 'screenPolicy'>[] } };

const wordOf = (p: ScreenPolicy | undefined, kind: StepKind): ScreenMode | 'inherit' => (p?.[kind] === 'held' || p?.[kind] === 'autonomous' ? (p[kind] as ScreenMode) : 'inherit');

function diff(level: PolicyChange['level'], owner: string, was: ScreenPolicy | undefined, now: ScreenPolicy | undefined, out: PolicyChange[]): void {
  for (const kind of STEP_KINDS) {
    const before = wordOf(was, kind);
    const after = wordOf(now, kind);
    if (before !== after) out.push({ level, owner, kind, before, after });
  }
}

/** Every word that changed between two configs, on every level: what a save records. An agent or a squad that came or went counts as one that had no word. */
export function screenPolicyChanges(prev: ChangeView, next: ChangeView): PolicyChange[] {
  const out: PolicyChange[] = [];
  diff('workspace', '', prev.runner.screenPolicy, next.runner.screenPolicy, out);
  const squads = (c: ChangeView): SquadDef[] => c.squads ?? [];
  for (const id of new Set([...squads(prev), ...squads(next)].map((s) => s.id))) {
    diff('squad', id, squads(prev).find((s) => s.id === id)?.screenPolicy, squads(next).find((s) => s.id === id)?.screenPolicy, out);
  }
  for (const id of new Set([...prev.agents.team, ...next.agents.team].map((a) => a.id))) {
    diff('agent', id, prev.agents.team.find((a) => a.id === id)?.screenPolicy, next.agents.team.find((a) => a.id === id)?.screenPolicy, out);
  }
  return out;
}

/** Whether a change lets some kind run without asking that did not on that level before: what a paired browser may not do. Holding more is always allowed. */
export const policyRaised = (prev: ChangeView, next: ChangeView): boolean => screenPolicyChanges(prev, next).some((c) => c.after === 'autonomous');
