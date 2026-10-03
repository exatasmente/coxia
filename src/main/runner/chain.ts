import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import type { ForumMessage } from '../../shared/forum';
import type { Run } from '../../shared/runs';
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
}

export const CHAIN_VERDICTS = ['answer', 'pass', 'needs-person'] as const;
export type ChainVerdict = (typeof CHAIN_VERDICTS)[number];

export interface ChainAnswer {
  verdict: ChainVerdict;
  /** The answer, or (for a pass) the question as the next one needs it; may be empty. */
  text: string;
  reason: string;
}

export function chainCall(i: ChainInput): AgentCall {
  const agents = i.config.agents;
  const system = [
    cp('runner.chain.system', { agent: cycleWord(i.holder.name), job: cycleWord(i.holder.job), asker: i.asker, ref: i.run.issue.ref, title: i.run.issue.title, stage: i.run.stage }),
    cp('runner.rules.data'),
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
    schema: { type: 'object', properties: { verdict: { enum: [...CHAIN_VERDICTS] }, text: { type: 'string' }, reason: { type: 'string' } }, required: ['verdict', 'text', 'reason'], additionalProperties: false },
    system,
    cwd: i.cwd,
    label: i.holder.id,
    maxTurns: 20,
  };
}

/** The answer of the holder, read leniently: anything that is not one of the three verdicts is not an answer. */
export function readChain(raw: unknown): ChainAnswer | null {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const verdict = CHAIN_VERDICTS.find((v) => v === o.verdict);
  if (!verdict) return null;
  const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return { verdict, text: clean(o.text, 20_000), reason: clean(o.reason, 1000) };
}
