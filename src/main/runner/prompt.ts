import type { SandboxGui } from '../sandbox/session';
import { OUT } from '../sandbox/policy';
import type { AgentDef, SquadDef, WorkspaceConfig } from '../../shared/config/types';
import { type AttachmentRef, formatBytes, kindLabelKey } from '../../shared/attachments';
import { type ForumMessage, messageText } from '../../shared/forum';
import type { OutputKind, RoutingWhy } from '../../shared/runs';
import { type FlowStage, type ReviewRecord, type Run, findingText } from '../../shared/runs';
import { t } from '../../shared/i18n';
import { prompt as cp, text as cycleWord } from '../cyclePrompts';
import type { CommandResult } from './commands';
import { type FolderFile, ISSUE_FILE, MEMORY_FILE } from './cycleFolder';
import { MEMORY_MAX } from './memory';
import { type ScreenPrompt, screenRules, shellRules } from './screenPrompt';

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
  /** This attempt picks the stage up again: why, and what the earlier attempts left done. Absent on a first attempt and while an answer resumes the stage. */
  resume?: StageResume | null;
  /** The person's answer to what this agent asked before. */
  answer: { question: string; text: string; by: string; attachments: AttachmentRef[] } | null;
  /** What the app ran in the worktree before this stage (QA): undefined when the stage is not given any; an empty list when the workspace lists none. */
  commandResults?: CommandResult[];
  /** The stage's agent runs commands in a sandbox: what it is told about it (and that a reader works in a copy). */
  sandbox?: { network: 'off' | 'registry' | 'open'; reader: boolean; host?: boolean; gui?: SandboxGui; look?: boolean };
  /** What the agent is told of its screen, its own hosts and the app's browser; absent for an agent with neither the switch nor a host list. */
  screen?: ScreenPrompt;
  /** The commands are numbered in the prompt (a stage with a sandbox: the agent cites them as the evidence of a scenario). */
  numberedCommands?: boolean;
  /** The agent has the evidence tools: what it is told about keeping a file and citing its id. */
  evidence?: boolean;
  /** The review passes of this stage that came before this one, for a review that is not the first. */
  earlier?: ReviewRecord[];
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
  /** The squad the run works in: its mission is told to the agent. */
  squad?: SquadDef | null;
  /** The agent proposes the squad of the issue: the squads it may name and why the scope rules did not pick one. */
  routing?: { squads: SquadDef[]; why: RoutingWhy };
  /** The labels the agent may propose as the issue's priority (the ones that can be written to the tracker); empty or absent: it proposes none. */
  priority?: string[];
  /** The levels a stage before the one that owns the priority may suggest in its documents (not propose). */
  priorityHint?: string[];
  /** A release run: the section that says which version, the state of its branch and the activities as last read (already fenced). */
  release?: string;
  /** What the plugins that are on tell the agents, each under its name: the plugin's words, material and never the person's instruction. */
  plugins?: { name: string; note: string }[];
  /** The cycle memory of the run: whether it passed its cap and what the cap is. The file itself arrives in `files`, first. */
  memory?: { over: boolean; max: number } | null;
  /** What the app knows of the activities of the workspace, rendered: the front of this activity whole and the rest in short, or "" (then no section). */
  shared?: string;
  /**
   * The workspace's learned procedures: the call has the tools when this is a string (then the rules are in the system text), and the list is the string itself,
   * rendered; "" is a call with the tools and nothing listed (no section). Absent: no tools, and neither rules nor section.
   */
  procedures?: string;
  /** The call has the app's browser, so it is also given the draft: the rules say to keep a screen task with `procedures_draft`. Only with `procedures`. */
  proceduresGui?: boolean;
  /** The stage changes the branch and the repository has AGENTS.md instructions that must stay true. */
  docsKeep?: boolean;
  /** The stage carries the workspace's test environment: it is told what that means (masked values, blocked images). */
  testEnv?: boolean;
}

/** Why a stage runs again: the person sent the work back, a review or QA returned it, the person retried a failure, or the app restarted under it. */
export type ResumeWhy = 'sent-back' | 'returned' | 'retried' | 'restarted';

