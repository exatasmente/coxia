import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { type ForumMessage, messageText } from '../../shared/forum';
import type { OutputKind } from '../../shared/runs';
import type { FlowStage, Run } from '../../shared/runs';
import { t } from '../../shared/i18n';
import { prompt as cp, text as cycleWord } from '../cyclePrompts';
import { type FolderFile, ISSUE_FILE } from './cycleFolder';

// The text a stage's agent is given. The ids are `runner.*` prompts of the catalogs (the base family): the app's own wording, in the workspace's
// language. Everything that came from outside (the issue, comments, the thread, files, the diff) goes between <data> tags and the system text says
// it is material, not instructions.

/** What the agent is asked to write for a tracker comment: the sections of the template (heading and what each must say), and whether there is a technical part. */
export interface CommentAsk {
  sections: { heading: string; guidance: string }[];
  technical: boolean;
}

export interface StageInput {
  run: Run;
  stage: FlowStage;
  agent: AgentDef;
  config: WorkspaceConfig;
  kind: OutputKind;
  /** The agent may change files (and run `commands`). */
  writes: boolean;
  commands: string[];
  files: FolderFile[];
  thread: ForumMessage[];
  attempt: number;
  /** A note the previous stage left for this agent. */
  handoff: { from: string; text: string } | null;
  /** The person's answer to what this agent asked before. */
  answer: { question: string; text: string; by: string } | null;
  /** The branch's diff, for the stage that reads it. */
  diff: { text: string; stat: string; clipped: boolean } | null;
  /** The comment this stage leaves on the tracker; null when its template says none. */
  comment?: CommentAsk | null;
  /** The pull request description, for the stage that ends with the push. */
  pr?: CommentAsk | null;
  /** The agent a question of this agent goes to first (`AgentDef.turnsTo`), when it is in the team; absent: it goes to the person. */
  turnsTo?: string | null;
  /** The agent may ask the person who reported the issue, on the issue. */
  reporter?: boolean;
  /** The labels the agent may propose as the issue's priority (the ones that can be written to the tracker); empty or absent: it proposes none. */
  priority?: string[];
}

const MESSAGE_MAX = 1500;

/** Text from outside goes between <data> tags: a closing tag inside it must not end the fence early. */
export const fence = (text: string): string => text.replace(/<(\/?)data\b/gi, '&lt;$1data');
const DIFF_MAX = 60_000;
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

/** The recent messages of the thread, oldest first, as lines a model can read; the app's own bookkeeping is left out. */
export function threadText(messages: ForumMessage[]): string {
  return messages
    .filter((m) => m.kind !== 'system')
    .map((m) => {
      const who = m.author.type === 'agent' ? m.author.id : m.author.type === 'person' ? t('main.runner.author.person') : t('main.runner.author.app');
      return `#${m.seq} ${who} (${t(`main.runner.kind.${m.kind}`)}): ${clip(messageText(m), MESSAGE_MAX)}`;
    })
    .join('\n');
}

export const DIFF_LIMIT = DIFF_MAX;

export function systemText(i: StageInput): string {
  const folder = i.run.cycleFolder;
  const rules = i.writes
    ? cp('runner.rules.write', { folder, commands: i.commands.length ? i.commands.join(', ') : cp('runner.denied.noCommands') })
    : cp('runner.rules.read', { folder });
  const agents = i.config.agents;
  return [
    cp('runner.system', { agent: cycleWord(i.agent.name), job: cycleWord(i.agent.job), ref: i.run.issue.ref, title: i.run.issue.title, stage: i.stage.label }),
    rules,
    cp('runner.rules.data'),
    agents.persona.trim(),
    agents.extraInstructions.trim(),
    cycleWord(i.agent.instructions).trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

const sectionLines = (ask: CommentAsk): string => ask.sections.map((s) => `- ${cycleWord(s.heading)}: ${cycleWord(s.guidance)}`).join('\n');

/** What the agent is told about the tracker comment (and the pull request description) it writes in this stage: the template's sections and the comment standard. */
export function commentPrompt(i: StageInput): string {
  const parts: string[] = [];
  if (i.comment) {
    parts.push(cp('runner.comment', { sections: sectionLines(i.comment), technical: i.comment.technical ? cp('runner.comment.technical') : cp('runner.comment.noTechnical') }));
  }
  if (i.pr) parts.push(cp('runner.comment.pr', { sections: sectionLines(i.pr), technical: i.pr.technical ? cp('runner.comment.technical') : cp('runner.comment.noTechnical') }));
  return parts.join('\n\n');
}

export function stagePrompt(i: StageInput): string {
  const sections: string[] = [];
  for (const f of i.files) {
    sections.push(cp('runner.section.file', { name: f.name === ISSUE_FILE ? `${f.name} (${t('main.runner.issueFile')})` : f.name, text: fence(f.text) + (f.clipped ? `\n${cp('runner.section.clipped')}` : '') }));
  }
  if (i.diff) {
    const body = i.diff.text.trim() ? i.diff.text.slice(0, DIFF_MAX) : cp('runner.section.diffNone');
    sections.push(cp('runner.section.diff', { stat: i.diff.stat, text: fence(body) + (i.diff.clipped || i.diff.text.length > DIFF_MAX ? `\n${cp('runner.section.diffClipped')}` : '') }));
  }
  const thread = threadText(i.thread);
  if (thread) sections.push(cp('runner.section.thread', { text: fence(thread) }));
  if (i.handoff) sections.push(cp('runner.section.handoff', { from: i.handoff.from, text: fence(i.handoff.text) }));
  if (i.answer) sections.push(cp('runner.section.answer', { question: i.answer.question, text: fence(i.answer.text), from: i.answer.by }));
  return cp('runner.stage', {
    stage: i.stage.label,
    ref: i.run.issue.ref,
    attempt: i.attempt,
    folder: i.run.cycleFolder,
    expected: i.stage.artifacts.length ? cp('runner.expected', { artifacts: i.stage.artifacts.join(', ') }) : cp('runner.expected.none'),
    sections: sections.join('\n\n'),
    output: [i.kind === 'review' ? cp('runner.output.review') : i.kind === 'qa' ? cp('runner.output.qa') : cp('runner.output.work'), i.turnsTo ? cp('runner.output.ask', { agent: i.turnsTo }) : '', i.reporter ? cp('runner.output.reporter') : '', i.priority?.length ? cp('runner.output.priority', { labels: i.priority.join(', ') }) : '', commentPrompt(i)].filter(Boolean).join('\n\n'),
  });
}
