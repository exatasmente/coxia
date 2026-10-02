import type { StageDef } from './types';

const compiled = new WeakMap<StageDef, RegExp[]>();

function patterns(stage: StageDef): RegExp[] {
  let list = compiled.get(stage);
  if (!list) {
    list = stage.match.map((m) => new RegExp(m, 'i'));
    compiled.set(stage, list);
  }
  return list;
}

/** The first stage (the list is in matching priority) whose pattern matches the card stage or issue status. */
export function matchStage(stages: StageDef[], text: string | null | undefined): StageDef | null {
  const s = text ?? '';
  return stages.find((st) => patterns(st).some((re) => re.test(s))) ?? null;
}

/** How far along the flow the stage is (0 when unknown). */
export function stageRank(stages: StageDef[], text: string | null | undefined): number {
  return matchStage(stages, text)?.rank ?? 0;
}
