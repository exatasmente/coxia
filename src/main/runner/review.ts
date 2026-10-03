import type { VcsKind } from '../../shared/config/types';
import type { Language } from '../../shared/config/types';
import { createTranslator } from '../../shared/i18n';
import { type Finding, sameFinding, whereOf } from '../../shared/runs';
import { covers, indexPatch } from '../vcs/diffLines';
import type { ReviewComment } from '../vcs/types';

// The comparison of two findings is shared with the run screens, which show a finding's thread from it; it is exported from here as it always was.
export { sameFinding };

// What the reviewer found, turned into what a review on the pull request is made of. Pure: the diff of the pull request comes in, and so does the host's kind
// (a suggestion is written differently on each one). Nothing here reads or writes the code host.

/** Where a finding stands on the pull request's diff. */
export interface Placed {
  /** The place in the round's list of findings: what the hidden marker of its comment says. */
  index: number;
  finding: Finding;
  /** line: on the line (or range) it names. file: on its file (it is about the file, or its line is not in the diff). general: its file is not in the diff at all. */
  where: 'line' | 'file' | 'general';
  /** The comment stands exactly where the finding says (a line or a range that is in the diff, on its side): only then may it carry a suggestion block. */
  anchored: boolean;
  /** The line a comment on a line stands on (the last line of a range), as numbered in the side's file; null for the others. */
  line: number | null;
  startLine: number | null;
}

/**
 * Places each finding on the diff of the pull request as it is now: a finding whose line is in the diff is a comment on that line (or range), one whose
 * line is not (or is about the file) is a comment on the file, one whose file is not in the diff goes into the general comment. Never a wrong line.
 */
export function placeFindings(findings: Finding[], changes: { path: string; diff: string }[]): Placed[] {
  return findings.map((finding, index) => {
    const change = changes.find((c) => c.path === finding.path);
    const base = { index, finding, anchored: false, line: null, startLine: null };
    if (!change) return { ...base, where: 'general' as const };
    if (finding.line === null) return { ...base, where: 'file' as const };
    const to = finding.endLine ?? finding.line;
    const index_ = indexPatch(change.diff);
    if (!covers(index_, finding.side, finding.line, to)) return { ...base, where: 'file' as const };
    return { ...base, where: 'line' as const, anchored: true, line: to, startLine: finding.endLine !== null ? finding.line : null };
  });
}

const fenceOf = (code: string): string => '`'.repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map((r) => r.length + 1)));

/**
 * The replacement a finding proposes, as the host reads it. GitHub and GitLab have a suggestion block the author applies with one click, and it replaces
 * exactly the lines the comment covers, so it is used only when the comment stands exactly where the finding says and on the new side; GitLab's block says
 * how many lines above the commented one it replaces (the range). Anywhere else, and on Bitbucket, the replacement is described in a plain code block.
 */
export function replacementBlock(kind: VcsKind, p: Placed, language: Language): string {
  const code = p.finding.suggestion;
  if (!code?.trim()) return '';
  const fence = fenceOf(code);
  const exact = p.where === 'line' && p.anchored && p.finding.side === 'new' && kind !== 'bitbucket';
  if (exact) {
    const above = p.startLine !== null && p.line !== null ? p.line - p.startLine : 0;
    const tag = kind === 'gitlab' ? `suggestion:-${above}+0` : 'suggestion';
    return `${fence}${tag}\n${code}\n${fence}`;
  }
  return `${createTranslator(language)('main.runner.review.replacement')}\n\n${fence}\n${code}\n${fence}`;
}

/** The text of one comment of the review: whether it blocks, what is wrong, where it was meant to be when it could not stand there, and the replacement. */
export function commentText(kind: VcsKind, p: Placed, language: Language): string {
  const tr = createTranslator(language);
  const f = p.finding;
  const parts = [tr(f.severity === 'blocking' ? 'main.runner.review.blocking' : 'main.runner.review.suggestion'), f.body];
  const head = parts.join(' ');
  // A comment that had to move to the file says where the finding was about.
  const outside = p.where === 'file' && f.line !== null ? `\n\n${tr('main.runner.review.outside', { where: whereOf(f) })}` : '';
  const block = replacementBlock(kind, p, language);
  return `${head}${outside}${block ? `\n\n${block}` : ''}`;
}

/** The comments of the review for the findings placed on lines and files (the general ones go in the review's own text). */
export function reviewComments(placed: Placed[], bodies: Map<number, string>): ReviewComment[] {
  return placed.flatMap((p) => {
    if (p.where === 'general') return [];
    return [{ path: p.finding.path, line: p.where === 'line' ? p.line : null, startLine: p.where === 'line' ? p.startLine : null, side: p.finding.side, body: bodies.get(p.index) ?? p.finding.body }];
  });
}

/** What goes into the general comment for the findings whose file is not in the diff any more: each with its place and what is wrong. */
export function generalFindings(placed: Placed[], language: Language): string {
  const tr = createTranslator(language);
  const list = placed.filter((p) => p.where === 'general');
  if (!list.length) return '';
  return [`### ${tr('main.runner.review.generalHeading')}`, ...list.map((p) => `- ${tr(p.finding.severity === 'blocking' ? 'main.runner.review.blocking' : 'main.runner.review.suggestion')} \`${whereOf(p.finding)}\`: ${p.finding.body}`)].join('\n\n').replace(/\n\n- /g, '\n- ');
}

/** Puts `extra` into a rendered comment after its sections: before the technical detail when there is one, else before the hidden marker. */
export function withTail(body: string, extra: string): string {
  if (!extra.trim()) return body;
  const at = body.indexOf('<details>');
  const cut = at >= 0 ? at : body.lastIndexOf('<!--');
  const stop = cut >= 0 ? cut : body.length;
  return `${body.slice(0, stop).trimEnd()}\n\n${extra.trim()}\n\n${body.slice(stop)}`;
}
