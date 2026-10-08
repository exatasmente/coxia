import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { type AttachmentRef, formatBytes, kindLabelKey } from '../../shared/attachments';
import { writableLabels } from '../../shared/priority';
import type { ForumMessage } from '../../shared/forum';
import { t } from '../../shared/i18n';
import type { AgentCall } from '../agents';
import { prompt as cp, text as cycleWord } from '../cyclePrompts';
import type { FolderFile } from '../runner/cycleFolder';
import { fence, threadText } from '../runner/prompt';

// What an agent is given when a person names it: the question, where it was named, the conversation and (when it runs commands) a throwaway copy of the code.
// It never writes to the repository: the call has no confinement to write in, so whatever the agent's own permission is, a mention changes no file of the branch.
// The place decides what the agent is told about where it answers (the run, a squad channel, a general thread or a ceremony) and which repositories it may name.

export interface MentionInput {
  agent: AgentDef;
  config: WorkspaceConfig;
  message: ForumMessage;
  thread: ForumMessage[];
  files: FolderFile[];
  cwd: string;
  /** The issue/run or the card under discussion, when there is one. */
  ref?: string;
  title?: string;
  /** The squad's mission, when the place has one (a squad channel). */
  mission?: string | null;
  /** The repositories the agent may name, already resolved to their titles. Empty: none (the system text says so). */
  repos?: readonly string[];
  /** Where the person wrote: the place text changes with it. */
  place: 'run' | 'channel' | 'general' | 'ceremony';
  /** The agent's commands run in a session over a copy of the code: what it is told about it. Absent: no commands. */
  shell?: { host: boolean; network: 'off' | 'registry' | 'open' };
  /** The agent may propose writes on the code host (it reads it): the answer gets a `proposals` field. */
  proposals?: boolean;
  /** The agent is autonomous: a comment and a label change it proposes go out as soon as it answers, and it is told so. */
  autonomous?: boolean;
  /** The conversation the agent was called in and the files the message carries: the call gets the read-only attachment tool, scoped to it. */
  attachments?: { thread: string; refs: readonly AttachmentRef[] };
  /**
   * What the app knows of the activities of this workspace, already rendered by the caller: the front the message named whole, or the short list of
   * what is in progress. It is shown as material, never added to the tools, and an empty one leaves the call without the section.
   */
  memory?: string;
}

/** An issue the answer proposes, read leniently: a title and a body are needed, labels are optional. */
export interface ProposedIssue {
  title: string;
  body: string;
  labels: string[];
}

export function readProposedIssue(raw: unknown): ProposedIssue | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const title = typeof r?.title === 'string' ? r.title.trim().slice(0, 200) : '';
  const body = typeof r?.body === 'string' ? r.body.trim().slice(0, 20_000) : '';
  if (!title || !body) return null;
  const labels = Array.isArray(r?.labels) ? r.labels.filter((l): l is string => typeof l === 'string' && !!l.trim()).map((l) => l.trim().slice(0, 50)) : [];
  return { title, body, labels };
}

/** One write on the code host the answer proposes: the operations the app already writes, read leniently from the answer. */
export type ProposedWrite =
  | { op: 'comment'; issue: number; body: string }
  | { op: 'labels'; issue: number; add: string[]; remove: string[] }
  | { op: 'status'; issue: number; status: string }
  | { op: 'close'; issue: number; body: string }
  | { op: 'createIssue'; title: string; body: string; labels: string[] };

const strList = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string' && !!l.trim()).map((l) => l.trim().slice(0, 200)).slice(0, 10) : [];
const iidOf = (raw: unknown): number | null => (typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null);

/**
 * The proposals of an answer, read leniently: a `proposals` array where each entry names an operation the app can write. An entry that does not name one, or is
 * missing what its operation needs, is dropped without discarding the rest of the answer.
 */
export function readProposedWrites(raw: unknown): ProposedWrite[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposedWrite[] = [];
  for (const entry of raw) {
    const r = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!r) continue;
    const op = typeof r.op === 'string' ? r.op : '';
    const body = typeof r.body === 'string' ? r.body.trim().slice(0, 20_000) : '';
    if (op === 'comment') {
      const issue = iidOf(r.issue);
      if (issue !== null && body) out.push({ op: 'comment', issue, body });
    } else if (op === 'labels') {
      const issue = iidOf(r.issue);
      const add = strList(r.add);
      const remove = strList(r.remove);
      if (issue !== null && (add.length || remove.length)) out.push({ op: 'labels', issue, add, remove });
    } else if (op === 'status') {
      const issue = iidOf(r.issue);
      const status = typeof r.status === 'string' ? r.status.trim().slice(0, 100) : '';
      if (issue !== null && status) out.push({ op: 'status', issue, status });
    } else if (op === 'close') {
      const issue = iidOf(r.issue);
      if (issue !== null) out.push({ op: 'close', issue, body });
    } else if (op === 'createIssue') {
      const issue = readProposedIssue({ title: r.title, body: r.body, labels: r.labels });
      if (issue) out.push({ op: 'createIssue', ...issue });
    }
  }
  return out;
}

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ['comment', 'labels', 'status', 'close', 'createIssue'] },
    issue: { type: ['integer', 'string'] },
    body: { type: 'string' },
    status: { type: 'string' },
    add: { type: 'array', items: { type: 'string' } },
    remove: { type: 'array', items: { type: 'string' } },
    title: { type: 'string' },
    labels: { type: 'array', items: { type: 'string' } },
  },
  required: ['op'],
  additionalProperties: false,
};

