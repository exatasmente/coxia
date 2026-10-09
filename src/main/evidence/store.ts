import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants, openSync, closeSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_EXT, EVIDENCE_KIND_MEDIA, isEvidenceImage, uploadNameOf, type EvidenceKind, type EvidenceRecord, type EvidenceUpload } from '../../shared/evidence';
import type { Run } from '../../shared/runs';
import { checkPath } from '../engine/guard';
import { detectKind, type KindProblem } from './type';

// The evidence of a run on disk: `<workspace data>/evidence/<runId>/<id>.<ext>`. The file is written once, atomically, and never rewritten; the record of what it is
// lives with the run (`Run.evidence`), and the copy that goes into the cycle folder is made by the app from the stored file, never by re-reading the stage's output.

export const EVIDENCE_DIR = 'evidence';

/** The most of the file read to tell its kind: the head is enough for every signature the app knows. */
const HEAD_MAX = 64 * 1024;

export interface Stored {
  record: EvidenceRecord;
  bytes: Uint8Array;
}

/** Why a file was not kept: the content is not an accepted kind, or the app could not write it. */
export type PutProblem = KindProblem | 'write';

const dirOf = (dataDir: string, runId: string): string => join(dataDir, EVIDENCE_DIR, runId);

/** The next id of a run: the highest it has used, plus one. The run keeps the count, so an id is never reused across attempts. */
export function nextEvidenceId(run: Pick<Run, 'evidence'>): string {
  const used = Object.keys(run.evidence ?? {})
    .map((id) => Number(id.replace(/^ev-/, '')))
    .filter((n) => Number.isFinite(n));
  const next = used.length ? Math.max(...used) + 1 : 1;
  return `ev-${next}`;
}

/**
 * The id as it is, or the next free one when a file of the run already has it in any kind. The numbering above follows the record the caller holds, which can be older
 * than the folder (a stage numbers from the run as it started); a stored file is never written over.
 */
export function freeEvidenceId(dir: string, id: string): string {
  let n = Number(id.replace(/^ev-/, ''));
  while (Object.values(EVIDENCE_EXT).some((ext) => existsSync(join(dir, `ev-${n}.${ext}`)))) n++;
  return `ev-${n}`;
}

/** Reads the head of a file without following a link, at most `HEAD_MAX` bytes. */
function readHead(path: string, size: number): Uint8Array {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const len = Math.min(size, HEAD_MAX);
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = readSync(fd, buf, got, len - got, got);
      if (n <= 0) break;
      got += n;
    }
    return new Uint8Array(buf.subarray(0, got));
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes the bytes of a new piece of a run as its next free id, atomically: a temporary name in the same folder, then a rename, so a crash never leaves a half file as
 * evidence, and a stored file is never written over. Returns the id, or null when the file could not be written.
 */
export function placeEvidence(dataDir: string, run: Pick<Run, 'id' | 'evidence'>, kind: EvidenceKind, bytes: Uint8Array): string | null {
  const dir = dirOf(dataDir, run.id);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = freeEvidenceId(dir, nextEvidenceId(run));
    const dest = join(dir, `${id}.${EVIDENCE_EXT[kind]}`);
    const tmp = `${dest}.tmp-${process.pid}`;
    writeFileSync(tmp, bytes, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, dest);
    return id;
  } catch {
    return null;
  }
}

/**
 * Reads a file of the stage's output folder and keeps it as evidence of the run. The kind is decided by the content; the bytes are copied once into the
 * workspace's own data and never read from the output folder again. Returns the problem instead of throwing so the tool can word it for the model.
 */
