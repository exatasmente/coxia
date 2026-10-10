import type { AgentDef, SquadDef, WorkspaceConfig } from '../../shared/config/types';
import type { ForumMessage } from '../../shared/forum';
import { LINK_KINDS, type LinkKind, type Run } from '../../shared/runs';
import type { AgentCall } from '../agents';
import { prompt as cp, text as cycleWord } from '../cyclePrompts';
import type { FolderFile } from './cycleFolder';
import { fence, threadText } from './prompt';

// What an agent is given when a question reaches it from another agent: the question, the cycle folder and the recent thread. It only reads (no confinement
// to write in), and it answers in a structured way: it answers, passes the question on with a reason, or says it is the person's to decide. Which agent
// comes next is not its choice: it is the one the holder turns to.

export interface ChainInput {
  run: Run;
  holder: AgentDef;
  /** The agent that asked, by id. */
  asker: string;
  question: string;
  config: WorkspaceConfig;
  thread: ForumMessage[];
  files: FolderFile[];
  cwd: string;
  /** The holder is the liaison of a squad: its own squad and the other squads it may make a request to (those with a liaison to receive it). */
  liaison?: { squad: SquadDef; others: SquadDef[] };
}

export const CHAIN_VERDICTS = ['answer', 'pass', 'needs-person', 'request'] as const;
export type ChainVerdict = (typeof CHAIN_VERDICTS)[number];

/** What a liaison asks of another squad: a question about its area, or a change in it. */
export interface ChainRequest {
  squad: string;
  kind: LinkKind;
  text: string;
}

export interface ChainAnswer {
  verdict: ChainVerdict;
  /** The answer, or (for a pass) the question as the next one needs it; may be empty. */
  text: string;
  reason: string;
  /** Only a liaison's answer carries one: what it asks of another squad (verdict `request`). */
  request: ChainRequest | null;
}

const squadLine = (q: SquadDef): string => `- ${q.id} (${cycleWord(q.name)}): ${q.mission.trim() ? cycleWord(q.mission) : '—'}`;

export function chainCall(i: ChainInput): AgentCall {
  const agents = i.config.agents;
  const others = i.liaison?.others ?? [];
  const system = [
    cp('runner.chain.system', { agent: cycleWord(i.holder.name), job: cycleWord(i.holder.job), asker: i.asker, ref: i.run.issue.ref, title: i.run.issue.title, stage: i.run.stage }),
    i.liaison && others.length ? cp('runner.chain.liaison', { squad: cycleWord(i.liaison.squad.name), squads: others.map(squadLine).join('\n') }) : '',
    cp('runner.rules.data'),
    cp('runner.rules.claims'),
    agents.persona.trim(),
    agents.extraInstructions.trim(),
    cycleWord(i.holder.instructions).trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const thread = threadText(i.thread.slice(-40));
  const sections = [...i.files.map((f) => cp('runner.section.file', { name: f.name, text: fence(f.text) + (f.clipped ? `\n${cp('runner.section.clipped')}` : '') })), thread ? cp('runner.section.thread', { text: fence(thread) }) : ''].filter(Boolean);
  return {
    agent: { ...i.holder, permission: 'read' },
    prompt: cp('runner.chain.main', { asker: i.asker, question: fence(i.question), sections: sections.join('\n\n') }),
    schema: chainSchema(others),
    system,
    cwd: i.cwd,
    label: i.holder.id,
    maxTurns: i.config.runner.turns.read,
    wrapUp: true,
    background: true,
  };
}

// Anything but a liaison with another squad to ask has the three verdicts it always had.
function chainSchema(others: SquadDef[]): Record<string, unknown> {
  const properties: Record<string, unknown> = { verdict: { enum: CHAIN_VERDICTS.filter((v) => v !== 'request' || others.length) }, text: { type: 'string' }, reason: { type: 'string' } };
  if (others.length) {
    properties.request = {
      type: ['object', 'null'],
      properties: { squad: { enum: others.map((q) => q.id) }, kind: { enum: [...LINK_KINDS] }, text: { type: 'string' } },
      required: ['squad', 'kind', 'text'],
      additionalProperties: false,
    };
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/** The answer of the holder, read leniently: anything that is not one of the three verdicts is not an answer. */
export function readChain(raw: unknown): ChainAnswer | null {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const verdict = CHAIN_VERDICTS.find((v) => v === o.verdict);
  if (!verdict) return null;
  const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const r = typeof o.request === 'object' && o.request !== null && !Array.isArray(o.request) ? (o.request as Record<string, unknown>) : null;
  const kind = LINK_KINDS.find((k) => k === r?.kind);
  const request = r && kind && clean(r.squad, 48) && clean(r.text, 20_000) ? { squad: clean(r.squad, 48), kind, text: clean(r.text, 20_000) } : null;
  return { verdict, text: clean(o.text, 20_000), reason: clean(o.reason, 1000), request };
}
