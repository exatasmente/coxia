import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { type AttachmentRef, formatBytes, kindLabelKey } from '../../shared/attachments';
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
  shell?: { host: boolean; network: 'off' | 'registry' };
  /** The agent may propose an issue (it reads the code host): the answer gets an `issue` field. */
  issue?: boolean;
  /** The conversation the agent was called in and the files the message carries: the call gets the read-only attachment tool, scoped to it. */
  attachments?: { thread: string; refs: readonly AttachmentRef[] };
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

const ISSUE_SCHEMA = {
  type: ['object', 'null'],
  properties: { title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } },
  required: ['title', 'body', 'labels'],
  additionalProperties: false,
};

/** The line that says where the person wrote and what the agent may read there. */
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
    i.shell ? (i.shell.host ? cp('runner.rules.shell.host') : i.shell.network === 'registry' ? cp('runner.rules.shell.registry') : cp('runner.rules.shell')) : '',
    i.shell ? (i.shell.host ? cp('runner.rules.shellReader.host') : cp('runner.rules.shellReader')) : '',
    i.issue ? cp('runner.mention.issue') : '',
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
    // The files of the message the agent was called in: the warning names them by the ref the tool takes, and never a path.
    i.attachments?.refs.length ? cp('runner.mention.attachment.list', { text: fence(attachmentsSection(i.attachments.refs)) }) : '',
    threadText(i.thread.slice(-40)) ? cp('runner.section.thread', { text: fence(threadText(i.thread.slice(-40))) }) : '',
  ].filter(Boolean);
  return {
    agent: i.agent,
    prompt: cp('runner.mention.main', { who: t('main.runner.author.person'), message: fence(i.message.text), sections: sections.join('\n\n') }),
    schema: i.issue ? { type: 'object', properties: { text: { type: 'string' }, issue: ISSUE_SCHEMA }, required: ['text', 'issue'], additionalProperties: false } : { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    system,
    cwd: i.cwd,
    label: i.agent.id,
    maxTurns: i.config.runner.turns.read,
    wrapUp: true,
    attachments: i.attachments,
  };
}
