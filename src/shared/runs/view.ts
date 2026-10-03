import type { RepoConfig } from '../config/types';
import { sameFinding } from './output';
import { type FlowStage, type Run, type RunStatus, isTerminal } from './types';

// What the run screens decide from a run, as plain data: which badge a card carries, who a run waits for, which runs a card has. The screens only draw it.
// Pure: nothing here reads the disk, the config's secrets or the DOM.

export type RunTone = 'working' | 'person' | 'blocked' | 'quiet' | 'done';

/** How a status is drawn: working is blue, what waits for the person amber, what is stuck red, a wait or a cancellation quiet, the end teal. */
export const RUN_TONE: Record<RunStatus, RunTone> = {
  working: 'working',
  gate: 'person',
  'to-start': 'person',
  'to-accept': 'person',
  question: 'blocked',
  failed: 'blocked',
  waiting: 'quiet',
  cancelled: 'quiet',
  done: 'done',
};

/** Whether the run is stuck on something: an agent's question (anywhere along its chain) or a failed stage. This is what a card shows as a blocker. */
export const isRunBlocker = (run: Pick<Run, 'status'> | null | undefined): boolean => !!run && (run.status === 'question' || run.status === 'failed');

/** Whether the person has something to do for the run now: decide a gate, answer, start or accept a stage, retry, or choose a squad. A question still held by an agent is the team's to answer. */
export function needsPerson(run: Pick<Run, 'status' | 'question'>): boolean {
  if (run.status === 'question') return !run.question || (run.question.holder ?? null) === null;
  return run.status === 'gate' || run.status === 'to-start' || run.status === 'to-accept' || run.status === 'failed';
}

/** Whether the run is still going (not done, not cancelled). */
export const isActive = (run: Pick<Run, 'status'>): boolean => !isTerminal(run);

