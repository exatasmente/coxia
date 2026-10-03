import { catalogText } from '../cycles/text';
import type { StageDef } from './types';
import { LANGUAGES } from './types';

const compiled = new WeakMap<StageDef, RegExp[]>();

function patterns(stage: StageDef): RegExp[] {
  let list = compiled.get(stage);
  if (!list) {
    list = stage.match.map((m) => new RegExp(m, 'i'));
    compiled.set(stage, list);
  }
  return list;
}

// A stage whose label is a catalog key is also known by its name in each language: a card carries the name it was shown with, in the language of that moment.
function named(stage: StageDef, text: string): boolean {
  if (!text || !stage.label) return false;
  const lower = text.toLowerCase();
  return stage.label === text ? catalogText(stage.label, 'pt-BR') !== undefined : LANGUAGES.some((l) => catalogText(stage.label, l)?.toLowerCase() === lower);
}

/** The first stage (the list is in matching priority) whose pattern matches the card stage or issue status, or whose name (in any language) is that text. */
export function matchStage(stages: StageDef[], text: string | null | undefined): StageDef | null {
  const s = text ?? '';
  return stages.find((st) => patterns(st).some((re) => re.test(s)) || named(st, s)) ?? null;
}

/** How far along the flow the stage is (0 when unknown). */
export function stageRank(stages: StageDef[], text: string | null | undefined): number {
  return matchStage(stages, text)?.rank ?? 0;
}
