import type { AgentDef, SquadDef, WorkspaceConfig } from '../../shared/config/types';
import type { ForumMessage } from '../../shared/forum';
import type { LinkKind, Run } from '../../shared/runs';
import type { AgentCall } from '../agents';
import { prompt as cp, text as cycleWord } from '../cyclePrompts';
import { fence, threadText } from './prompt';

// What the liaison of a squad is given when the liaison of another squad makes it a request: who asks, from which squad, what, and what it may answer with.
// It only reads (in the repository of its squad, not the asker's run), and it answers in one of four ways: with the answer, by declining with a reason, by
// turning the request into an issue of its squad, or by saying it is the person's to decide.

export interface RequestInput {
  run: Run;
  /** The liaison the request is for. */
  holder: AgentDef;
  /** The liaison that asks, by id. */
  asker: string;
  from: SquadDef;
  to: SquadDef;
  kind: LinkKind;
  text: string;
  config: WorkspaceConfig;
  thread: ForumMessage[];
  /** Where the holder reads: the repository of its squad. */
  cwd: string;
}

export const REQUEST_VERDICTS = ['answer', 'decline', 'issue', 'needs-person'] as const;
export type RequestVerdict = (typeof REQUEST_VERDICTS)[number];

export interface RequestAnswer {
  verdict: RequestVerdict;
  /** The answer; or, for an issue, its description. */
  text: string;
  /** Why it declines, or what the person must decide. */
  reason: string;
  /** The title of the issue the request becomes. */
  title: string;
}

export function requestCall(i: RequestInput): AgentCall {
  const agents = i.config.agents;
  const system = [
    cp('runner.request.system', { agent: cycleWord(i.holder.name), job: cycleWord(i.holder.job), squad: cycleWord(i.to.name), mission: i.to.mission.trim() ? cycleWord(i.to.mission) : '—', asker: i.asker, from: cycleWord(i.from.name) }),
    cp('runner.rules.data'),
    cp('runner.rules.claims'),
    agents.persona.trim(),
    agents.extraInstructions.trim(),
    cycleWord(i.holder.instructions).trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const thread = threadText(i.thread.slice(-20));
  return {
    agent: { ...i.holder, permission: 'read' },
    prompt: cp('runner.request.main', { kind: cp(`runner.request.kind.${i.kind}`), request: fence(i.text), ref: i.run.issue.ref, title: i.run.issue.title, thread: thread ? cp('runner.section.thread', { text: fence(thread) }) : '' }),
    schema: {
      type: 'object',
      properties: { verdict: { enum: [...REQUEST_VERDICTS] }, text: { type: 'string' }, reason: { type: 'string' }, title: { type: 'string' } },
      required: ['verdict', 'text', 'reason', 'title'],
      additionalProperties: false,
    },
    system,
    cwd: i.cwd,
    label: i.holder.id,
    maxTurns: i.config.runner.turns.read,
    wrapUp: true,
  };
}

/** The answer of the receiving liaison, read leniently: an issue with no title and no description is not an issue, and anything unknown is not an answer. */
export function readRequestAnswer(raw: unknown): RequestAnswer | null {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const verdict = REQUEST_VERDICTS.find((v) => v === o.verdict);
  if (!verdict) return null;
  const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const answer = { verdict, text: clean(o.text, 20_000), reason: clean(o.reason, 1000), title: clean(o.title, 200).split('\n')[0].trim() };
  if (verdict === 'issue' && (!answer.title || !answer.text)) return null;
  if (verdict === 'answer' && !answer.text) return null;
  return answer;
}
