import { readFileSync as readFile, writeFileSync as writeFile } from 'node:fs';
import { basename } from 'node:path';
import { checkMarks, EVIDENCE_MAX_BYTES, isEvidenceId, MARK_MAX_WIDTH, type EvidenceRecord } from '../../shared/evidence';
import { t } from '../../shared/i18n';
import type { Run } from '../../shared/runs';
import { imageMediaType } from '../imageType';
import { drawMarks } from './draw';
import { resolveOutputPath, type OutputProblem } from './paths';
import { decodePng, encodePng } from './png';
import { isImageRecord, putEvidence, readEvidence, type PutProblem } from './store';
import type { EvidenceTools, ToolAnswer } from './tool';

// What the three evidence tools do when a model calls them: read the file from the stage's output folder, keep it, mark an image and look at the result. Every
// refusal is worded here, as text the model can act on; nothing but the stage's output folder and the run's own evidence is ever read.

export interface EvidenceContext {
  /** The workspace's data folder: where a run's evidence lives. */
  dataDir: string;
  /** The folder the stage made; `out` inside it is where the model writes. */
  stageDir: string;
  run: Run;
  stage: string;
  by: string;
  /** Called when a piece of evidence is kept: the caller records it in the run and publishes it in the conversation. */
  onKept(record: EvidenceRecord): void | Promise<void>;
  now(): string;
}

const KIND_TEXT: Record<EvidenceRecord['kind'], string> = { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', pdf: 'PDF', text: 'text' };

const outputProblemText = (p: OutputProblem): string =>
  t(
    p === 'path'
      ? 'main.evidence.refused.path'
      : p === 'traversal'
        ? 'main.evidence.refused.traversal'
        : p === 'outside'
          ? 'main.evidence.refused.outside'
          : p === 'link'
            ? 'main.evidence.refused.link'
            : p === 'missing'
              ? 'main.evidence.refused.missing'
              : 'main.evidence.refused.notFile',
  );

const kindProblemText = (p: PutProblem): string =>
  t(
    p === 'too-long'
      ? 'main.evidence.refused.tooLong'
      : p === 'empty'
        ? 'main.evidence.refused.empty'
        : p === 'video'
          ? 'main.evidence.refused.video'
          : p === 'audio'
            ? 'main.evidence.refused.audio'
            : p === 'archive'
              ? 'main.evidence.refused.archive'
              : p === 'executable'
                ? 'main.evidence.refused.executable'
                : 'main.evidence.refused.unknown',
    { max: Math.round(EVIDENCE_MAX_BYTES / (1024 * 1024)) },
  );

/** Keeps a file of the output folder as evidence. */
async function save(ctx: EvidenceContext, input: unknown): Promise<ToolAnswer> {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const raw = typeof args.path === 'string' ? args.path : '';
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) return { text: t('main.evidence.refused.title') };
  const resolved = resolveOutputPath(ctx.stageDir, raw);
  if (!resolved.ok || !resolved.path) return { text: outputProblemText(resolved.problem ?? 'path') };
  const put = putEvidence(ctx.dataDir, ctx.run, {
    path: resolved.path,
    name: basename(resolved.path),
    title,
    description: typeof args.description === 'string' ? args.description : '',
    stage: ctx.stage,
    by: ctx.by,
    at: ctx.now(),
  });
  if (!put.ok) return { text: kindProblemText(put.problem as PutProblem) };
  await ctx.onKept(put.record);
  return { text: t('main.evidence.kept', { id: put.record.id, title: put.record.title, kind: KIND_TEXT[put.record.kind] }) };
}

/** The bytes of the source of a mark or a look: an evidence image of this stage, or an image path in the output folder. */
function sourceOf(ctx: EvidenceContext, source: string): { ok: true; bytes: Uint8Array; from: string | null } | { ok: false; text: string } {
  if (isEvidenceId(source)) {
    const record = ctx.run.evidence?.[source];
    if (!record || record.stage !== ctx.stage) return { ok: false, text: t('main.evidence.refused.otherStage', { id: source }) };
    if (!isImageRecord(record)) return { ok: false, text: t('main.evidence.refused.notImage', { id: source }) };
    const bytes = readEvidence(ctx.dataDir, ctx.run.id, record);
    if (!bytes) return { ok: false, text: t('main.evidence.refused.gone', { id: source }) };
    return { ok: true, bytes, from: source };
  }
  const resolved = resolveOutputPath(ctx.stageDir, source);
  if (!resolved.ok || !resolved.path) return { ok: false, text: outputProblemText(resolved.problem ?? 'path') };
  try {
    return { ok: true, bytes: new Uint8Array(readFile(resolved.path)), from: null };
  } catch {
    return { ok: false, text: t('main.evidence.refused.missing') };
  }
}

