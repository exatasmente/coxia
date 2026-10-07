// The files a person attaches to the message that answers a run's question must be openable from that answer message and must go from disk when the
// message is deleted. The message the runner records is written by the move (runs-forum.ts), not by the forum module, so it has to carry the same
// conversation anchor the forum module puts on a written post; without it the two attachment channels (which gate on the anchor) turn the message away.
// This is the path a person actually walks in a run's conversation: the answer the run waits for. Scripted agents only; nothing reaches a model or a host.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

// The attachment channels resolve their store against the workspace's data folder (ATAS, from CERIMONIAS_DATA_DIR): point it at a throwaway folder
// before the module that reads it is imported, exactly as test/forum-attachment-delete.test.ts does. The runner boots over that same folder.
const realData = process.env.CERIMONIAS_DATA_DIR;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-answer-open-'));
  process.env.CERIMONIAS_DATA_DIR = dir;
});
afterEach(() => {
  process.env.CERIMONIAS_DATA_DIR = realData;
  rmSync(dir, { recursive: true, force: true });
});

import { setLanguage } from '../src/shared/i18n';

const { forumModule } = await import('../src/main/forum');
const { ATAS } = await import('../src/main/env');
type ModuleContext = import('../src/main/module').ModuleContext;
const { boot, doc, work } = await import('./helpers/runner');
type Boot = Awaited<ReturnType<typeof boot>>;

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => setLanguage('en'));

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

function channels(): Record<string, (...args: unknown[]) => unknown> {
  const out: Record<string, (...args: unknown[]) => unknown> = {};
  forumModule({ handle: (channel: string, fn: (...args: never[]) => unknown) => (out[channel] = fn as unknown as (...args: unknown[]) => unknown), notify: () => undefined, emit: () => undefined, job: () => undefined } as unknown as ModuleContext);
  return out;
}

/** The flow driven to the question the person answers, with two files stored in the data root for that run's own conversation. */
async function answerWithFiles(): Promise<{ b: Boot; thread: string; seq: number; png: string; log: string }> {
  const b = await boot({ dir: ATAS });
  b.engine.script('refiner', () => work('I need to know.', { artifacts: [doc('1_SPEC.md')], question: 'Which users does this cover?' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', () => work('Done.', { artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved' }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')] }));
  const run = await b.runner.start('app#101');
  for (let i = 0; i < 4 && b.runner.get(run.id)!.status !== 'question'; i++) {
    await b.settle();
    if (b.runner.get(run.id)!.status === 'gate') b.runner.gate(run.id, 'approve');
  }
  expect(b.runner.get(run.id)).toMatchObject({ status: 'question' });
  const thread = `run-${run.id}`;
  const c = channels();
  const png = (c['forum:attachment-put'](thread, 'shot.png', PNG) as { id: string }).id;
  const log = (c['forum:attachment-put'](thread, 'trace.log', b64('line one\nline two\n')) as { id: string }).id;
  const refs = [
    { id: png, name: 'shot.png', kind: 'image' as const, bytes: Buffer.from(PNG, 'base64').length },
    { id: log, name: 'trace.log', kind: 'text' as const, bytes: 18 },
  ];
  b.runner.answer(run.id, 'All signed-in users', refs);
  const answers = b.thread(run.id).filter((m) => m.kind === 'answer');
  expect(answers).toHaveLength(1);
  return { b, thread, seq: answers[0].seq, png, log };
}

describe('the files of the answer message the runner records', () => {
  it('open from that message, and go from disk when that message is deleted', async () => {
    const { thread, seq, png, log } = await answerWithFiles();
    const c = channels();
    // The message the runner wrote opens its own files: the bytes are served and the kind reads back.
    const got = c['forum:attachment-get'](thread, seq, png) as { data: string; ref: { kind: string } } | null;
    expect(got).not.toBeNull();
    expect(Buffer.from(got!.data, 'base64').toString('base64')).toBe(PNG);
    expect(got!.ref.kind).toBe('image');
    const text = c['forum:attachment-get'](thread, seq, log) as { data: string } | null;
    expect(Buffer.from(text!.data, 'base64').toString('utf8')).toBe('line one\nline two\n');
    // Deleting that message deletes its files from disk.
    expect(existsSync(join(ATAS, 'anexos', thread, `${png}.img`))).toBe(true);
    expect(existsSync(join(ATAS, 'anexos', thread, `${log}.txt`))).toBe(true);
    expect(c['forum:attachment-delete'](thread, seq)).toBe(true);
    expect(existsSync(join(ATAS, 'anexos', thread, `${png}.img`))).toBe(false);
    expect(existsSync(join(ATAS, 'anexos', thread, `${log}.txt`))).toBe(false);
    // the same message is never open through another conversation's id
    expect(c['forum:attachment-delete']('g-another', seq)).toBe(false);
  });
});
