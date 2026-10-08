export const BUDGET_MAX = 24_000;
export const BUDGET_MIN = 3_000;

export function budgetFor(contextWindow: number | null | undefined): number {
  if (!contextWindow || contextWindow <= 0) return BUDGET_MAX;
  return Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, Math.round(3 * contextWindow * 0.15)));
}

export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max));
  const line = cut.lastIndexOf('\n');
  return (line > max * 0.6 ? cut.slice(0, line) : cut).trimEnd();
}