export interface StageResume {
  why: ResumeWhy;
  /** The documents of this stage already in the cycle folder. */
  done: string[];
  /** The evidence this stage already kept in the run. */
  evidence: { id: string; title: string }[];
  /** The last report this agent gave in this stage. */
  previous: string | null;
}

const MESSAGE_MAX = 1500;

/** Text from outside goes between <data> tags: a closing tag inside it must not end the fence early. */
export const fence = (text: string): string => text.replace(/<(\/?)data\b/gi, '&lt;$1data');
const DIFF_MAX = 60_000;
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

/** The files of a message, as a stage's agent reads them: id, name, kind and size, never a path on the computer. */
export function attachmentsList(refs: readonly AttachmentRef[]): string {
  const lines = refs.map((r) => `- ${r.id}: "${r.name}", ${t(kindLabelKey(r.kind))}, ${formatBytes(r.bytes)}`);
  return t('main.attachment.tool.list', { count: refs.length }) + '\n' + lines.join('\n');
}

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

/**
 * How to test an interface in this stage: the general way (the sandbox's, or the computer's for an agent that runs commands there), then one line for each piece the
 * person switched on, saying whether the stage has it. Absent when the person switched neither on, so such a stage's prompt is what it was.
 */
function guiRules(gui: SandboxGui, look: boolean, host: boolean, screen?: ScreenPrompt): string {
  const out = gui.out ?? '';
  // An agent that has the app's browser is told that its own Playwright is for the app under test: the text that says "no network" or "never an external address" reads it.
  return [
    host ? (screen?.screen ? cp('runner.rules.gui.host.screen', { out }) : cp('runner.rules.gui.host', { out })) : screen?.screen ? cp('runner.rules.gui.screen') : cp('runner.rules.gui'),
    gui.browsers ? cp('runner.rules.gui.browsers', { path: gui.browsers }) : gui.browsersGone ? cp('runner.rules.gui.noBrowsers') : '',
    gui.display === 'on' ? cp('runner.rules.gui.display') : gui.display === 'missing' || gui.display === 'failed' ? cp('runner.rules.gui.noDisplay') : '',
    look ? (host ? cp('runner.rules.gui.look.host', { out }) : cp('runner.rules.gui.look')) : cp('runner.rules.gui.noLook'),
  ]
    .filter(Boolean)
    .join(' ');
}

