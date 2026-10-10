import { isRunKindFlowKey, isShared, liaisonFor, scopedTeam, turnTarget } from '../config/squads';
import { workingTeam } from '../config/team';
import type { AgentDef, SquadDef, StageDef } from '../config/types';
import { t as translate, type Translate } from '../i18n';
import { checkFlow, flowIssueText, FLOW_ERRORS, FLOW_WARNINGS, type FlowIssue, type FlowIssueCode, type FlowIssueField } from './flowCheck';

// The one check of the squads: pure, over the squads, the team and the flows, with stable codes and the params of each message, shared by the config
// validator, the runner (before it starts a run in a squad) and the squad editor. Like the flow check, nothing here words a message: `squadIssueText` does.
// The flow of each squad is checked with the flow check, over the squad's members and the shared agents.

export const SQUAD_ERRORS = ['squad-duplicate', 'agent-squad-missing', 'no-liaison', 'liaison-unknown', 'liaison-not-member', 'liaison-turns-inside', 'turns-other-squad', 'chain-loop', 'flow-unknown-squad'] as const;
export const SQUAD_WARNINGS = ['scope-overlap', 'scope-empty', 'scope-repo-unknown', 'squad-empty', 'several-unclaimed', 'chain-skips-liaison'] as const;
export type SquadIssueCode = (typeof SQUAD_ERRORS)[number] | (typeof SQUAD_WARNINGS)[number];

export type SquadIssueField = 'id' | 'squad' | 'liaison' | 'turnsTo' | 'scope' | 'flows' | FlowIssueField;

export interface SquadIssue {
  severity: 'error' | 'warning';
  code: SquadIssueCode | FlowIssueCode;
  /** The squad it is about (its id); null when it is about an agent that names a squad the config lacks, or a flow of no squad. */
  squad: string | null;
  /** The agent it is about (its id), for the issues about the team. */
  agent: string | null;
  /** The stage of a squad's flow it is about, for the issues of the flow check. */
  stage: string | null;
  field: SquadIssueField;
  /** True for what the flow check found in the flow of a squad; `squad` and `stage` say where. */
  flow: boolean;
  /** What the message of the code needs: `squad` (its name), `other`, `agent`, `target`, `what`, `agents`, and for a flow issue the params of the flow check. */
  params: Record<string, string>;
  /** True when the squad has a flow of its own (`devCycle.flows`), false when the issue is in the workspace flow the squad follows. */
  ownFlow?: boolean;
}

export interface SquadCheckInput {
  squads: SquadDef[];
  team: AgentDef[];
  stages: StageDef[];
  flows?: Record<string, StageDef[]>;
  /** The ids of `projects.repos`: when given, a scope that names another repository is reported. */
  repos?: string[];
}

const nameOf = (s: SquadDef): string => s.name || s.id;
const lower = (v: string): string => v.trim().toLowerCase();
const dir = (p: string): string => p.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '');

// Two folders of one repository overlap when one is the other or inside it.
const nested = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

function overlapOf(a: SquadDef, b: SquadDef): string[] {
  const out: string[] = [];
  for (const r of a.scope.repos) if (b.scope.repos.includes(r)) out.push(r);
  for (const l of a.scope.labels) if (b.scope.labels.some((x) => lower(x) === lower(l))) out.push(`#${l}`);
  for (const p of a.scope.paths) if (b.scope.paths.some((q) => q.repo === p.repo && nested(dir(p.prefix), dir(q.prefix)))) out.push(`${p.repo}:${dir(p.prefix)}`);
  return out;
}

