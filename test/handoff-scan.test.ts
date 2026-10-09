// Spec criterion 8 (#178): after a hand-off in which a marker string is typed through the input channel, the marker is in nothing the app wrote. The stores are the real ones over
// this file's own empty data folder (the forum's thread files, the audit log, the run file, the evidence store, the recording's metadata and bytes), the hub and the service are
// the real ones over a fake display, and then every file under the folder is searched for the marker. The thread has exactly the lines of rule 16.
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DATA = mkdtempSync(join(tmpdir(), 'coxia-handoff-scan-'));
process.env.CERIMONIAS_DATA_DIR = DATA;
process.env.CERIMONIAS_TRANSCRIPTS_DIR = mkdtempSync(join(tmpdir(), 'coxia-handoff-scan-transcripts-'));

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const { setLanguage } = await import('../src/shared/i18n');
const { createScreenAsks } = await import('../src/main/browser/asks');
const { createMaskSet } = await import('../src/main/browser/mask');
const { createStepLog } = await import('../src/main/browser/stepLog');
const { putRecording } = await import('../src/main/evidence/recording');
const { forumStore } = await import('../src/main/forum');
const { recordWrite, listAudit } = await import('../src/main/auditoria');
const { createRunStore } = await import('../src/main/runs-core');
const { createHandoffService, resultText } = await import('../src/main/screen/handoff');
const { createScreenHub } = await import('../src/main/screen/hub');
const { rpcContext } = await import('../src/main/errorlog-core');
const { createTypedValues } = await import('../src/main/screen/typedValues');
const { recordEvidence, startRun } = await import('../src/shared/runs');
const { fakeConn } = await import('./helpers/screen');
const { fakeSink } = await import('./helpers/recorderSink');
const { agentFlowStages, at, startInput } = await import('./helpers/runs');
import type { RecordingOutcome } from '../src/main/screen/recorder';

const MARKER = 'zq-marker-4821';
const OTHER = 'another-4821-value';
const KEY = 'run:r-abc123-x1y2';
const THREAD = 'g-handoff-scan';
const typeText = (text: string) => [...text].flatMap((c) => [{ t: 'key' as const, key: c, down: true }, { t: 'key' as const, key: c, down: false }]);

beforeEach(() => setLanguage('en'));
afterEach(() => vi.restoreAllMocks());