export function systemText(i: StageInput): string {
  const folder = i.run.cycleFolder;
  const rules = i.writes
    ? cp('runner.rules.write', { folder, commands: i.commands.length ? i.commands.join(', ') : cp('runner.denied.noCommands') })
    : cp('runner.rules.read', { folder });
  const agents = i.config.agents;
  return [
    cp('runner.system', { agent: cycleWord(i.agent.name), job: cycleWord(i.agent.job), ref: i.run.issue.ref, title: i.run.issue.title, stage: cycleWord(i.stage.label) }),
    i.squad ? cp('runner.squad.system', { squad: cycleWord(i.squad.name), mission: i.squad.mission.trim() ? cycleWord(i.squad.mission) : '—' }) : '',
    rules,
    i.sandbox ? shellRules(i.sandbox, i.screen) : '',
    i.sandbox?.reader ? (i.sandbox.host ? cp('runner.rules.shellReader.host') : cp('runner.rules.shellReader')) : '',
    i.sandbox?.gui ? guiRules(i.sandbox.gui, i.sandbox.look === true, i.sandbox.host === true, i.screen) : '',
    i.testEnv ? cp('runner.rules.testEnv') : '',
    screenRules(i.screen),
    cp('runner.rules.data'),
    cp('runner.rules.memory', { max: MEMORY_MAX }),
    cp('runner.rules.claims'),
    cp('runner.rules.focus'),
    i.procedures !== undefined ? cp('runner.rules.procedures') : '',
    i.procedures !== undefined && i.proceduresGui ? cp('runner.rules.proceduresGui') : '',
    // The folder of the stage's evidence is named as this stage has it: the sandbox's `/coxia/out`, or the real folder a host session saves in.
    i.evidence ? cp(i.sandbox?.host && i.sandbox.gui?.out ? 'runner.rules.evidence.host' : 'runner.rules.evidence', { out: i.sandbox?.gui?.out ?? OUT }) : '',
    i.docsKeep ? cp('runner.docs.keep') : '',
    agents.persona.trim(),
    agents.extraInstructions.trim(),
    cycleWord(i.agent.instructions).trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

const squadLine = (q: SquadDef): string => {
  const none = '—';
  const scope = cp('runner.squad.scope', { repos: q.scope.repos.join(', ') || none, labels: q.scope.labels.join(', ') || none, paths: q.scope.paths.map((p) => `${p.repo}:${p.prefix}`).join(', ') || none });
  return cp('runner.squad.line', { id: q.id, name: cycleWord(q.name), mission: q.mission.trim() ? cycleWord(q.mission) : none, scope });
};

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

/** What the app ran before QA, as the stage reads it: each command with how it ended and the end of its output, or the plain statement that nothing ran. */
export function commandsSection(results: CommandResult[], numbered = false): string {
  if (!results.length) return cp('runner.section.commandsNone');
  // A command the environment could not start is said apart from one that ran and failed: it is not a result of the code.
  const couldNot = (r: CommandResult): boolean => !r.timedOut && (!!r.notRun || r.exitCode === 126 || r.exitCode === 127);
  const head = (r: CommandResult): string => (r.timedOut ? cp('runner.commands.timeout', { command: r.command }) : couldNot(r) ? cp('runner.commands.couldNotRun', { command: r.command }) : r.exitCode === null ? cp('runner.commands.notRun', { command: r.command }) : cp('runner.commands.exit', { command: r.command, code: r.exitCode }));
  const text = results.map((r, i) => `${numbered ? `#${i + 1} ` : ''}${head(r)}\n${r.output ? fence(r.output) : cp('runner.commands.noOutput')}`).join('\n\n');
  const section = cp('runner.section.commands', { text });
  return results.some(couldNot) ? `${section}\n\n${cp('runner.section.commandsUnrunnable')}` : section;
}

/** The earlier review passes as lines a model can read: each round's verdict and summary, then its findings (blocking ones first). */
export function roundsText(rounds: ReviewRecord[]): string {
  return rounds
    .map((r) => {
      const order = [...r.findings].sort((a, b) => Number(b.severity === 'blocking') - Number(a.severity === 'blocking'));
      return [cp('runner.rounds.round', { round: r.round, verdict: r.verdict, summary: clip(r.summary, 600) }), ...order.map(findingText)].join('\n');
    })
    .join('\n\n');
}

/** Why the stage runs again, in words; each id is named at its call so the catalog check finds it. */
function whyText(why: ResumeWhy): string {
  switch (why) {
    case 'sent-back':
      return cp('runner.resume.why.sentBack');
    case 'returned':
      return cp('runner.resume.why.returned');
    case 'retried':
      return cp('runner.resume.why.retried');
    case 'restarted':
      return cp('runner.resume.why.restarted');
  }
}

const senderOf = (from: string): string => (from === 'person' ? t('main.runner.author.person') : from === 'app' ? t('main.runner.author.app') : from);

/**
 * What a stage that runs again is told before anything else: why it runs again, the request of this attempt (the handoff, said once), and what the earlier
 * attempts left done, so the agent works on what was asked instead of starting the stage over.
 */
export function resumeSection(i: StageInput, r: StageResume): string {
  const none = cp('runner.resume.none');
  return cp('runner.section.resume', {
    why: whyText(r.why),
    request: i.handoff ? cp('runner.resume.request', { from: senderOf(i.handoff.from), text: fence(i.handoff.text) }) : cp('runner.resume.noRequest'),
    done: r.done.length ? r.done.join(', ') : none,
    evidence: r.evidence.length ? r.evidence.map((e) => `${e.id} (${e.title})`).join(', ') : none,
    previous: r.previous ? cp('runner.resume.previous', { text: fence(clip(r.previous, MESSAGE_MAX)) }) : '',
    rules: [cp('runner.resume.rules'), i.kind === 'qa' ? cp('runner.resume.rules.qa') : ''].filter(Boolean).join(' '),
  });
}

export function stagePrompt(i: StageInput): string {
  const sections: string[] = [];
  // A stage that runs again opens with why and what was asked; the handoff is said there, so it is not repeated in the thread or at the end.
  const resume = i.resume && !i.answer ? i.resume : null;
  if (resume) sections.push(resumeSection(i, resume));
  for (const f of i.files) {
    sections.push(cp('runner.section.file', { name: f.name === ISSUE_FILE ? `${f.name} (${t('main.runner.issueFile')})` : f.name, text: fence(f.text) + (f.clipped ? `\n${cp('runner.section.clipped')}` : '') }));
    if (f.name === MEMORY_FILE && i.memory?.over) sections.push(cp('runner.section.memoryOver', { max: i.memory.max }));
  }
  if (i.diff) {
    const body = i.diff.text.trim() ? i.diff.text.slice(0, DIFF_MAX) : cp('runner.section.diffNone');
    sections.push(cp('runner.section.diff', { stat: i.diff.stat, text: fence(body) + (i.diff.clipped || i.diff.text.length > DIFF_MAX ? `\n${cp('runner.section.diffClipped')}` : '') }));
  }
  if (i.commandResults) sections.push(commandsSection(i.commandResults, i.numberedCommands));
  // What the app knows of the other activities, and of this one whole: material to consult, under its own tags (specification rules 5 to 7).
  if (i.shared) sections.push(cp('runner.section.shared', { text: fence(i.shared) }));
  if (i.procedures) sections.push(cp('runner.section.procedures', { text: fence(i.procedures) }));
  if (i.release) sections.push(i.release);
  if (i.plugins?.length) sections.push(cp('runner.section.plugins', { text: fence(i.plugins.map((p) => `${p.name}: ${p.note}`).join('\n')) }));
  if (i.earlier?.length) sections.push(cp('runner.section.rounds', { text: fence(roundsText(i.earlier)) }));
  const said = resume && i.handoff ? i.handoff.text : null;
  const thread = threadText(said === null ? i.thread : i.thread.filter((m) => !(m.kind === 'handoff' && m.to === i.agent.id && m.text === said)));
  if (thread) sections.push(cp('runner.section.thread', { text: fence(thread) }));
  if (i.handoff && !resume) sections.push(cp('runner.section.handoff', { from: i.handoff.from, text: fence(i.handoff.text) }));
  if (i.answer) sections.push(cp('runner.section.answer', { question: i.answer.question, text: fence(i.answer.text), from: i.answer.by }));
  // When the answer the stage waits for carries files, the agent is told which ones and opens them with the read-only tool.
  if (i.answer?.attachments?.length) sections.push(cp('runner.section.attachments', { text: fence(attachmentsList(i.answer.attachments)) }));
  return cp('runner.stage', {
    stage: cycleWord(i.stage.label),
    ref: i.run.issue.ref,
    attempt: i.attempt,
    folder: i.run.cycleFolder,
    expected: i.stage.artifacts.length ? cp('runner.expected', { artifacts: i.stage.artifacts.join(', ') }) : cp('runner.expected.none'),
    sections: sections.join('\n\n'),
    output: [i.kind === 'review' ? [cp('runner.output.review'), i.earlier?.length ? cp('runner.output.reviewAgain', { round: (i.earlier.at(-1)?.round ?? 0) + 1 }) : ''].filter(Boolean).join(' ') : i.kind === 'qa' ? [cp('runner.output.qa'), i.sandbox ? cp('runner.output.evidence', { out: i.sandbox.gui?.out ?? OUT }) : ''].filter(Boolean).join(' ') : cp('runner.output.work'), cp('runner.output.memory', { max: MEMORY_MAX }), i.turnsTo ? cp('runner.output.ask', { agent: i.turnsTo }) : '', i.reporter ? cp('runner.output.reporter') : '', i.priority?.length ? cp('runner.output.priority', { labels: i.priority.join(', ') }) : '', i.priorityHint?.length ? cp('runner.output.priorityHint', { labels: i.priorityHint.join(', ') }) : '', i.routing ? cp(`runner.output.squad.${i.routing.why}`, { squads: i.routing.squads.map(squadLine).join('\n') }) : '', commentPrompt(i)].filter(Boolean).join('\n\n'),
  });
}
