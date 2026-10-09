// The retention sweep knows the screen recordings of the stages (#157): it lists only the app's own recordings, outside the days, removes only the app's copy of the
// file, marks the record as removed by retention and leaves every other piece of evidence, the run's other records and any copy in a cycle folder alone. It uses the
// workspace's one retention switch and days. The data folder is the test file's own empty one; the transcripts folder is pointed at an empty one too, so the sweep
// never looks at the person's real sessions.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.CERIMONIAS_TRANSCRIPTS_DIR = mkdtempSync(join(tmpdir(), 'coxia-retention-transcripts-'));

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const { applyRetention, previewRetention, removeScreenRecording, retention, scan, screenRecordingFiles } = await import('../src/main/retention');
const { getSettings, saveSettings } = await import('../src/main/config');
const { setLanguage } = await import('../src/shared/i18n');
const { retentionLabel } = await import('../src/shared/retention');
const { ATAS } = await import('../src/main/env');
const { runStore } = await import('../src/main/runs');
const { putRecording } = await import('../src/main/evidence/recording');
const { evidencePath, putEvidence } = await import('../src/main/evidence/store');
const { forumStore } = await import('../src/main/forum');
const { agentFlowStages, at, startInput } = await import('./helpers/runs');
const { webmHead } = await import('./helpers/webm');
const { recordEvidence, startRun } = await import('../src/shared/runs');
import type { EvidenceRecord } from '../src/shared/evidence';
import type { Run } from '../src/shared/runs';

const DAY = 86_400_000;

// Every case starts with no runs and no evidence in the workspace.
beforeEach(() => {
  setLanguage('en');
  rmSync(join(ATAS, 'runs'), { recursive: true, force: true });
  rmSync(join(ATAS, 'evidence'), { recursive: true, force: true });
});
const flow = agentFlowStages();
let counter = 0;

/** A run with the given pieces: a recording and a screenshot of the agent, each as a record and a file. */
function newRun(): Run {
  counter++;
  const id = `r-ret${String(counter).padStart(3, '0')}-ab12`;
  const run = runStore().create(startRun(startInput({ id, issue: { ref: `app#${200 + counter}`, iid: 200 + counter, title: 'T', url: null } }), flow, at(0)).run);
  forumStore().ensureThread({ id: `run-${id}`, kind: 'run', runId: id, title: 'T' });
  return run;
}

function keepRecording(run: Run, ageDays: number): EvidenceRecord {
  const fresh = runStore().get(run.id) as Run;
  const put = putRecording(ATAS, fresh, { bytes: webmHead(200), stage: 'qa', by: 'qa', title: 'Screen recording', meta: { durationMs: 5000, width: 8, height: 4, marks: [{ fromMs: 1000, toMs: 2000 }] }, at: at(1) });
  if (!put.ok) throw new Error('not kept');
  runStore().update(run.id, (r) => recordEvidence(r, put.record, at(1)));
  age(run.id, put.record, ageDays);
  return put.record;
}

function keepShot(run: Run, ageDays: number): EvidenceRecord {
  const fresh = runStore().get(run.id) as Run;
  const dir = mkdtempSync(join(tmpdir(), 'coxia-retention-shot-'));
  const file = join(dir, 'shot.txt');
  writeFileSync(file, 'what the agent saw\n');
  const put = putEvidence(ATAS, fresh, { path: file, name: 'shot.txt', title: 'A shot', description: '', stage: 'qa', by: 'qa', at: at(1) });
  if (!put.ok) throw new Error('not kept');
  runStore().update(run.id, (r) => recordEvidence(r, put.record, at(1)));
  age(run.id, put.record, ageDays);
  return put.record;
}

function age(runId: string, record: Pick<EvidenceRecord, 'id' | 'kind'>, days: number): void {
  const path = evidencePath(ATAS, runId, record) as string;
  const when = new Date(Date.now() - days * DAY);
  utimesSync(path, when, when);
}