function modelIssues(input: SquadCheckInput, out: SquadIssue[]): void {
  const { squads, team } = input;
  const byId = new Map<string, SquadDef>();
  const add = (severity: SquadIssue['severity'], code: SquadIssueCode, over: Partial<SquadIssue>): void => {
    out.push({ severity, code, squad: null, agent: null, stage: null, field: 'squad', flow: false, params: {}, ...over });
  };
  const view = { squads, agents: { team } };

  for (const s of squads) {
    if (byId.has(s.id)) add('error', 'squad-duplicate', { squad: s.id, field: 'id', params: { squad: nameOf(s) } });
    else byId.set(s.id, s);
  }

  for (const a of team) {
    if (a.squad && !byId.has(a.squad)) add('error', 'agent-squad-missing', { agent: a.id, field: 'squad', params: { agent: a.id, target: a.squad } });
  }

  for (const s of squads) {
    if (byId.get(s.id) !== s) continue;
    const params = { squad: nameOf(s) };
    const members = team.filter((a) => a.squad === s.id);
    if (!members.length) add('warning', 'squad-empty', { squad: s.id, field: 'liaison', params });
    if (!s.liaison) {
      if (members.length) add('error', 'no-liaison', { squad: s.id, field: 'liaison', params });
    } else {
      const who = team.find((a) => a.id === s.liaison);
      if (!who) add('error', 'liaison-unknown', { squad: s.id, field: 'liaison', params: { ...params, agent: s.liaison } });
      else if (who.squad !== s.id) add('error', 'liaison-not-member', { squad: s.id, agent: who.id, field: 'liaison', params: { ...params, agent: who.id } });
      else {
        // The chain of a squad ends at its liaison and then at the person: the liaison cannot turn to one of its own members, whose question would come back to it.
        const turns = team.find((a) => a.id === who.turnsTo);
        if (turns && turns.squad === s.id) add('error', 'liaison-turns-inside', { squad: s.id, agent: who.id, field: 'turnsTo', params: { ...params, agent: who.id, target: turns.id } });
      }
    }
    if (!s.scope.repos.length && !s.scope.labels.length && !s.scope.paths.length && !s.scope.unclaimed) add('warning', 'scope-empty', { squad: s.id, field: 'scope', params });
    if (input.repos) {
      const known = new Set(input.repos);
      const missing = [...s.scope.repos, ...s.scope.paths.map((p) => p.repo)].filter((r, i, all) => !known.has(r) && all.indexOf(r) === i);
      if (missing.length) add('warning', 'scope-repo-unknown', { squad: s.id, field: 'scope', params: { ...params, what: missing.join(', ') } });
    }
  }

  const unclaimed = squads.filter((s) => s.scope.unclaimed);
  if (unclaimed.length > 1) add('warning', 'several-unclaimed', { squad: unclaimed[1].id, field: 'scope', params: { squad: nameOf(unclaimed[1]), other: nameOf(unclaimed[0]) } });

  for (let i = 0; i < squads.length; i++) {
    for (let j = i + 1; j < squads.length; j++) {
      const shared = overlapOf(squads[i], squads[j]);
      if (shared.length) add('warning', 'scope-overlap', { squad: squads[j].id, field: 'scope', params: { squad: nameOf(squads[j]), other: nameOf(squads[i]), what: shared.join(', ') } });
    }
  }

  // Questions between squads go through the liaisons (a request), not from agent to agent.
  for (const a of team) {
    const to = a.turnsTo ? team.find((x) => x.id === a.turnsTo) : undefined;
    if (!to || to.id === a.id) continue;
    if (a.squad && to.squad && a.squad !== to.squad) add('error', 'turns-other-squad', { squad: a.squad, agent: a.id, field: 'turnsTo', params: { agent: a.id, target: to.id } });
  }

  // The chain a question of a member really walks (the runtime's rule: a member that turns to the person goes through its liaison first) should pass
  // through the liaison; one that leaves for a shared agent does not.
  for (const a of team) {
    const own = a.squad ? byId.get(a.squad) : undefined;
    if (!own?.liaison || a.id === own.liaison) continue;
    const path: string[] = [];
    let cur: AgentDef | undefined = a;
    while (cur && !path.includes(cur.id)) {
      path.push(cur.id);
      const to = turnTarget(view, cur);
      cur = to ? team.find((x) => x.id === to) : undefined;
    }
    if (!cur && !path.includes(own.liaison)) add('warning', 'chain-skips-liaison', { squad: own.id, agent: a.id, field: 'turnsTo', params: { agent: a.id, squad: nameOf(own) } });
  }

  // The chain a question really walks (the runtime's rule: a member that turns to the person goes through its liaison) must reach the person.
  const reported = new Set(out.filter((i) => i.code === 'liaison-turns-inside' && i.agent).flatMap((i) => [i.agent as string]));
  const seenCircle = new Set<string>();
  for (const a of team) {
    const path: string[] = [];
    let cur: AgentDef | undefined = a;
    while (cur && !path.includes(cur.id)) {
      path.push(cur.id);
      const to = turnTarget(view, cur);
      cur = to ? team.find((x) => x.id === to) : undefined;
    }
    if (!cur) continue;
    const circle = path.slice(path.indexOf(cur.id));
    // A circle of explicit `turnsTo` is the flow check's `turns-loop`; this one has a hop the runtime adds.
    const implicit = circle.some((id) => {
      const x = team.find((y) => y.id === id) as AgentDef;
      return !(x.turnsTo && team.some((y) => y.id === x.turnsTo)) && liaisonFor(view, x) !== null;
    });
    if (!implicit || circle.some((id) => seenCircle.has(id) || reported.has(id))) continue;
    circle.forEach((id) => seenCircle.add(id));
    const first = team.find((x) => circle.includes(x.id)) as AgentDef;
    add('error', 'chain-loop', { agent: first.id, field: 'turnsTo', params: { agent: first.id, agents: [...circle, circle[0]].join(' → ') } });
  }
}

