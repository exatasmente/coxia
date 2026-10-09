import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRunStore } from '../src/main/runs-core';
import { RunError, cancel, deleteEvidence, gateApprove, parseRun, recordEvidence, resumeAfterRestart, runVersionOf, stageDone, startRun } from '../src/shared/runs';
import type { EvidenceRecord } from '../src/shared/evidence';
import { agentFlowStages, at, startInput } from './helpers/runs';

let dir: string;
const flow = agentFlowStages();
const fresh = (over = {}) => startRun(startInput(over), flow, at(0)).run;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'coxia-runs-')), 'runs');
});

describe('the run store', () => {
  it('writes one JSON file per run, atomically, and reads it back', () => {
    const store = createRunStore(dir);
    const saved = store.create(fresh());
    expect(saved.rev).toBe(1);
    expect(readdirSync(dir)).toEqual(['r-abc123-x1y2.json']);
    expect(JSON.parse(readFileSync(join(dir, 'r-abc123-x1y2.json'), 'utf8'))).toMatchObject({ version: 1, id: 'r-abc123-x1y2', status: 'working', stage: 'refine' });
    expect(store.get('r-abc123-x1y2')).toEqual(saved);
    expect(store.get('r-zzzzzz-none')).toBeNull();
  });

  it('applies a move to what is on disk, saves it with the next rev and hands back the messages for the thread', () => {
    const store = createRunStore(dir);
    store.create(fresh());
    const tr = store.update('r-abc123-x1y2', (r) => stageDone(r, flow, { summary: 's', handoff: 'h', artifacts: ['1_SPEC.md'] }, at(1)));
    expect(tr.run).toMatchObject({ rev: 2, status: 'gate', stage: 'gate1', updatedAt: at(1) });
    expect(tr.messages.map((m) => m.kind)).toEqual(['post', 'handoff', 'system']);
    expect(store.get('r-abc123-x1y2')).toEqual(tr.run);
    expect(readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('keeps nothing of a move that throws', () => {
    const store = createRunStore(dir);
    const before = store.create(fresh());
    expect(() => store.update(before.id, (r) => gateApprove(r, flow, at(1)))).toThrow(expect.objectContaining({ code: 'wrong-state' }));
    expect(store.get(before.id)).toEqual(before);
    expect(() => store.update('r-nothing-here', (r) => ({ run: r, messages: [] }))).toThrow(expect.objectContaining({ code: 'unknown-run' }));
  });

  it('allows one run in progress per issue, and another once it has ended', () => {
    const store = createRunStore(dir);
    store.create(fresh());
    expect(() => store.create(fresh({ id: 'r-abc124-x1y3' }))).toThrow(expect.objectContaining({ code: 'duplicate' }));
    expect(() => store.create(fresh())).toThrow(expect.objectContaining({ code: 'duplicate' }));
    store.create(fresh({ id: 'r-abc125-x1y4', issue: { ref: 'app#102', iid: 102, title: 'Other', url: null } }));
    expect(store.activeFor('app#101')?.id).toBe('r-abc123-x1y2');
    store.update('r-abc123-x1y2', (r) => cancel(r, 'person', at(2)));
    expect(store.activeFor('app#101')).toBeNull();
    expect(store.create(fresh({ id: 'r-abc126-x1y5' })).id).toBe('r-abc126-x1y5');
    expect(store.list().map((r) => r.id).sort()).toEqual(['r-abc123-x1y2', 'r-abc125-x1y4', 'r-abc126-x1y5']);
  });

  it('lists the most recently changed first', () => {
    const store = createRunStore(dir);
    store.create(fresh({ id: 'r-aaaaaa-aa11' }));
    store.create(fresh({ id: 'r-bbbbbb-bb22', issue: { ref: '2', iid: 2, title: 'b', url: null } }));
    store.update('r-aaaaaa-aa11', (r) => stageDone(r, flow, { summary: 's', handoff: '', artifacts: [] }, at(5)));
    expect(store.list().map((r) => r.id)).toEqual(['r-aaaaaa-aa11', 'r-bbbbbb-bb22']);
  });

  it('never overwrites a run written by a newer app, and does not use it', () => {
    const store = createRunStore(dir);
    const run = store.create(fresh());
    const path = join(dir, `${run.id}.json`);
    const newer = JSON.stringify({ ...run, version: 4, somethingNew: true });
    writeFileSync(path, newer);
    expect(store.get(run.id)).toBeNull();
    expect(store.list()).toEqual([]);
    expect(store.unreadable()).toEqual([{ id: run.id, reason: 'newer', detail: expect.stringContaining('newer app') }]);
    expect(() => store.update(run.id, (r) => cancel(r, 'person', at(1)))).toThrow(expect.objectContaining({ code: 'newer-version' }));
    expect(readFileSync(path, 'utf8')).toBe(newer);
  });

  it('does not trust a file that does not match the schema, and reports it instead of failing the list', () => {
    const store = createRunStore(dir);
    const good = store.create(fresh());
    const bad = (name: string, edit: (r: Record<string, any>) => void) => {
      const r = JSON.parse(JSON.stringify(good));
      edit(r);
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(r));
    };
    bad('r-bad001-aa11', (r) => (r.status = 'sleeping'));
    bad('r-bad002-aa11', (r) => (r.cycleFolder = '../../elsewhere'));
    bad('r-bad003-aa11', (r) => (r.cycleFolder = '/etc'));
    bad('r-bad004-aa11', (r) => (r.comments = { 'Not An Id': { target: 'issue', noteId: null, url: null, bodyHash: null, status: 'draft', updatedAt: at(0) } }));
    bad('r-bad005-aa11', (r) => delete r.stages);
    writeFileSync(join(dir, 'r-bad006-aa11.json'), '{ not json');
    writeFileSync(join(dir, 'notes.json'), '{}');
    expect(store.list().map((r) => r.id)).toEqual([good.id]);
    expect(store.unreadable().map((u) => [u.id, u.reason])).toEqual(['r-bad001-aa11', 'r-bad002-aa11', 'r-bad003-aa11', 'r-bad004-aa11', 'r-bad005-aa11', 'r-bad006-aa11'].map((id) => [id, 'invalid']));
  });

  it('turns an id that is not one of ours away before it can become a path', () => {
    const store = createRunStore(dir);
    expect(store.get('../../etc/passwd')).toBeNull();
    expect(() => store.update('../x', (r) => ({ run: r, messages: [] }))).toThrow(RunError);
    expect(existsSync(join(dir, '..', '..', 'etc'))).toBe(false);
  });

  it('refuses to create a run that is not valid, and writes nothing', () => {
    const store = createRunStore(dir);
    expect(() => store.create({ ...fresh(), status: 'sleeping' } as never)).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('survives a restart: a new store over the same folder resumes the run at the stage it was in', () => {
    const first = createRunStore(dir);
    const run = first.create(fresh());
    const second = createRunStore(dir);
    expect(second.get(run.id)).toEqual(run);
    const tr = second.update(run.id, (r) => resumeAfterRestart(r, flow, at(10)));
    expect(tr.run).toMatchObject({ status: 'working', stage: 'refine', rev: 2 });
    expect(tr.run.stages[0].attempts).toBe(2);
  });

  it('starts a folder that does not exist yet', () => {
    mkdirSync(join(dir, '..'), { recursive: true });
    expect(createRunStore(dir).list()).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});

// The record of the app's own screen recording (#157): the marks and the removal by retention live on the evidence record, bounded like the rest of the file.
describe('the record of a screen recording', () => {
  const piece: EvidenceRecord = { id: 'ev-1', stage: 'qa', by: 'qa', title: 'Screen recording', description: '', name: 'screen-recording.webm', kind: 'webm', bytes: 100, at: at(2), from: null, message: null, recording: { durationMs: 9000, width: 1280, height: 800, truncated: 'size', marks: [{ fromMs: 1000, toMs: 3000 }] } };

  it('is kept by the store and read back as it was, also once retention marked it removed', () => {
    const store = createRunStore(dir);
    const run = store.create(fresh());
    store.update(run.id, (r) => recordEvidence(r, piece, at(2)));
    expect(store.get(run.id)?.evidence?.['ev-1']).toEqual(piece);
    store.update(run.id, (r) => recordEvidence(r, { ...piece, removed: 'retention' }, at(3)));
    expect(store.get(run.id)?.evidence?.['ev-1']).toEqual({ ...piece, removed: 'retention' });
  });

  it('is bounded: more marks than the cap, a removal reason that is not retention and a mark with no end are not believed', () => {
    const base = JSON.parse(JSON.stringify(fresh()));
    const withPiece = (edit: (p: Record<string, any>) => void) => {
      const p = JSON.parse(JSON.stringify(piece));
      edit(p);
      return parseRun({ ...base, evidence: { 'ev-1': p } });
    };
    expect(withPiece(() => undefined).ok).toBe(true);
    expect(withPiece((p) => (p.recording.marks = Array.from({ length: 200 }, (_, i) => ({ fromMs: i, toMs: i + 1 })))).ok).toBe(true);
    expect(withPiece((p) => (p.recording.marks = Array.from({ length: 201 }, (_, i) => ({ fromMs: i, toMs: i + 1 })))).ok).toBe(false);
    expect(withPiece((p) => (p.removed = 'someone')).ok).toBe(false);
    expect(withPiece((p) => (p.recording.marks = [{ fromMs: 1 }])).ok).toBe(false);
    expect(withPiece((p) => (p.recording.truncated = 'never')).ok).toBe(false);
    expect(withPiece((p) => (p.kind = 'mp4')).ok).toBe(false);
  });

  it('holds the real time and the cuts of a recording whose idle stretches were shortened, bounded like the marks (#176)', () => {
    const base = JSON.parse(JSON.stringify(fresh()));
    const withPiece = (edit: (p: Record<string, any>) => void) => {
      const p = JSON.parse(JSON.stringify(piece));
      edit(p);
      return parseRun({ ...base, evidence: { 'ev-1': p } });
    };
    const cuts = (n: number) => Array.from({ length: n }, (_, i) => ({ atMs: 1000 * (i + 1), skippedMs: 5000 }));
    expect(withPiece((p) => Object.assign(p.recording, { realMs: 34_000, cuts: cuts(5) })).ok).toBe(true);
    expect(withPiece((p) => (p.recording.cuts = cuts(500))).ok).toBe(true);
    expect(withPiece((p) => (p.recording.cuts = cuts(501))).ok).toBe(false);
    expect(withPiece((p) => (p.recording.cuts = [{ atMs: 1000 }])).ok).toBe(false);
    expect(withPiece((p) => (p.recording.cuts = [{ atMs: 1000, skippedMs: 0 }])).ok).toBe(false);
    expect(withPiece((p) => (p.recording.realMs = -1)).ok).toBe(false);
    const stored = createRunStore(dir);
    const run = stored.create(fresh());
    const kept = { ...piece, recording: { ...piece.recording!, realMs: 34_000, cuts: cuts(5) } };
    stored.update(run.id, (r) => recordEvidence(r, kept, at(2)));
    expect(stored.get(run.id)?.evidence?.['ev-1']).toEqual(kept);
  });

  it('is not required: a piece with neither field reads as it always did', () => {
    const plain = { id: 'ev-1', stage: 'qa', by: 'qa', title: 'A shot', description: '', name: 'a.png', kind: 'png', bytes: 10, at: at(2), from: null, message: null };
    const parsed = parseRun({ ...JSON.parse(JSON.stringify(fresh())), evidence: { 'ev-1': plain } });
    expect(parsed.ok && parsed.run.evidence?.['ev-1']).toEqual(plain);
  });
});

// The run file format (#157, #176): written as 2 only while the run holds a screen recording and as 3 once that recording holds cuts, so an app that does not know
// them refuses just those runs as written by a newer app, and every other run stays readable by it.
describe('the version of a run file', () => {
  const recording: EvidenceRecord = { id: 'ev-1', stage: 'qa', by: 'qa', title: 'Screen recording', description: '', name: 'screen-recording.webm', kind: 'webm', bytes: 100, at: at(2), from: null, message: null, recording: { durationMs: 9000, width: 8, height: 4, marks: [] } };
  const shot: EvidenceRecord = { id: 'ev-2', stage: 'qa', by: 'qa', title: 'A shot', description: '', name: 'a.png', kind: 'png', bytes: 10, at: at(2), from: null, message: null };
  const onDisk = (id: string): { version: number } => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));

  it('is 1 for every run without a recording, whatever happens to it', () => {
    const store = createRunStore(dir);
    const run = store.create(fresh());
    expect(onDisk(run.id).version).toBe(1);
    store.update(run.id, (r) => recordEvidence(r, shot, at(2)));
    store.update(run.id, (r) => stageDone(r, flow, { summary: 's', handoff: '', artifacts: [] }, at(3)));
    expect(onDisk(run.id).version).toBe(1);
    expect(store.get(run.id)?.version).toBe(1);
  });

  it('is 2 once the run holds a recording, and is read as 2', () => {
    const store = createRunStore(dir);
    const run = store.create(fresh());
    store.update(run.id, (r) => recordEvidence(r, recording, at(2)));
    expect(onDisk(run.id).version).toBe(2);
    expect(store.get(run.id)?.version).toBe(2);
    // It stays 2 through the moves that follow, also once retention marked the file removed (the record is still of the unknown kind to an older app).
    store.update(run.id, (r) => recordEvidence(r, { ...recording, removed: 'retention' }, at(3)));
    store.update(run.id, (r) => recordEvidence(r, shot, at(4)));
    expect(onDisk(run.id).version).toBe(2);
  });

  it('is 3 once a recording holds cuts (#176): an older app refuses it as written by a newer one, not as invalid', () => {
    const store = createRunStore(dir);
    const run = store.create(fresh());
    const cut = { ...recording, recording: { ...recording.recording!, durationMs: 4000, realMs: 34_000, cuts: [{ atMs: 2000, skippedMs: 30_000 }] } };
    store.update(run.id, (r) => recordEvidence(r, cut, at(2)));
    expect(onDisk(run.id).version).toBe(3);
    expect(store.get(run.id)?.version).toBe(3);
    expect(store.get(run.id)?.evidence?.['ev-1']).toEqual(cut);
    // It stays 3 through the moves that follow.
    store.update(run.id, (r) => recordEvidence(r, shot, at(3)));
    expect(onDisk(run.id).version).toBe(3);
    // A recording without cuts, or with an empty list, stays 2.
    const plain = store.create(fresh({ id: 'r-plain1-aa11', issue: { ref: '2', iid: 2, title: 'b', url: null } }));
    store.update(plain.id, (r) => recordEvidence(r, { ...recording, recording: { ...recording.recording!, cuts: [] } }, at(2)));
    expect(onDisk(plain.id).version).toBe(2);
    // The recording going away takes the run back down.
    store.update(run.id, (r) => deleteEvidence(r, 'ev-1', at(4)));
    expect(onDisk(run.id).version).toBe(1);
  });

  it('is 3 for a recording that says how long after the screen opened it started, though nothing was cut (#176)', () => {
    const started = { ...recording, recording: { ...recording.recording!, startedAfterMs: 90_000 } };
    expect(runVersionOf({ evidence: { 'ev-1': started } })).toBe(3);
    const store = createRunStore(dir);
    const run = store.create(fresh());
    store.update(run.id, (r) => recordEvidence(r, started, at(2)));
    expect(onDisk(run.id).version).toBe(3);
    expect(store.get(run.id)?.evidence?.['ev-1']).toEqual(started);
    const base = JSON.parse(JSON.stringify(fresh()));
    const withIt = (v: unknown) => parseRun({ ...base, evidence: { 'ev-1': { ...JSON.parse(JSON.stringify(started)), recording: { ...started.recording, startedAfterMs: v } } } }).ok;
    expect(withIt(0)).toBe(true);
    expect(withIt(-1)).toBe(false);
    expect(withIt(1.5)).toBe(false);
  });

  it('reads the version from the content: 1 without a recording, 2 with one, 3 with one that holds cuts', () => {
    expect(runVersionOf({ evidence: { 'ev-1': recording } })).toBe(2);
    expect(runVersionOf({ evidence: { 'ev-1': { ...recording, recording: { ...recording.recording!, cuts: [{ atMs: 1, skippedMs: 2 }] } } } })).toBe(3);
    expect(runVersionOf({ evidence: { 'ev-1': shot } })).toBe(1);
  });

  it('goes back to 1 when the person deletes the only recording', () => {
    const store = createRunStore(dir);
    const run = store.create(fresh());
    store.update(run.id, (r) => recordEvidence(r, recording, at(2)));
    store.update(run.id, (r) => recordEvidence(r, shot, at(3)));
    store.update(run.id, (r) => deleteEvidence(r, 'ev-1', at(4)));
    expect(onDisk(run.id).version).toBe(1);
    expect(store.get(run.id)?.evidence).toEqual({ 'ev-2': shot });
  });

  it('reads a 1 as it always did, accepts a 2 that holds no recording and writes it back as 1', () => {
    const store = createRunStore(dir);
    const run = store.create(fresh());
    const path = join(dir, `${run.id}.json`);
    writeFileSync(path, JSON.stringify({ ...run, version: 2 }));
    expect(store.get(run.id)).toMatchObject({ id: run.id, version: 2 });
    expect(parseRun({ ...JSON.parse(JSON.stringify(run)), version: 1 }).ok).toBe(true);
    store.update(run.id, (r) => stageDone(r, flow, { summary: 's', handoff: '', artifacts: [] }, at(1)));
    expect(onDisk(run.id).version).toBe(1);
  });

  it('refuses a 4 as written by a newer app and anything else that is not a version', () => {
    const run = JSON.parse(JSON.stringify(fresh()));
    expect(parseRun({ ...run, version: 4 })).toMatchObject({ ok: false, reason: 'newer' });
    expect(parseRun({ ...run, version: 0 })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(parseRun({ ...run, version: 1.5 })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(parseRun({ ...run, version: '1' })).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