const group = (days: number) => previewRetention(days).groups.find((g) => g.kind === 'screens');

describe('the screen recordings group of the retention sweep', () => {
  it('lists the app\'s recordings through the runs\' records, and nothing else: not an agent\'s piece, not a file nobody records', () => {
    const run = newRun();
    const rec = keepRecording(run, 40);
    keepShot(run, 40);
    // A file in the evidence folder that no record claims (a stray) is not a recording.
    writeFileSync(join(ATAS, 'evidence', run.id, 'ev-9.webm'), webmHead(10));
    const files = screenRecordingFiles();
    expect(files.filter((f) => f.path.includes(run.id)).map((f) => [f.kind, f.path.split('/').slice(-1)[0], f.keep])).toEqual([['screens', `${rec.id}.webm`, false]]);
  });

  it('selects one outside the days, keeps one inside them and one younger than a day, and shows in the preview with its size', () => {
    const old = newRun();
    const recent = newRun();
    const fresh = newRun();
    const oldRec = keepRecording(old, 40);
    keepRecording(recent, 10);
    keepRecording(fresh, 0);
    const preview = previewRetention(30);
    const g = preview.groups.find((x) => x.kind === 'screens');
    expect(g).toMatchObject({ label: retentionLabel('screens'), count: 1, bytes: webmHead(200).length });
    expect(preview.items.filter((i) => i.kind === 'screens').map((i) => i.name)).toEqual([`${oldRec.id}.webm`]);
    const kept = scan(30).keep.filter((v) => v.file.kind === 'screens').map((v) => v.reason);
    expect(kept).toHaveLength(2);
    // A shorter period reaches the one that was inside the days.
    expect(group(7)?.count).toBe(2);
  });

  it('removes the file and marks the record, and leaves the other evidence, the run\'s other records and a cycle-folder copy alone', () => {
    const run = newRun();
    const shot = keepShot(run, 90);
    const rec = keepRecording(run, 40);
    // A copy of the recording that went somewhere else (a cycle folder) is not the app's copy.
    const elsewhere = mkdtempSync(join(tmpdir(), 'coxia-retention-cycle-'));
    mkdirSync(join(elsewhere, 'evidence'), { recursive: true });
    writeFileSync(join(elsewhere, 'evidence', `${rec.id}.webm`), webmHead(200));
    const before = readFileSync(evidencePath(ATAS, run.id, shot) as string);
    const recPath = evidencePath(ATAS, run.id, rec) as string;
    const preview = previewRetention(30);
    const result = applyRetention(30, preview.fingerprint);
    expect(result.failed).toEqual([]);
    expect(existsSync(recPath)).toBe(false);
    const after = runStore().get(run.id) as Run;
    expect(after.evidence?.[rec.id]).toMatchObject({ kind: 'webm', removed: 'retention', recording: { durationMs: 5000, marks: [{ fromMs: 1000, toMs: 2000 }] } });
    expect(after.version).toBe(2);
    expect(after.history.at(-1)).toMatchObject({ type: 'evidence-removed', by: 'app', detail: `${rec.id}: retention` });
    // The agent's piece: the file and the record are as they were (it is not swept by this issue, whatever its age).
    expect(Buffer.from(readFileSync(evidencePath(ATAS, run.id, shot) as string)).equals(before)).toBe(true);
    expect(after.evidence?.[shot.id]).toEqual(shot);
    expect(readdirSync(join(elsewhere, 'evidence'))).toEqual([`${rec.id}.webm`]);
    // Once marked it is no longer listed, and a second sweep has nothing to do.
    expect(screenRecordingFiles().filter((f) => f.path.includes(run.id))).toEqual([]);
    expect(applyRetention(30, null).deleted).toBe(0);
  });

  it('does not take a file that is gone by the time it is reached for a failure, and still marks the record', () => {
    const run = newRun();
    const rec = keepRecording(run, 40);
    const [file] = screenRecordingFiles().filter((f) => f.path.includes(run.id));
    // The person took the file away between the listing and the removal.
    rmSync(file.path);
    expect(() => removeScreenRecording(file)).not.toThrow();
    expect((runStore().get(run.id) as Run).evidence?.[rec.id]).toMatchObject({ removed: 'retention' });
    // A second time there is nothing left to do.
    expect(() => removeScreenRecording(file)).not.toThrow();
  });

  it('refuses a file that changed after it was listed, as the other groups do, and does not follow a link put in its place', () => {
    const run = newRun();
    const rec = keepRecording(run, 45);
    const [file] = screenRecordingFiles().filter((f) => f.path.includes(run.id));
    const now = new Date();
    utimesSync(file.path, now, now);
    expect(() => removeScreenRecording(file)).toThrow(/changed/);
    expect(existsSync(file.path)).toBe(true);
    expect((runStore().get(run.id) as Run).evidence?.[rec.id]?.removed).toBeUndefined();

    const other = newRun();
    const otherRec = keepRecording(other, 45);
    const otherPath = evidencePath(ATAS, other.id, otherRec) as string;
    const target = join(mkdtempSync(join(tmpdir(), 'coxia-retention-target-')), 'not-ours');
    writeFileSync(target, 'not ours');
    rmSync(otherPath);
    symlinkSync(target, otherPath);
    // A link is not a regular file: it is not even listed, so the sweep never reaches what it points to.
    expect(screenRecordingFiles().some((f) => f.path === otherPath)).toBe(false);
    expect(() => removeScreenRecording({ kind: 'screens', path: otherPath, size: 1, mtimeMs: 0 })).toThrow(/regular/);
    expect(readFileSync(target, 'utf8')).toBe('not ours');
  });

  it('is swept by the daily job only while the workspace\'s retention switch is on, with the same days', async () => {
    const run = newRun();
    const rec = keepRecording(run, 45);
    let job: { run(): Promise<void> } | null = null;
    retention({ handle: () => {}, notify: () => {}, emit: () => {}, job: (j) => (job = j) });
    expect(job).not.toBeNull();
    const settings = getSettings();
    // Off, which is the default: the preview lists the recording and the job removes nothing.
    saveSettings({ ...settings, retention: { enabled: false, days: 30 } });
    expect(previewRetention(30).groups.some((g) => g.kind === 'screens')).toBe(true);
    await (job as unknown as { run(): Promise<void> }).run();
    expect(existsSync(evidencePath(ATAS, run.id, rec) as string)).toBe(true);
    expect((runStore().get(run.id) as Run).evidence?.[rec.id]?.removed).toBeUndefined();
    // On, with the days past: the job removes the file and marks the record.
    saveSettings({ ...settings, retention: { enabled: true, days: 30 } });
    await (job as unknown as { run(): Promise<void> }).run();
    expect(evidencePath(ATAS, run.id, rec)).toBeNull();
    expect((runStore().get(run.id) as Run).evidence?.[rec.id]?.removed).toBe('retention');
    saveSettings(settings);
  });
});

describe('the logged-in browser profiles', () => {
  it('are in no retention group: a profile file older than the days is neither listed nor removed', () => {
    const file = join(ATAS, 'browser', 'scout', 'Default', 'Cookies');
    mkdirSync(join(ATAS, 'browser', 'scout', 'Default'), { recursive: true });
    writeFileSync(file, 'a session');
    const old = new Date(Date.now() - 400 * DAY);
    utimesSync(file, old, old);
    const preview = previewRetention(7);
    expect(JSON.stringify(preview)).not.toContain('Cookies');
    expect(JSON.stringify(preview)).not.toContain('browser');
    applyRetention(7, null);
    expect(readFileSync(file, 'utf8')).toBe('a session');
    rmSync(join(ATAS, 'browser'), { recursive: true, force: true });
  });
});
