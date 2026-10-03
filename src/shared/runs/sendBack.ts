import { parseMentions } from '../forum';
import { t } from '../i18n';
import { findingText } from './output';
import type { FlowStage, QaCommand, Run, RunStatus } from './types';

// Sending a run back to an earlier stage is the person's move: the run goes to a work stage it has already been through, with a note and with what the review
// and QA left open, and the stages after it run again. This file is what the move and the screens share: where a run can be sent from and to, what the
// agent that gets it is told, and how a text typed in the wrong box is recognised.

/** The states a run can be sent back from: any in which it waits for the person or for an event, and a finished run (which it reopens). Not while an agent works, not once cancelled. */
export const SEND_BACK_STATUSES: readonly RunStatus[] = ['waiting', 'gate', 'to-start', 'to-accept', 'failed', 'question', 'done'];

/** Whether the person can send this run back now. A question about which squad takes the issue is answered by choosing, not by going back. */
export const canSendBack = (run: Pick<Run, 'status' | 'question'>): boolean => SEND_BACK_STATUSES.includes(run.status) && !(run.status === 'question' && run.question?.kind === 'squad');

/** The stages a run in `stageId` can be sent back to: the work stages before it that have an agent, in the order of the flow. */
export function sendBackTargets(flow: readonly FlowStage[], stageId: string): FlowStage[] {
  const i = flow.findIndex((s) => s.id === stageId);
  return i < 0 ? [] : flow.slice(0, i).filter((s) => s.type === 'work' && !!s.agent);
}

/**
 * Where the work goes back to when the person does not say: the stage the flow names for the current one, unless that stage only verifies (a review or QA
 * does not change anything, so sending the work there would redo nothing); then the nearest earlier stage whose agent changes the worktree; then the nearest
 * earlier work stage.
 */
export function defaultSendBackTarget(flow: readonly FlowStage[], stageId: string, writes: (agent: string) => boolean): FlowStage | null {
  const targets = sendBackTargets(flow, stageId);
  if (!targets.length) return null;
  const named = targets.find((s) => s.id === flow.find((x) => x.id === stageId)?.returnsTo);
  if (named && named.kind !== 'review' && named.kind !== 'qa') return named;
  return [...targets].reverse().find((s) => !!s.agent && writes(s.agent)) ?? named ?? targets[targets.length - 1];
}

/** How a command of a QA pass ended, as a person reads it: it passed, it failed, it was stopped, or it could not run (not found, not executable). */
export function commandState(c: Pick<QaCommand, 'exitCode' | 'timedOut'>): 'ok' | 'failed' | 'timeout' | 'not-run' {
  if (c.timedOut) return 'timeout';
  if (c.exitCode === null || c.exitCode === 126 || c.exitCode === 127) return 'not-run';
  return c.exitCode === 0 ? 'ok' : 'failed';
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * What the agent that gets the work back is told: the person's note, then what the review and QA left open that has not been worked on since the stage last
 * started (the latest review's findings, blocking or only suggestions, and the scenarios QA did not pass or could not check, with the commands that did not
 * pass). Empty when there is neither a note nor anything open.
 */
export function sendBackText(run: Run, toStage: string, note: string): string {
  const since = run.stages.find((s) => s.stage === toStage)?.startedAt ?? null;
  const fresh = (at: string): boolean => since === null || at > since;
  const parts: string[] = [];
  if (note.trim()) parts.push(note.trim());
  const review = run.reviews.at(-1);
  if (review && fresh(review.at) && review.findings.length) {
    const order = [...review.findings].sort((a, b) => Number(b.severity === 'blocking') - Number(a.severity === 'blocking'));
    parts.push([t('main.runner.sendBack.review', { round: review.round }), ...order.map(findingText)].join('\n\n'));
  }
  const qa = run.qa.at(-1);
  if (qa && fresh(qa.at)) {
    const lines = [
      ...qa.scenarios.filter((s) => s.result !== 'pass').map((s) => t('main.runner.sendBack.scenario', { name: s.name, result: t(`main.runner.sendBack.result.${s.result}`), detail: clip((s.detail || '—').replace(/\s+/g, ' '), 600) })),
      ...(qa.commands ?? []).filter((c) => commandState(c) !== 'ok').map((c) => t('main.runner.sendBack.command', { command: c.command, outcome: t(`main.runner.sendBack.outcome.${commandState(c)}`, { code: c.exitCode ?? '—' }) })),
    ];
    if (lines.length) parts.push([t('main.runner.sendBack.qa'), ...lines].join('\n'));
  }
  return parts.join('\n\n');
}

// Words of a request to go back, in the languages of the catalogs.
const SEND_BACK_WORDS = /(^|[^\p{L}])(volte|voltar|volta|devolva|devolver|devolve|refaça|refaca|refazer|retorne|retornar|go back|send back|sent back|send it back|return)(?![\p{L}])/iu;

/**
 * Whether a text typed where the person gives a reason to stop waiting is really a request to send the work back: it names an agent of the team with an @, or
 * it reads as one. A heuristic that only decides what the screen offers; the person can still go on without waiting.
 */
export function looksLikeSendBack(text: string, agentIds: readonly string[]): boolean {
  return parseMentions(text, agentIds).length > 0 || SEND_BACK_WORDS.test(text);
}
