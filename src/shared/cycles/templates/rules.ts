import type { StageMappingRule, StageSource, VcsKind } from '../../config/types';

/** Mapping rules of one provider and source, from [pattern, stage id] pairs. */
export function rules(provider: VcsKind | 'any', source: StageSource, name: string, pairs: [string, string][]): StageMappingRule[] {
  return pairs.map(([pattern, stage]) => ({ provider, source, name, pattern, stage }));
}
