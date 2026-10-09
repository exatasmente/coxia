import type { AgentDef } from '../../shared/config/types';
import { LIMITS } from '../../shared/procedures';
import type { UsageReport } from '../../shared/runs/usage';
import type { AgentCall } from '../agents';
import { prompt as cp } from '../cyclePrompts';
import { redact } from '../errorlog-core';
import { fence } from '../runner/prompt';
import type { StageEngine } from '../runner/executor';
import type { OfferDraft, OfferInput } from './offers';
import { acceptsText } from './record';
import type { ProcedureSession, WrapUpPlan } from './session';

// The one last turn of a work that may be kept as a procedure (#187, spec rule 14): the same agent is called once more with a small prompt, the tools of the procedures and
// nothing else, and what the app drafted. If it does not save, each draft it left becomes an offer for the person. The turn never fails the work it follows: a limit, an error,
// a refused budget and a Cancel all end it quietly, and the work's result is what it was. The tokens it spends are the work's own, reported to the caller's usage callback and
// not to the session's meter, so a baseline still means what finding the procedure cost.

/** A read, a save, a closing word. */
export const WRAPUP_MAX_TURNS = 3;
/** The turn's own limit, outside the stage's watchdog. */
export const WRAPUP_MS = 120_000;
/** A procedure stores at most this many steps: a longer draft is for the agent to pick from by number, and never a card. */
export const OFFER_MAX_STEPS = LIMITS.steps;

export interface WrapUpDeps {
  /** The engine that runs an agent call: the stage's own, or the conversation's. */
  engine: StageEngine;
  /** Where the offers are held. */
  offers: { raise(input: OfferInput): unknown };
  /** A system line in the thread of the work, as a forum code with its params. A line that cannot be written is not the turn's to know. */
  note(code: string, params: Record<string, string | number>): void;
}

export interface WrapUpRun {
  /** The agent that did the work: its model is the turn's. */
  agent: AgentDef;
  /** The call's procedure session: its tools are the turn's tools, and the offers are made in its name. */
  session: ProcedureSession;
  plan: WrapUpPlan;
  /** What the work was, in a line: the run's reference and title, or the conversation's. */
  ref: string;
  /** The forum thread the work was in: `run-<id>` for a stage. */
  thread: string;
  stage?: string;
  /** A folder that exists while the turn runs: no tool of the turn reads it, but the engine starts there. */
  cwd: string;
  /** The work's own abort: Cancel stops the turn and the work's result stands. */
  abort?: AbortSignal;
  /** What the turn used goes here, to the usage of the work it belongs to. */
  onUsage?: (usage: UsageReport) => void;
  /** The person's home folder, for the validator; the machine's by default. */
  home?: string;
  /** For a test: the turn's limit. */
  ms?: number;
}

/** What the turn answers: nothing the app reads, but the engines want a shape. */
export const WRAPUP_SCHEMA = { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false } as const;

/**
 * Whether a draft may become a card: at most the stored steps, and every text of it passes the validator for its field, with the same classes of secret as a saved record.
 * The card shows the text exactly as a Yes would save it, so a text that a Yes would refuse is not offered.
 */
export function cardable(draft: OfferDraft, home?: string): boolean {
  if (!draft.steps.length || draft.steps.length > OFFER_MAX_STEPS) return false;
  const gui = draft.kind === 'gui';
  const ok = (value: unknown, limits: Parameters<typeof acceptsText>[1]): boolean => acceptsText(value, limits, home);
  return (
    ok(draft.key, { max: LIMITS.key, free: draft.kind === 'tool' }) &&
    ok(draft.title, { max: LIMITS.title, title: true }) &&
    draft.steps.every((s) => ok(s.text, { max: LIMITS.stepText, gui }) && (s.run === undefined || ok(s.run, { max: LIMITS.stepRun }))) &&
    draft.pitfalls.every((p) => ok(p, { max: LIMITS.pitfall, gui })) &&
    draft.waits.every((w) => ok(w, { max: LIMITS.wait, gui }))
  );
}

/** The prompt of the turn: the work's line, the agent's closing words as data, and the drafts. */
export function turnPrompt(run: Pick<WrapUpRun, 'ref' | 'plan'>): string {
  const words = run.plan.words ? cp('runner.procedures.turn.words', { words: fence(run.plan.words) }) : '';
  return cp('runner.procedures.turn.main', { ref: run.ref.replace(/\s+/g, ' ').trim().slice(0, 200), words, drafts: run.plan.text });
}