const PROPOSALS_SCHEMA = { type: ['array', 'null'], items: PROPOSAL_SCHEMA };

/** The line that says where the person wrote and what the agent may read there. */
/**
 * The labels the workspace gives a meaning to, for an agent that may write labels: the one that starts the agents' cycle on an issue and the priority levels it can
 * write. Without them the agent can only guess a name, and a guessed label is a write the host takes as it is.
 */
function labelsLine(config: WorkspaceConfig): string {
  const trigger = config.runner.triggerLabel.trim();
  const levels = writableLabels(config.devCycle.priority.labels);
  return [
    trigger ? cp('runner.mention.labels.trigger', { label: trigger }) : '',
    levels.length ? cp('runner.mention.labels.priority', { labels: levels.map((l) => `\`${l}\``).join(', ') }) : cp('runner.mention.labels.noPriority'),
  ]
    .filter(Boolean)
    .join(' ');
}

function placeLine(i: MentionInput): string {
  const repos = (i.repos ?? []).map((r) => r.trim()).filter(Boolean);
  const repoList = repos.length ? repos.join(', ') : cp('runner.mention.place.noRepos');
  switch (i.place) {
    case 'channel':
      return cp('runner.mention.place.channel', { mission: (i.mission ?? '').trim() || cp('runner.mention.place.noMission'), repos: repoList });
    case 'general':
      return cp('runner.mention.place.general', { repos: repoList });
    case 'ceremony':
      return cp('runner.mention.place.ceremony', { ref: i.ref ?? '—', title: i.title ?? '—' });
    default:
      return cp('runner.mention.place.run', { ref: i.ref ?? '—', title: i.title ?? '—' });
  }
}

/** The files a message carries, as an agent reads them: id, name, kind and size, never a path on the computer. */
export function attachmentsSection(refs: readonly AttachmentRef[]): string {
  if (!refs.length) return '';
  const lines = refs.map((r) => `- ${r.id}: "${r.name}", ${t(kindLabelKey(r.kind))}, ${formatBytes(r.bytes)}`);
  return t('main.attachment.tool.list', { count: refs.length }) + '\n' + lines.join('\n');
}

export function mentionCall(i: MentionInput): AgentCall {
  const agents = i.config.agents;
  const system = [
    cp('runner.mention.system', { agent: cycleWord(i.agent.name), job: cycleWord(i.agent.job), ref: i.ref ?? '—', title: i.title ?? '—' }),
    placeLine(i),
    i.shell ? (i.shell.host ? cp('runner.rules.shell.host') : i.shell.network === 'open' ? cp('runner.rules.shell.open') : i.shell.network === 'registry' ? cp('runner.rules.shell.registry') : cp('runner.rules.shell')) : '',
    i.shell ? (i.shell.host ? cp('runner.rules.shellReader.host') : cp('runner.rules.shellReader')) : '',
    i.proposals ? (i.autonomous ? cp('runner.mention.proposalsAuto') : cp('runner.mention.proposals')) : '',
    i.proposals ? labelsLine(i.config) : '',
    cp('runner.rules.data'),
    cp('runner.rules.claims'),
    agents.persona.trim(),
    agents.extraInstructions.trim(),
    cycleWord(i.agent.instructions).trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const sections = [
    ...i.files.map((f) => cp('runner.section.file', { name: f.name, text: fence(f.text) + (f.clipped ? `\n${cp('runner.section.clipped')}` : '') })),
    // What the app knows of the activities, before the thread: material to consult, under its own tags, so a call about an activity is answered from it.
    i.memory ? cp('runner.section.shared', { text: fence(i.memory) }) : '',
    // The files of the message the agent was called in: the warning names them by the ref the tool takes, and never a path.
    i.attachments?.refs.length ? cp('runner.mention.attachment.list', { text: fence(attachmentsSection(i.attachments.refs)) }) : '',
    threadText(i.thread.slice(-40)) ? cp('runner.section.thread', { text: fence(threadText(i.thread.slice(-40))) }) : '',
  ].filter(Boolean);
  return {
    agent: i.agent,
    prompt: cp('runner.mention.main', { who: t('main.runner.author.person'), message: fence(i.message.text), sections: sections.join('\n\n') }),
    schema: i.proposals
      ? { type: 'object', properties: { text: { type: 'string' }, proposals: PROPOSALS_SCHEMA }, required: ['text', 'proposals'], additionalProperties: false }
      : { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    system,
    cwd: i.cwd,
    label: i.agent.id,
    maxTurns: i.config.runner.turns.read,
    wrapUp: true,
    attachments: i.attachments,
  };
}