/** The run a card stands for: the one still going wins over one that ended, and among equals the newest; null when the issue never had one. */
export function runOfCard<T extends { issue: { ref: string }; status: string; createdAt: string }>(runs: readonly T[], ref: string): T | null {
  const mine = runs.filter((r) => r.issue.ref === ref);
  const rank = (r: T): number => (r.status === 'cancelled' ? 0 : r.status === 'done' ? 1 : 2);
  return [...mine].sort((a, b) => rank(b) - rank(a) || b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** The label of the stage the run is in, from the flow the run keeps (the stage id when the run has no copy). */
export function stageLabelOf(run: Pick<Run, 'stage' | 'flow'>): string {
  return run.flow?.stages.find((s) => s.id === run.stage)?.label ?? run.stage;
}

/** The flow stage of a run's current stage, when the run keeps a copy or `flow` is given. */
export const currentStage = (run: Pick<Run, 'stage' | 'flow'>, flow: readonly FlowStage[] | undefined = run.flow?.stages): FlowStage | null => flow?.find((s) => s.id === run.stage) ?? null;

/** The agent that works the run's current stage (null at a gate, a wait or an end). */
export const currentAgent = (run: Pick<Run, 'stage' | 'flow' | 'stages'>, flow?: readonly FlowStage[]): string | null => currentStage(run, flow)?.agent ?? run.stages.find((s) => s.stage === run.stage)?.agent ?? null;

/**
 * The repositories the person has to choose from before a run can start, or null when the runner can tell on its own: it takes the one repository that
 * lives in the issue project, or the only repository of the workspace when none does.
 */
export function reposToChoose(repos: readonly Pick<RepoConfig, 'id' | 'projectPath'>[], issueProject: string | null): Pick<RepoConfig, 'id' | 'projectPath'>[] | null {
  const own = repos.filter((r) => issueProject !== null && r.projectPath === issueProject);
  if (own.length === 1) return null;
  if (!own.length && repos.length === 1) return null;
  return own.length ? [...own] : [...repos];
}

// ---- what the person can do about a run ---------------------------------------------------------------------------------------------

export const RUN_ACTIONS = ['startStage', 'accept', 'return', 'approve', 'reject', 'skip', 'answer', 'chooseSquad', 'skipWait', 'retry', 'cancel'] as const;
export type RunActionId = (typeof RUN_ACTIONS)[number];

export interface RunAction {
  id: RunActionId;
  /** What the person types with it: nothing, a note they may leave out, or a text without which the move is refused. */
  input: 'none' | 'optional' | 'required';
  /** Only the app on the computer may do it (a browser sees it disabled, with a note): everything that starts work or changes a run. */
  desktopOnly: boolean;
  /** Needs a second click: what cannot be taken back. */
  confirm: boolean;
}

const act = (id: RunActionId, input: RunAction['input'] = 'none', over: Partial<RunAction> = {}): RunAction => ({ id, input, desktopOnly: true, confirm: false, ...over });

/**
 * What the person may do for a run in the state it is in, in the order the screen offers it. This is the table of the transitions of `runs/transitions.ts` seen
 * from the screen: the same states, the same notes that are required (a rejection, a skip and a return carry a reason; an approval and an acceptance may not).
 * Answering a question is the one thing a browser may do; cancelling asks for a second click.
 */
export function runActions(run: Pick<Run, 'status' | 'question'>): RunAction[] {
  const cancel = act('cancel', 'none', { confirm: true });
  switch (run.status) {
    case 'to-start':
      return [act('startStage'), cancel];
    case 'to-accept':
      return [act('accept', 'optional'), act('return', 'required'), cancel];
    case 'gate':
      return [act('approve', 'optional'), act('reject', 'required'), act('skip', 'required'), cancel];
    case 'question':
      return [run.question?.kind === 'squad' ? act('chooseSquad') : act('answer', 'required', { desktopOnly: false }), cancel];
    case 'waiting':
      return [act('skipWait', 'required'), cancel];
    case 'failed':
      return [act('retry'), cancel];
    case 'working':
      return [cancel];
    default:
      return [];
  }
}

// ---- the stages of a run, as a timeline ------------------------------------------------------------------------------------------------

/** Where a stage stands for the person reading the timeline. `upcoming`: the run has not reached it. The others say what the run (or the stage's last attempt) did there. */
export const STAGE_STATES = ['upcoming', 'running', 'to-start', 'to-accept', 'gate', 'question', 'waiting', 'failed', 'done', 'skipped', 'rejected', 'cancelled'] as const;
export type StageState = (typeof STAGE_STATES)[number];

export interface StageRow {
  stage: FlowStage;
  record: Run['stages'][number] | null;
  state: StageState;
  /** The run is in this stage now. */
  current: boolean;
}

const RUN_STATE: Partial<Record<RunStatus, StageState>> = { working: 'running', 'to-start': 'to-start', 'to-accept': 'to-accept', gate: 'gate', question: 'question', waiting: 'waiting', failed: 'failed' };

/** The stages of the flow the run follows, in order, each with what the run did there. The current stage takes its state from the run, the others from their record. */
export function stageRows(run: Run, flow: readonly FlowStage[]): StageRow[] {
  return flow.map((stage) => {
    const record = run.stages.find((r) => r.stage === stage.id) ?? null;
    const current = run.stage === stage.id;
    let state: StageState = 'upcoming';
    if (current && !isTerminal(run)) state = RUN_STATE[run.status] ?? 'running';
    else if (record) state = record.status === 'running' || record.status === 'waiting' ? (isTerminal(run) && run.status === 'cancelled' ? 'cancelled' : 'done') : record.status;
    return { stage, record, state, current };
  });
}

// ---- the tracker comments of a run ---------------------------------------------------------------------------------------------------

export type CommentKind = 'stage' | 'decision' | 'question' | 'review' | 'pr';

export interface CommentRow {
  key: string;
  kind: CommentKind;
  /** The stage it belongs to; null for the pull request's own description. */
  stage: string | null;
  record: Run['comments'][string];
  /** What to call it: its title, else its status line, else its key. */
  label: string;
}

/** The kind and the stage of a comment from its key: a stage id, `decision-<gate>-<n>`, `question-<stage>-<n>`, `review-<round>` or `pr`. */
export function commentKey(run: Pick<Run, 'reviews'>, key: string): { kind: CommentKind; stage: string | null } {
  if (key === 'pr') return { kind: 'pr', stage: null };
  const decision = /^decision-(.+)-\d+$/.exec(key);
  if (decision) return { kind: 'decision', stage: decision[1] };
  const question = /^question-(.+)-\d+$/.exec(key);
  if (question) return { kind: 'question', stage: question[1] };
  const review = /^review-(\d+)$/.exec(key);
  if (review) return { kind: 'review', stage: run.reviews.find((r) => r.round === Number(review[1]))?.stage ?? null };
  return { kind: 'stage', stage: key };
}

/** Every tracker comment of the run, oldest first, each with the stage it belongs to. */
export function commentRows(run: Pick<Run, 'comments' | 'reviews'>): CommentRow[] {
  return Object.entries(run.comments)
    .map(([key, record]) => ({ key, ...commentKey(run, key), record, label: record.title || record.headline || key }))
    .sort((a, b) => a.record.updatedAt.localeCompare(b.record.updatedAt));
}

/** Whether a comment can be taken back: it is up on the tracker and it is not the pull request's description (the runner cannot delete that). */
export const canUndoPost = (row: Pick<CommentRow, 'kind' | 'record'>): boolean => row.record.status === 'published' && row.kind !== 'pr';

// ---- the review rounds ---------------------------------------------------------------------------------------------------------------

/**
 * Where a finding's thread stands on the pull request, from the rounds: `open` while it is in the latest round and that round asked for changes (or the run
 * still goes on); `still`: the next round found it again, so its thread got a reply instead of a new comment; `fixed`: a later round no longer has it (or the
 * review was approved), so the thread was resolved. Worked out from the findings the rounds hold, not read from the host.
 */
export type FindingThread = 'open' | 'still' | 'fixed';

export interface RoundView {
  round: Run['reviews'][number];
  findings: { finding: Run['reviews'][number]['findings'][number]; thread: FindingThread }[];
}

export function reviewRounds(run: Pick<Run, 'reviews'>): RoundView[] {
  return run.reviews.map((round, i) => {
    const next = run.reviews[i + 1];
    return {
      round,
      findings: round.findings.map((finding) => {
        let thread: FindingThread = 'open';
        if (next) thread = next.findings.some((f) => sameFinding(finding, f)) ? 'still' : 'fixed';
        else if (round.verdict === 'approved') thread = 'fixed';
        return { finding, thread };
      }),
    };
  });
}

// ---- the flow a run follows ----------------------------------------------------------------------------------------------------------

/** Whether the run follows an earlier version of the flow than the one the cycle has now: a run with no copy follows the current one. */
export const followsOlderFlow = (run: Pick<Run, 'flow'>, currentHash: string): boolean => !!run.flow && run.flow.hash !== currentHash;

// ---- the list of runs ---------------------------------------------------------------------------------------------------------------------

export const RUN_FILTERS = ['all', 'you', 'working', 'waiting', 'failed', 'finished'] as const;
export type RunFilter = (typeof RUN_FILTERS)[number];

/** Whether a run belongs to a filter: `you`: something waits for the person; `waiting`: it waits for an event or for another agent; `finished`: done or cancelled. */
export function inFilter(run: Pick<Run, 'status' | 'question'>, filter: RunFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'you':
      return needsPerson(run);
    case 'working':
      return run.status === 'working';
    case 'waiting':
      return run.status === 'waiting' || (run.status === 'question' && !needsPerson(run));
    case 'failed':
      return run.status === 'failed';
    case 'finished':
      return isTerminal(run);
  }
}

/** The runs of a filter and, optionally, of one squad (`''` is the runs with no squad); what waits for the person first, then what goes on, then what ended, the newest change first inside each. */
export function listRuns<T extends Pick<Run, 'status' | 'question' | 'squad' | 'updatedAt'>>(runs: readonly T[], filter: RunFilter = 'all', squad: string | null = null): T[] {
  const rank = (r: T): number => (isTerminal(r) ? 2 : needsPerson(r) ? 0 : 1);
  return runs
    .filter((r) => inFilter(r, filter) && (squad === null || (r.squad ?? '') === squad))
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt));
}

/** How many runs each filter has, for the chips. */
export const filterCounts = (runs: readonly Pick<Run, 'status' | 'question'>[]): Record<RunFilter, number> =>
  Object.fromEntries(RUN_FILTERS.map((f) => [f, runs.filter((r) => inFilter(r, f)).length])) as Record<RunFilter, number>;