/** Marks an image and keeps the result as a new piece of evidence, linked to the one it came from. */
async function annotate(ctx: EvidenceContext, input: unknown): Promise<ToolAnswer> {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const source = typeof args.source === 'string' ? args.source.trim() : '';
  if (!source) return { text: t('main.evidence.refused.source') };
  const found = sourceOf(ctx, source);
  if (!found.ok) return { text: found.text };
  const decoded = decodePng(found.bytes);
  if (!decoded.ok) return { text: t('main.evidence.refused.decode', { problem: decoded.problem }) };
  const checked = checkMarks(args.marks, decoded.image.width, decoded.image.height);
  if (checked.problem) return { text: t('main.evidence.refused.mark', { index: checked.problem.index + 1, problem: checked.problem.problem, max: MARK_MAX_WIDTH }) };
  if (!checked.marks.length) return { text: t('main.evidence.refused.noMarks') };
  const png = encodePng(drawMarks(decoded.image, checked.marks));
  // The result is written into the stage's output folder (under a name the app makes), then kept like any other file: the original is never touched.
  const name = `annotated-${Date.now()}.png`;
  const resolved = resolveOutputPath(ctx.stageDir, name);
  // The name is new, so the resolver refuses it: the file is written directly under the folder, through the same guard the store uses on the way in.
  if (resolved.ok || resolved.problem !== 'missing') return { text: outputProblemText(resolved.problem ?? 'path') };
  const target = `${ctx.stageDir}/out/${name}`;
  try {
    writeFile(target, png);
  } catch {
    return { text: t('main.evidence.refused.write') };
  }
  const put = putEvidence(ctx.dataDir, ctx.run, {
    path: target,
    name: `${source.replace(/^ev-/, 'marked-')}.png`,
    title: typeof args.title === 'string' && args.title.trim() ? args.title.trim() : t('main.evidence.markedTitle', { source }),
    description: typeof args.description === 'string' ? args.description : '',
    stage: ctx.stage,
    by: ctx.by,
    from: found.from,
    at: ctx.now(),
  });
  if (!put.ok) return { text: kindProblemText(put.problem as PutProblem) };
  await ctx.onKept(put.record);
  return { text: t('main.evidence.marked', { id: put.record.id, from: found.from ?? source, count: checked.marks.length }) };
}

/** Looks at an image: an evidence image of this stage, or an image of the output folder. */
async function view(ctx: EvidenceContext, input: unknown): Promise<ToolAnswer> {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const source = typeof args.source === 'string' ? args.source.trim() : '';
  if (!source) return { text: t('main.evidence.refused.source') };
  const found = sourceOf(ctx, source);
  if (!found.ok) return { text: found.text };
  // The media type comes from the bytes: a path in the output folder can hold anything, and a GIF or a WebP told as JPEG is refused by the provider.
  const media = imageMediaType(Buffer.from(found.bytes.subarray(0, 12)));
  if (!media) return { text: t('main.evidence.refused.notPicture') };
  // A file of the output folder is reported back: the stage looked at it and did not keep it, and the app has to say so (or keep it) before the sandbox goes.
  const looked = found.from ? undefined : resolveOutputPath(ctx.stageDir, source);
  return { text: t('main.evidence.looking', { source }), image: { data: found.bytes, media, ...(looked?.ok && looked.path ? { looked: looked.path } : {}) } };
}

export function evidenceToolsOf(ctx: EvidenceContext): EvidenceTools {
  return {
    save: (input) => save(ctx, input),
    annotate: (input) => annotate(ctx, input),
    view: (input) => view(ctx, input),
  };
}
