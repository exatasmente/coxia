import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import type { ForumMessage } from '../../shared/forum';
import { t } from '../../shared/i18n';
import type { Run } from '../../shared/runs';
import type { AgentCall } from '../agents';
import { prompt as cp, text as cycleWord } from '../cyclePrompts';
import type { FolderFile } from './cycleFolder';
import { fence, threadText } from './prompt';

// What an agent is given when a person names it in a run's thread: the question, the cycle folder and the recent thread. It never writes to the run: the
// call has no confinement to write in, so whatever the agent's own permission is, a mention never changes a file of the branch. An agent set to run commands
// (`shell: sandbox` or `host`) gets its session over a throwaway copy of the code, so it can reproduce what it is asked about; one that reads the code host may
// propose an issue, which only waits in Actions for the person's yes.

export interface MentionInput {
  run: Run;
  agent: AgentDef;
  config: WorkspaceConfig;
  message: ForumMessage;
  thread: ForumMessage[];
  files: FolderFile[];
  cwd: string;
  /** The agent's commands run in a session over a copy of the code: what it is told about it. Absent: no commands. */
  shell?: { host: boolean; network: 'off' | 'registry' };
  /** The agent may propose an issue (it reads the code host): the answer gets an `issue` field. */
  issue?: boolean;
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

export function mentionCall(i: MentionInput): AgentCall {
  const agents = i.config.agents;
  const system = [
    cp('runner.mention.system', { agent: cycleWord(i.agent.name), job: cycleWord(i.agent.job), ref: i.run.issue.ref, title: i.run.issue.title }),
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
  const sections = [...i.files.map((f) => cp('runner.section.file', { name: f.name, text: fence(f.text) + (f.clipped ? `\n${cp('runner.section.clipped')}` : '') })), threadText(i.thread.slice(-40)) ? cp('runner.section.thread', { text: fence(threadText(i.thread.slice(-40))) }) : ''].filter(Boolean);
  return {
    agent: i.agent,
    prompt: cp('runner.mention.main', { who: t('main.runner.author.person'), message: fence(i.message.text), sections: sections.join('\n\n') }),
    schema: i.issue ? { type: 'object', properties: { text: { type: 'string' }, issue: ISSUE_SCHEMA }, required: ['text', 'issue'], additionalProperties: false } : { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    system,
    cwd: i.cwd,
    label: i.agent.id,
    maxTurns: 20,
  };
}
