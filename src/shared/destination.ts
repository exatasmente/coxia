import type { Card, DecisionTarget } from './types';

export function destination(card: Card, target: DecisionTarget): string {
  if (target === 'spec' && card.spec) return `${card.spec.planFile ?? card.spec.folder} › Registro`;
  if (target === 'daily-report') return `daily-report note ${card.ref}`;
  return 'ata da cerimônia';
}
