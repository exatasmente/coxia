import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import type { ForumMessage } from '../../shared/forum';
import { t } from '../../shared/i18n';
import type { Run } from '../../shared/runs';
import type { AgentCall } from '../agents';
import { prompt as cp, text as cycleWord } from '../cyclePrompts';
import type { FolderFile } from './cycleFolder';
import { threadText } from './prompt';

// What an agent is given when a person names it in a run's thread: the question, the cycle folder and the recent thread. It only reads: the call
// has no confinement to write in, so whatever the agent's own permission is, a mention can never change a file or run a command.

export interface MentionInput {
  run: Run;
  agent: AgentDef;
  config: WorkspaceConfig;
  message: ForumMessage;
  thread: ForumMessage[];
  files: FolderFile[];
  cwd: string;
}

export function mentionCall(i: MentionInput): AgentCall {
  const agents = i.config.agents;
  const system = [
    cp('runner.mention.system', { agent: cycleWord(i.agent.name), job: cycleWord(i.agent.job), ref: i.run.issue.ref, title: i.run.issue.title }),
    cp('runner.rules.data'),
    agents.persona.trim(),
    agents.extraInstructions.trim(),
    cycleWord(i.agent.instructions).trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const sections = [...i.files.map((f) => cp('runner.section.file', { name: f.name, text: f.text + (f.clipped ? `\n${cp('runner.section.clipped')}` : '') })), threadText(i.thread.slice(-40)) ? cp('runner.section.thread', { text: threadText(i.thread.slice(-40)) }) : ''].filter(Boolean);
  return {
    agent: i.agent,
    prompt: cp('runner.mention.main', { who: t('main.runner.author.person'), message: i.message.text, sections: sections.join('\n\n') }),
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    system,
    cwd: i.cwd,
    label: i.agent.id,
    maxTurns: 20,
  };
}
