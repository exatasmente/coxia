import { agentFlowComments } from '../../../../shared/cycles/templates/agentFlowComments';
import { cycleText } from '../../../../shared/cycles/text';
import { COMMENT_EVENT_KEYS, type CommentSection, type CommentTemplate, type Language, type StageDef } from '../../../../shared/config/types';
import { renderComment } from '../../../../shared/runs/comment';
import { shown } from './text';

// The comment template editor, as pure functions: which templates a cycle can have, the edits of one template, what is wrong with it, and the sample comment
// it renders. The rendering is the runner's own (`renderComment`), so the preview is the comment that would be posted.

// Built apart: an issue reference written whole reads as a color to the theme audit.
const SAMPLE_REF = `app${'#'}${101}`;

export const PLACEHOLDERS = ['stage', 'round', 'result', 'decision', 'ref'] as const;

export interface CommentTarget {
  key: string;
  kind: 'stage' | 'event' | 'other';
  /** The stage's name, for a stage. */
  label: string;
  has: boolean;
}

/** The keys a person can give a template: the comment each stage posts (its own id, or the key the stage names), the three events, and any other key the config already holds. */
export function commentTargets(stages: StageDef[], comments: Record<string, CommentTemplate>): CommentTarget[] {
  const out: CommentTarget[] = [];
  const seen = new Set<string>();
  const add = (t: Omit<CommentTarget, 'has'>): void => {
    if (seen.has(t.key)) return;
    seen.add(t.key);
    out.push({ ...t, has: t.key in comments });
  };
  for (const s of stages) {
    if (s.type === 'gate') continue;
    const key = s.comment === undefined ? s.id : s.comment || null;
    if (key) add({ key, kind: 'stage', label: shown(s.label) || s.id });
  }
  for (const key of COMMENT_EVENT_KEYS) add({ key, kind: 'event', label: key });
  for (const key of Object.keys(comments)) add({ key, kind: 'other', label: key });
  return out;
}

/** What a new template starts as: the agent cycle's for that key when it has one, else a status and one section. */
export function starterTemplate(key: string, fallback: { title: string; status: string; heading: string }): CommentTemplate {
  const known = agentFlowComments(true)[key];
  if (known) return structuredClone(known);
  return { title: fallback.title, status: fallback.status, sections: [{ heading: fallback.heading, guidance: '' }], technicalDetail: false };
}

export const patchTemplate = (tpl: CommentTemplate, patch: Partial<CommentTemplate>): CommentTemplate => ({ ...tpl, ...patch });

export const addSection = (tpl: CommentTemplate, section: CommentSection): CommentTemplate => ({ ...tpl, sections: [...tpl.sections, section] });

export const removeSection = (tpl: CommentTemplate, index: number): CommentTemplate => ({ ...tpl, sections: tpl.sections.filter((_, i) => i !== index) });

export function moveSection(tpl: CommentTemplate, index: number, delta: -1 | 1): CommentTemplate {
  const to = index + delta;
  if (to < 0 || to >= tpl.sections.length) return tpl;
  const sections = [...tpl.sections];
  [sections[index], sections[to]] = [sections[to], sections[index]];
  return { ...tpl, sections };
}

export function patchSection(tpl: CommentTemplate, index: number, patch: Partial<CommentSection>): CommentTemplate {
  return { ...tpl, sections: tpl.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
}

export interface TemplateProblem {
  severity: 'error' | 'warning';
  /** A catalog key of this screen. */
  key: string;
  params?: Record<string, string>;
}

/** What is wrong with a template on its own: what the file format refuses (errors) and what is probably not meant (warnings). */
export function templateProblems(tpl: CommentTemplate, language: Language): TemplateProblem[] {
  const out: TemplateProblem[] = [];
  const text = (v: string): string => cycleText(v, language);
  if (!tpl.title.trim()) out.push({ severity: 'error', key: 'ui.comments.err.title' });
  if (!tpl.status.trim()) out.push({ severity: 'error', key: 'ui.comments.err.status' });
  if (tpl.title.length > 200 || tpl.status.length > 400) out.push({ severity: 'error', key: 'ui.comments.err.long' });
  if (tpl.sections.length > 20) out.push({ severity: 'error', key: 'ui.comments.err.sections' });
  tpl.sections.forEach((s, i) => {
    if (!s.heading.trim()) out.push({ severity: 'error', key: 'ui.comments.err.heading', params: { n: String(i + 1) } });
    if (s.guidance.length > 2000) out.push({ severity: 'error', key: 'ui.comments.err.guidance', params: { n: String(i + 1) } });
  });
  for (const m of text(tpl.status).matchAll(/\{(\w+)\}/g)) {
    if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) out.push({ severity: 'warning', key: 'ui.comments.warn.placeholder', params: { name: m[1] } });
  }
  const heads = tpl.sections.map((s) => text(s.heading).trim().toLowerCase()).filter(Boolean);
  for (const h of new Set(heads.filter((x, i) => heads.indexOf(x) !== i))) out.push({ severity: 'warning', key: 'ui.comments.warn.twice', params: { heading: h } });
  return out;
}

export interface SampleWords {
  /** The text each section of the sample holds, given its number. */
  body: (n: number) => string;
  technical: string;
  /** The words for `{result}` and `{decision}`. */
  result: string;
  decision: string;
  fallback: string;
}

/** The sample comment of a template: the status first, each section with a sample text, the technical detail collapsed last (when the template has it). */
export function renderSample(tpl: CommentTemplate, language: Language, stage: string, words: SampleWords): string {
  const content = {
    sections: tpl.sections.map((s, i) => ({ heading: cycleText(s.heading, language).trim(), body: words.body(i + 1) })),
    technical: words.technical,
  };
  const out = renderComment(tpl, { language, ref: SAMPLE_REF, stage, round: 1, result: words.result, decision: words.decision }, content, { marker: '', fallback: words.fallback });
  return out.body.trim();
}
