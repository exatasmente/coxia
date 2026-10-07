import type { Language } from '../config/types';
import { createTranslator, t } from '../i18n';
import type { Scenario } from './types';

// The test plan a QA stage writes, kept true to the run's record. The agent owns the document (its other sections stay as it wrote them), but the
// result of each scenario is what the run recorded: a claim the app did not back reads as read, and a scenario the agent gave up on reads as not run.
// The text is a pure function of the recorded scenarios, so the document, the run's record and the tracker comment never disagree.

/** The word a scenario result is written with, in the workspace's language. */
export const resultWordOf = (result: Scenario['result'], language: Language = 'pt-BR'): string => createTranslator(language)(`main.runner.scenario.result.${result}`);

/** The word a scenario's backing is written with: the agent ran it in a sandbox, or only read. */
export const backingWordOf = (evidence: Scenario['evidence'], language: Language = 'pt-BR'): string => createTranslator(language)(`main.runner.scenario.backing.${evidence ?? 'read'}`);

/** One scenario as a line of the test plan: the result the run recorded, how it was checked, and the agent's own detail. */
export function planLine(s: Scenario, language: Language = 'pt-BR'): string {
  const parts = [`${s.name}: ${resultWordOf(s.result, language)} (${backingWordOf(s.evidence, language)})`];
  if (s.detail.trim()) parts.push(s.detail.trim());
  if (s.unbacked) parts.push(t('main.runner.scenario.unbackedNote'));
  return `- ${parts.join(' — ')}`;
}

const headingOf = (line: string): string | null => {
  const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line.trim());
  return m ? m[2].toLowerCase() : null;
};

const isList = (line: string): boolean => /^\s*[-*]\s/.test(line);

/** Whether a line is one of the scenario lines the app wrote, so a run's own text is not left saying something else. */
const isScenarioLine = (line: string): boolean => isList(line) && /:\s*\S.*\([^)]*\)/.test(line) && /:[^:]*[:(].*(?:executed|read|rodado|lido|executado)/i.test(line);

/** The span of a section (from its heading up to the next heading of the same or a higher level). */
function sectionAt(lines: string[], heads: (string | null)[], at: number): { start: number; end: number } {
  const level = /^(#{1,6})/.exec(lines[at].trim())![1].length;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+\S/.exec(lines[i].trim());
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return { start: at, end };
}

/**
 * The test plan with its results taken from the run's record. The app writes its results as their own section at the end; a section with that heading
 * (in the workspace's language) is replaced, and the agent's own scenario lines are kept out, so one scenario is written once and only from the record.
 */
export function testPlanWithResults(content: string, scenarios: readonly Scenario[], language: Language = 'pt-BR'): string {
  if (!scenarios.length) return content;
  const titles = new Set([createTranslator(language)('main.runner.scenario.resultsTitle').toLowerCase()]);
  const lines = content.split('\n');
  const heads = lines.map((l) => headingOf(l));
  const at = heads.findIndex((h) => h !== null && titles.has(h));
  const cut = at < 0 ? { start: lines.length, end: lines.length } : sectionAt(lines, heads, at);
  const body = [...lines.slice(0, cut.start), ...lines.slice(cut.end)]
    .filter((l) => !isScenarioLine(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  return `${body}\n\n## ${t('main.runner.scenario.resultsTitle')}\n\n${scenarios.map((s) => planLine(s, language)).join('\n')}\n`;
}