export function putEvidence(dataDir: string, run: Run, input: { path: string; name: string; title: string; description: string; stage: string; by: string; from?: string | null; at: string }): { ok: true; record: EvidenceRecord } | { ok: false; problem: PutProblem } {
  let size: number;
  try {
    size = statSync(input.path).size;
  } catch {
    return { ok: false, problem: 'unknown' };
  }
  const head = readHead(input.path, size);
  const kind = detectKind(head, size);
  if (!kind.kind) return { ok: false, problem: kind.problem ?? 'unknown' };
  let bytes: Buffer;
  try {
    bytes = readFileSync(input.path);
  } catch {
    return { ok: false, problem: 'write' };
  }
  const id = placeEvidence(dataDir, run, kind.kind, bytes);
  if (!id) return { ok: false, problem: 'write' };
  const record: EvidenceRecord = {
    id,
    stage: input.stage,
    by: input.by,
    title: input.title.trim().slice(0, 200) || input.name.slice(0, 200),
    description: input.description.trim().slice(0, 1000),
    name: input.name.slice(0, 200),
    kind: kind.kind,
    bytes: size,
    at: input.at,
    from: input.from ?? null,
    message: null,
  };
  return { ok: true, record };
}

/** The path of a stored piece of evidence; null when it is not there (a run removed, a file lost). */
export function evidencePath(dataDir: string, runId: string, record: Pick<EvidenceRecord, 'id' | 'kind'>): string | null {
  const path = join(dirOf(dataDir, runId), `${record.id}.${EVIDENCE_EXT[record.kind]}`);
  return existsSync(path) ? path : null;
}

/** Reads the bytes of a stored piece of evidence, or null when the file is gone. */
export function readEvidence(dataDir: string, runId: string, record: Pick<EvidenceRecord, 'id' | 'kind'>): Uint8Array | null {
  const path = evidencePath(dataDir, runId, record);
  if (!path) return null;
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
}

/** Removes one piece of evidence (the person's action, never an agent's). */
export function dropEvidence(dataDir: string, runId: string, record: Pick<EvidenceRecord, 'id' | 'kind'>): boolean {
  const path = evidencePath(dataDir, runId, record);
  if (!path) return false;
  try {
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Removes everything a run kept: what happens when the run is removed. A copy that already went into a published commit is not touched. */
export function dropRunEvidence(dataDir: string, runId: string): void {
  rmSync(dirOf(dataDir, runId), { recursive: true, force: true });
}

/**
 * Copies one piece of evidence into the cycle folder of the run (`<worktree>/<cycleFolder>/evidence/<id>.<ext>`), where the stage's commit takes it. The path
 * goes through the same guard the stage's documents do, so a name cannot lead anywhere else; the file is only ever copied from the stored evidence.
 */
export function copyToCycleFolder(run: Run, record: Pick<EvidenceRecord, 'id' | 'kind'>, dataDir: string): boolean {
  const source = evidencePath(dataDir, run.id, record);
  if (!source) return false;
  const folder = `${run.cycleFolder}/evidence`;
  mkdirSync(join(run.worktree, folder), { recursive: true });
  const check = checkPath(run.worktree, join(folder, `${record.id}.${EVIDENCE_EXT[record.kind]}`));
  if (!check.ok) return false;
  copyFileSync(source, check.path);
  return true;
}

/** Whether a record is of an image, the only ones the marking tool draws on. */
export const isImageRecord = (record: Pick<EvidenceRecord, 'kind'>): boolean => isEvidenceImage(record.kind as EvidenceKind);

/** The evidence a run kept, ready to be sent to the code host: what the agent cited, in the order it cited it, with the records it still has. */
export function uploadsOf(dataDir: string, run: Run, ids: readonly string[]): EvidenceUpload[] {
  const out: EvidenceUpload[] = [];
  for (const id of ids) {
    const record = run.evidence?.[id];
    // The app's own screen recording never goes up to the code host, whoever names it: it is a video, and what it shows is for the app.
    if (!record || record.recording) continue;
    const bytes = readEvidence(dataDir, run.id, record);
    if (!bytes) continue;
    const media = EVIDENCE_KIND_MEDIA[record.kind];
    out.push({ id: record.id, name: uploadNameOf({ id: record.id, media }), media, bytes, title: record.title });
  }
  return out;
}