/** Every file under the folder, as bytes: what the app left on the disk. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('what a hand-off leaves on the disk and in the console', () => {
  it('holds the marker nowhere: not in the thread, the audit, the steps, the run file, the evidence, the recording\'s metadata, the result or the console', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    forumStore().ensureThread({ id: THREAD, kind: 'general', title: 'Hand-off' });
    let t = 1_700_000_000_000;
    const timers: (() => void)[] = [];
    const conn = fakeConn();
    const sink = fakeSink();
    const hub = createScreenHub({
      enabled: true,
      encoder: { encode: (frame, width) => ({ jpeg: Uint8Array.from([0xff, 0xd8, frame.data[0]]), width, height: width / 2 }) },
      now: () => t,
      sink: () => sink,
      connect: async () => conn,
      schedule: (_ms, fn) => {
        timers.push(fn);
        return () => undefined;
      },
      note: (thread, _stage, code, params) => void forumStore().append(thread, { kind: 'system', author: { type: 'app' }, code, params }),
    });
    await hub.open({ key: KEY, thread: THREAD, stage: 'qa', agent: 'qa', socket: '/x/X99', kind: 'sandbox' });
    await vi.waitFor(() => expect(sink.fed).toHaveLength(1));
    const steps = createStepLog();
    const masks = createMaskSet();
    const asks = createScreenAsks({ changed: () => undefined, newId: () => 'ask-1', now: () => new Date(t) });
    const notices: unknown[] = [];
    const service = createHandoffService({
      hub,
      asks,
      say: (thread, _stage, code, params) => void forumStore().append(thread, { kind: 'system', author: { type: 'app' }, code, params }),
      audit: (entry) => recordWrite(entry),
      notify: (notice) => notices.push(notice),
      masks: () => masks,
      step: (_key, step) => void steps.add(step),
      schedule: (_ms, fn) => {
        timers.push(fn);
        return () => undefined;
      },
      now: () => t,
      newId: () => 'ask-1',
    });
    const call = service.begin({ key: KEY, thread: THREAD, place: 'stage', stage: 'qa', issue: 101, agent: 'qa', agentName: 'QA', about: '#123 Fix the form', paths: { browser: true, shell: 'sandbox' }, pause: () => () => undefined, signal: new AbortController().signal });

    const asked = call.request({ what: 'log in to example.com', why: 'the page asks for a password' });
    await service.take(KEY, 'ask-1');
    // The person types through the input channel: a value, a Tab, and a second value.
    await hub.input(KEY, typeText(MARKER));
    await hub.input(KEY, [{ t: 'key', key: 'Tab', down: true }, ...typeText(OTHER)]);
    t += 4000;
    service.give(KEY);
    const result = await asked;
    expect(result).toBe('done');
    expect(resultText(result as 'done')).toBe('The person finished and gave the screen back.');

    // The mask holds the values in memory for the rest of the call, which is its purpose; nothing else does.
    expect(call.typed.mask(`out ${MARKER}`)).toBe('out [secret]');

    // The recording keeps the interval, marked, and its metadata says nothing of what was typed.
    t += 2000;
    const outcome = (await hub.finish(KEY)) as RecordingOutcome;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.meta.handoff).toBe(true);
    expect(outcome.meta.marks.filter((m) => m.kind === 'handoff')).toHaveLength(1);

    // The run file and the evidence store, as the runner would write them.
    const flow = agentFlowStages();
    const runs = createRunStore(join(DATA, 'runs'));
    const run = runs.create(startRun(startInput(), flow, at(0)).run);
    const put = putRecording(DATA, run, { bytes: outcome.bytes, stage: 'qa', by: 'qa', title: 'Screen recording of the stage (made by the app)', meta: outcome.meta, at: at(2) });
    expect(put.ok).toBe(true);
    if (!put.ok) return;
    runs.update(run.id, (r) => recordEvidence(r, put.record, at(3)));

    call.end();

    // The thread has exactly the lines of rule 16: asked, taken, the one line of the interval, back. No burst lines.
    const thread = forumStore().read(THREAD)?.messages ?? [];
    expect(thread.map((m) => m.code)).toEqual(['runner.screen.handoffAsked', 'runner.screen.handoffTaken', 'runner.screen.handoffUsed', 'runner.screen.handoffBack']);

    const memory = JSON.stringify({ result, text: resultText(result as 'done'), thread, audit: listAudit(), steps: steps.entries(), notices, asks: asks.list(KEY), meta: outcome.meta, run: runs.get(run.id), errors: errors.mock.calls, warns: warns.mock.calls });
    expect(memory).not.toMatch(/zq-marker|another-4821|4821-value/);
    // Typed text did get to the call's mask, so the audit has an entry for the hand-off and none of the typing.
    expect(listAudit().filter((e) => e.kind === 'screen-handoff')).toHaveLength(1);

    // And on the disk: every file under the data folder, the forum's files, the audit log, the run file and the evidence included.
    const files = filesUnder(DATA);
    expect(files.some((f) => f.includes('auditoria'))).toBe(true);
    expect(files.some((f) => f.includes('evidence'))).toBe(true);
    expect(files.some((f) => f.includes('runs'))).toBe(true);
    for (const file of files) {
      const bytes = readFileSync(file);
      expect(bytes.includes(MARKER), `${file} holds the marker`).toBe(false);
      expect(bytes.includes(OTHER), `${file} holds the other value`).toBe(false);
    }
  });

  it('keeps the arguments of a failed channel call out of the error log: the context names the channel and the screen, never the events', () => {
    const events = [{ t: 'key', key: 'z', down: true }, { t: 'key', key: MARKER, down: true }];
    for (const [channel, args] of [
      ['screen:input', [KEY, events]],
      ['screen:control', [KEY, true]],
      ['screen:handoffTake', [KEY, 'ask-1']],
      ['screen:handoffGive', [KEY]],
      ['screen:handoffFrame', [KEY, 3, 640]],
      ['runs:handoffDecline', ['ask-1']],
    ] as const) {
      const context = JSON.stringify(rpcContext(channel, [...args], 'ipc'));
      expect(context).not.toContain(MARKER);
      expect(context).toContain(channel);
    }
  });
});

// Criterion 9: no tool the app offers a model returns a live frame, the recording or the typed text. Pinned from both sides so a future path fails here: the typed values have no
// reader at all (only a mask and a yes/no), and the modules that define the model's tools never reach the hub's pictures or the recording.
describe('the tools the app offers a model', () => {
  const SRC = join(__dirname, '..', 'src', 'main');

  it('cannot read the typed text back: the call object has a mask, a yes/no, a flag and a clear, and nothing that returns a value', () => {
    const typed = createTypedValues();
    typed.add([MARKER]);
    expect(Object.keys(typed).sort()).toEqual(['add', 'clear', 'had', 'hits', 'mask', 'snapshot']);
    // the copy kept for a detached turn answers yes or no and forgets: it returns no value either
    const copy = typed.snapshot();
    expect(Object.keys(copy).sort()).toEqual(['clear', 'hits']);
    expect(copy.hits(MARKER)).toBe(true);
    typed.clear();
    expect(copy.hits(MARKER)).toBe(true);
    copy.clear();
    expect(copy.hits(MARKER)).toBe(false);
    typed.add([MARKER]);
    expect(typed.mask(`x ${MARKER} y`)).toBe('x [secret] y');
    expect(typed.hits(MARKER)).toBe(true);
    expect(JSON.stringify(typed)).not.toContain(MARKER);
  });

  it('are defined in modules that never ask the hub for a picture or the recording, nor build an image or a video of the screen', () => {
    const tools = ['runner/tools.ts', 'sandbox/tool.ts', 'sandbox/engineTool.ts', 'evidence/tool.ts', 'attachmentTool.ts', 'browser/engineTool.ts', 'mentions/converse.ts'];
    for (const file of tools) {
      expect(existsSync(join(SRC, file)), file).toBe(true);
      const text = readFileSync(join(SRC, file), 'utf8');
      expect(text, file).not.toMatch(/screenHub\(|\bhub\.(frame|finish)\(|handoffFrame|putRecording|RecordingOutcome|createRecorder|endInterval|beginInterval/);
    }
  });

  it('give the screen_handoff tool a result of a fixed sentence, whatever the person typed', async () => {
    const { resultText } = await import('../src/main/screen/handoff');
    for (const result of ['done', 'declined', 'expired', 'unavailable'] as const) {
      expect(resultText(result)).toMatch(/^The (person|screen) [A-Za-z ']+\.$/);
      expect(resultText(result)).not.toContain(MARKER);
    }
  });
});
