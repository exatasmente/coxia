import { matchStage } from '../config/stages';
import type { DevCycleConfig, StageDef, StageKind } from '../config/types';
import type { StageInput } from './types';

// The stage vocabulary of the cycle: which stage a card is in, what kind of stage that is, and what the app does about each kind.
// Everything here reads `devCycle.stages` and `devCycle.stageMapping`; no stage name is written in code.

type StageConfig = Pick<DevCycleConfig, 'stages'> & Partial<Pick<DevCycleConfig, 'stageMapping'>>;

const cache = new Map<string, RegExp | null>();

function regex(source: string): RegExp | null {
  let re = cache.get(source);
  if (re === undefined) {
    try {
      re = new RegExp(source, 'i');
    } catch {
      re = null;
    }
    cache.set(source, re);
  }
  return re;
}

// A scoped label ("STAGE:: Doing", "status::review") carries its scope in front; the stage is what follows.
const SCOPE = /^\s*[A-Za-z][\w -]*::\s*/;

/** The text of a stage without the scope of a scoped label: "STAGE:: Doing" becomes "Doing". */
export function stageText(text: string | null | undefined): string {
  return (text ?? '').replace(SCOPE, '').trim();
}

/** The stage of a card from the text its source reports (a label, a status, a stage name), by the `match` patterns of each stage. */
export function stageOfText(cfg: StageConfig, text: string | null | undefined): StageDef | null {
  const raw = text ?? '';
  return matchStage(cfg.stages, raw) ?? matchStage(cfg.stages, stageText(raw));
}

/**
 * The stage a provider's report maps to. The mapping rules of the cycle come first (first match wins, in the order written), restricted to the
 * provider kind when one is given; whatever they leave out is matched by the stages' own `match` patterns on each piece of text the provider
 * offered (the free text, then the status, the board fields, the column, the labels, the state).
 */
export function resolveStage(cfg: StageConfig, input: StageInput): StageDef | null {
  const byId = new Map(cfg.stages.map((s) => [s.id, s]));
  const values = (source: string, name: string): string[] => {
    switch (source) {
      case 'label':
        return input.labels ?? [];
      case 'status':
        return input.status ? [input.status] : [];
      case 'state':
        return input.state ? [input.state] : [];
      case 'column':
        return input.column ? [input.column] : [];
      case 'field': {
        const found = Object.entries(input.fields ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase());
        return found?.[1] ? [found[1]] : [];
      }
      default:
        return [];
    }
  };
  for (const rule of cfg.stageMapping ?? []) {
    if (rule.provider !== 'any' && input.provider && rule.provider !== input.provider) continue;
    const re = regex(rule.pattern);
    const stage = byId.get(rule.stage);
    if (!re || !stage) continue;
    if (values(rule.source, rule.name).some((v) => re.test(v))) return stage;
  }
  const texts = [input.text, input.status, ...Object.values(input.fields ?? {}), input.column, ...(input.labels ?? []), input.state].filter((x): x is string => !!x);
  // The stage nearest to done wins when several labels match (an issue labelled for two stages is in the later one).
  const hits = texts.map((t) => stageOfText(cfg, t)).filter((s): s is StageDef => !!s);
  return hits.sort((a, b) => b.rank - a.rank)[0] ?? null;
}

export function stageKind(cfg: StageConfig, text: string | null | undefined): StageKind | null {
  return stageOfText(cfg, text)?.kind ?? null;
}

export function isStageKind(cfg: StageConfig, text: string | null | undefined, kinds: readonly StageKind[]): boolean {
  const kind = stageKind(cfg, text);
  return !!kind && kinds.includes(kind);
}

/**
 * A card that came back from QA: a "returned" stage at or past the first QA stage. A "returned" stage before the QA stages (a review that
 * rejected the change) came back from review instead. A cycle with no QA stage counts every "returned" stage.
 */
export function returnedFromQa(cfg: StageConfig, text: string | null | undefined): boolean {
  const stage = stageOfText(cfg, text);
  if (!stage || stage.kind !== 'returned') return false;
  const qa = cfg.stages.filter((s) => s.kind === 'qa').map((s) => s.rank);
  return qa.length === 0 || stage.rank >= Math.min(...qa);
}

/** Display text of a card's stage: the label's scope is dropped, and a card with no stage says so through `fallback`. */
export function stageDisplay(text: string | null | undefined, fallback: string): string {
  return stageText(text) || fallback;
}

type MeaningConfig = StageConfig & { meanings: Pick<DevCycleConfig['meanings'], 'blocker' | 'readyForQa'> };

/**
 * A card ready for the QA hand-off: its stage is of one of the kinds the cycle calls ready for QA (and, when the cycle says so, it has a spec).
 * The "returned" kind counts only when the card came back from QA, not from a review.
 */
export function isReadyForQa(cfg: MeaningConfig, text: string | null | undefined, hasSpec: boolean): boolean {
  const m = cfg.meanings.readyForQa;
  if (m.requiresSpec && !hasSpec) return false;
  const stage = stageOfText(cfg, text);
  if (!stage) return false;
  return m.stageKinds.some((kind) => (kind === 'returned' ? returnedFromQa(cfg, text) : kind === stage.kind));
}

/** A card whose stage is of a kind the cycle counts as blocked, whatever the provider reports. */
export function isBlockedStage(cfg: MeaningConfig, text: string | null | undefined): boolean {
  const kind = stageKind(cfg, text);
  return !!kind && cfg.meanings.blocker.stageKinds.includes(kind);
}

/** Lower is more urgent. Blocked first, then back from QA, then close to QA (review approved, in QA), then the rest. */
export function stageUrgency(cfg: StageConfig, text: string | null | undefined): 2 | 3 | 4 {
  if (returnedFromQa(cfg, text)) return 2;
  if (isStageKind(cfg, text, ['reviewApproved', 'qa'])) return 3;
  return 4;
}