/** The call the turn makes: a reader whatever the agent is, the procedure tools only, three turns. */
export function turnCall(run: WrapUpRun, abort: AbortController, onUsage: (usage: UsageReport) => void): AgentCall {
  return {
    agent: { ...run.agent, permission: 'read' },
    prompt: turnPrompt(run),
    schema: WRAPUP_SCHEMA as unknown as AgentCall['schema'],
    system: cp('runner.procedures.turn.system', { agent: run.agent.id }),
    cwd: run.cwd,
    label: run.agent.id,
    maxTurns: WRAPUP_MAX_TURNS,
    procedures: run.session.tools,
    procedureOnly: true,
    abort,
    onUsage,
  };
}

/**
 * Gives the turn and raises the offers it leaves. Never throws, and never touches the work's result. Resolves when the turn is over and the offers are raised; the caller
 * decides whether to wait for it (a stage does, a conversation does not).
 */
export async function runWrapUp(deps: WrapUpDeps, run: WrapUpRun): Promise<void> {
  try {
    if (run.abort?.aborted) return;
    await give(deps, run);
    // A Cancel while the turn ran is the work's cancel: nothing is offered for work that was stopped.
    if (run.abort?.aborted) return;
    raiseOffers(deps, run);
  } catch (e) {
    console.error('[procedures] the last turn failed', redact(e instanceof Error ? e.message : String(e)).slice(0, 300));
  }
}

/** The turn itself, under its own limit and the work's abort. Its failures are logged here and go no further. */
async function give(deps: WrapUpDeps, run: WrapUpRun): Promise<void> {
  const child = new AbortController();
  const stop = (): void => child.abort();
  run.abort?.addEventListener('abort', stop, { once: true });
  let tokens = 0;
  const onUsage = (u: UsageReport): void => {
    tokens += Math.max(0, Math.round(u.promptTokens || 0)) + Math.max(0, Math.round(u.completionTokens || 0));
    try {
      run.onUsage?.(u);
    } catch {
      // the work's meter failing is not the turn's to know
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = deps.engine(turnCall(run, child, onUsage), []);
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        child.abort();
        reject(new Error('the last turn ran past its limit'));
      }, run.ms ?? WRAPUP_MS);
    });
    // The work's Cancel ends the wait at once, as the stage's own guard does: an engine that does not notice the abort is not waited for.
    const stopped = new Promise<never>((_, reject) => {
      if (child.signal.aborted) reject(new Error('the last turn was stopped'));
      else child.signal.addEventListener('abort', () => reject(new Error('the last turn was stopped')), { once: true });
    });
    stopped.catch(() => undefined);
    // A turn that is abandoned at its limit may still reject later: that rejection is not an error of anyone.
    work.catch(() => undefined);
    await Promise.race([work, late, stopped]);
  } catch (e) {
    console.error('[procedures] the last turn ended without an answer', redact(e instanceof Error ? e.message : String(e)).slice(0, 300));
  } finally {
    clearTimeout(timer);
    run.abort?.removeEventListener('abort', stop);
    try {
      deps.note('runner.procedures.wrapUp', { agent: run.agent.id, tokens });
    } catch {
      // see WrapUpDeps.note
    }
  }
}

/**
 * The drafts a plan left, as offers. A draft that does not pass the checks of a card is dropped, and one that fails to raise does not stop the next. A conversation answer
 * whose screen already had its turn calls this alone, to refresh the card from what the newer answer drafted.
 */
export function raiseOffers(deps: Pick<WrapUpDeps, 'offers'>, run: Pick<WrapUpRun, 'plan' | 'agent' | 'session' | 'thread' | 'stage' | 'home'>): void {
  for (const draft of run.plan.settle()) {
    try {
      if (!cardable(draft, run.home)) continue;
      deps.offers.raise({
        ...draft,
        thread: run.thread,
        ...(run.stage ? { stage: run.stage } : {}),
        agent: run.agent.id,
        writer: run.session.writer,
        // What finding it cost: the work's own meter, which the turn is not in.
        usage: run.session.usage(),
        ...(run.session.issue !== undefined ? { issue: run.session.issue } : {}),
      });
    } catch (e) {
      console.error('[procedures] could not raise an offer', redact(e instanceof Error ? e.message : String(e)).slice(0, 300));
    }
  }
}