// The flow each squad follows, checked with the flow check over the squad's members and the shared agents.
function flowIssues(input: SquadCheckInput, out: SquadIssue[], checkSharedFlow: boolean): void {
  const ids = new Set(input.squads.map((s) => s.id));
  for (const key of Object.keys(input.flows ?? {})) {
    // The flow of a release run and the one of a documentation run are flows per run kind: they are no squad's.
    if (!isRunKindFlowKey(key) && !ids.has(key)) out.push({ severity: 'error', code: 'flow-unknown-squad', squad: null, agent: null, stage: null, field: 'flows', flow: false, params: { squad: key } });
  }
  for (const s of input.squads) {
    const own = input.flows?.[s.id];
    if (!own && !checkSharedFlow) continue;
    // A squad with no members runs nothing (and says so): its flow has no one to be checked against.
    if (!input.team.some((a) => a.squad === s.id)) continue;
    const stages = own ?? input.stages;
    if (!stages.length) continue;
    const team = scopedTeam({ agents: { team: input.team } }, s.id);
    // Only what is about the stages: the team's own problems (who turns to whom) are checked once, for the whole workspace, and by the model checks above.
    for (const issue of checkFlow({ stages, team }, { asFlow: !!own || checkSharedFlow })) {
      if (issue.agent !== null) continue;
      out.push({ severity: issue.severity, code: issue.code, squad: s.id, agent: null, stage: issue.stage, field: issue.field, flow: true, ownFlow: !!own, params: { ...issue.params, squad: nameOf(s) } });
    }
  }
}

/**
 * What is wrong with the squads: errors stop a run in a squad (and saving, in the editor); warnings say something is probably not meant. `checkSharedFlow`:
 * check the workspace's flow for squads that have none of their own (when the cycle is a flow).
 */
export function checkSquads(raw: SquadCheckInput, options: { checkSharedFlow?: boolean } = {}): SquadIssue[] {
  const out: SquadIssue[] = [];
  if (!raw.squads.length && !Object.keys(raw.flows ?? {}).length) return out;
  // A draft is no member, no liaison and no link of a chain: the squads are checked over the team that works.
  const input = { ...raw, team: workingTeam(raw.team) };
  modelIssues(input, out);
  flowIssues(input, out, !!options.checkSharedFlow);
  return out;
}

export const squadErrors = (input: SquadCheckInput, options: { checkSharedFlow?: boolean } = {}): SquadIssue[] => checkSquads(input, options).filter((i) => i.severity === 'error');

const FLOW_CODES = new Set<string>([...FLOW_ERRORS, ...FLOW_WARNINGS]);
export const isFlowIssue = (i: Pick<SquadIssue, 'code'>): boolean => FLOW_CODES.has(i.code);

/** The message of an issue, in the language of the translator it is given (the active language by default). */
export function squadIssueText(issue: Pick<SquadIssue, 'code' | 'params' | 'flow'>, tr: Translate = translate): string {
  if (issue.flow) return tr('squad.check.inFlow', { squad: issue.params.squad ?? '', detail: flowIssueText({ code: issue.code as FlowIssueCode, params: issue.params }, tr) });
  return tr(`squad.check.${issue.code}`, issue.params);
}

export type { FlowIssue };
