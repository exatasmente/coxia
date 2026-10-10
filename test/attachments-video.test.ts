// The recording of an agent's screen in a conversation (#177, rules 18 to 20, acceptance 13 but for the player): the `video` kind exists only through the app's own door, has a
// ceiling of its own outside the message's, is never offered to the model nor to a person's post, is deleted with its post, and is listed and removed by the retention sweep's
// screens group, leaving the post marked. The data folder is the test file's own empty one.
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.CERIMONIAS_TRANSCRIPTS_DIR = mkdtempSync(join(tmpdir(), 'coxia-video-transcripts-'));

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

const { attachmentStore, createAttachmentStore } = await import('../src/main/attachments');
const { attachmentPost, forumStore, threadAnchor } = await import('../src/main/forum');
const { keepConversationRecording } = await import('../src/main/mentions/recording');
const { applyRetention, conversationRecordingFiles, previewRetention, scan } = await import('../src/main/retention');
const { ATAS } = await import('../src/main/env');
const { detectAttachmentKind, attachmentExt, ATTACHMENT_LIMITS } = await import('../src/shared/attachments');
const { RECORDING_MAX_BYTES } = await import('../src/shared/screen');
const { threadText } = await import('../src/main/runner/prompt');
const { CATALOGS, setLanguage } = await import('../src/shared/i18n');
const { webmHead } = await import('./helpers/webm');
import type { RecordingOutcome } from '../src/main/screen/recorder';

let THREAD = '';
let n = 0;
const DAY = 86_400_000;
const META = { durationMs: 90_000, width: 8, height: 4, marks: [] };
const ok = (bytes = webmHead(500)): RecordingOutcome => ({ ok: true, bytes, meta: META });

beforeEach(() => {
  setLanguage('en');
  THREAD = `g-recorded-${++n}`;
  forumStore().ensureThread({ id: THREAD, kind: 'general', title: 'Recorded' });
});

const deps = () => ({ store: attachmentStore(), forum: forumStore(), anchor: threadAnchor, now: () => new Date(2026, 9, 9, 15, 30) });
const post = () => forumStore().read(THREAD)?.messages ?? [];
const files = () => conversationRecordingFiles(ATAS).filter((f) => f.path.includes(`/${THREAD}/`));

describe('the video kind and its own door', () => {
  it('refuses a WebM a person attaches, as before: no kind recognises a video', () => {
    expect(detectAttachmentKind(webmHead(100))).toBeNull();
    const store = createAttachmentStore({ base: mkdtempSync(join(tmpdir(), 'coxia-video-store-')) });
    expect(() => store.put(THREAD, 'clip.webm', webmHead(100))).toThrow();
    expect(store.list(THREAD)).toEqual([]);
  });

  it('keeps the app\'s recording up to its own ceiling, which does not count against a message, and refuses what is not a WebM, empty or too long', () => {
    const store = createAttachmentStore({ base: mkdtempSync(join(tmpdir(), 'coxia-video-store-')) });
    const big = webmHead(RECORDING_MAX_BYTES - 12);
    expect(big.length).toBe(RECORDING_MAX_BYTES);
    expect(big.length).toBeGreaterThan(ATTACHMENT_LIMITS.messageBytes);
    const put = store.putVideo(THREAD, 'screen.webm', big);
    expect(put.ok).toBe(true);
    if (put.ok) {
      expect(put.ref).toMatchObject({ kind: 'video', bytes: RECORDING_MAX_BYTES });
      expect(attachmentExt('video')).toBe('.webm');
      expect(store.get(THREAD, put.ref.id)?.ref.kind).toBe('video');
    }
    expect(store.putVideo(THREAD, 'x', webmHead(RECORDING_MAX_BYTES))).toEqual({ ok: false, problem: 'too-long' });
    expect(store.putVideo(THREAD, 'x', new Uint8Array([1, 2, 3]))).toEqual({ ok: false, problem: 'not-webm' });
    expect(store.putVideo(THREAD, 'x', new Uint8Array())).toEqual({ ok: false, problem: 'empty' });
    expect(store.files(THREAD)).toHaveLength(1);
  });

  it('is neither listed nor counted among a person\'s files, and the model\'s tool does not find it', () => {
    const store = createAttachmentStore({ base: mkdtempSync(join(tmpdir(), 'coxia-video-store-')) });
    const put = store.putVideo(THREAD, 'screen.webm', webmHead(200));
    if (!put.ok) throw new Error('not kept');
    expect(store.list(THREAD)).toEqual([]);
    expect(store.sizeOf(THREAD)).toBe(0);
    expect(store.readForTool(THREAD, put.ref.id)).toBeNull();
    // Still there for the player: the bytes are read through the message that names it.
    expect(store.get(THREAD, put.ref.id)?.bytes.length).toBe(put.ref.bytes);
  });

  it('cannot be posted again by a person: the id of an existing recording is not a ref a person\'s post may carry', () => {
    expect(keepConversationRecording(deps(), { thread: THREAD, agent: 'web' }, ok())).toBe('kept');
    const ref = post()[0].attachments[0];
    expect(() => attachmentPost(forumStore(), ['web'], THREAD, 'look', [ref])).toThrow();
    expect(post()).toHaveLength(1);
  });
});

describe('keeping the recording of a conversation\'s screen', () => {
  it('stores the video and posts one message of the app that names it, with the agent and the stretch of the day', () => {
    expect(keepConversationRecording(deps(), { thread: THREAD, agent: 'web' }, ok())).toBe('kept');
    const [m] = post();
    expect(m).toMatchObject({ kind: 'system', author: { type: 'app' }, code: 'runner.screen.recording', params: { agent: 'web', from: '15:28', to: '15:30' }, anchor: `thread:${THREAD}` });
    expect(m.attachments).toEqual([expect.objectContaining({ kind: 'video', bytes: 512 })]);
    expect(existsSync(join(ATAS, 'anexos', THREAD, `${m.attachments[0].id}.webm`))).toBe(true);
  });

  it('says the video keeps a hand-off when it does, with a code of its own, and the usual one otherwise', () => {
    expect(keepConversationRecording(deps(), { thread: THREAD, agent: 'web' }, { ok: true, bytes: webmHead(500), meta: { ...META, handoff: true, marks: [{ fromMs: 1000, toMs: 5000, kind: 'handoff' }] } })).toBe('kept');
    expect(post().at(-1)).toMatchObject({ code: 'runner.screen.recordingHandoff', params: { agent: 'web' } });
    expect(CATALOGS.en['main.forum.code.runner.screen.recordingHandoff']).toMatch(/hand-off/);
    expect(CATALOGS['pt-BR']['main.forum.code.runner.screen.recordingHandoff']).toBeTruthy();
  });

  it('is in no prompt: a system post is left out of the thread an agent reads, and its file is not a file of any message', () => {
    keepConversationRecording(deps(), { thread: THREAD, agent: 'web' }, ok());
    expect(threadText(post())).toBe('');
  });

  it.each([
    ['no frame was ever drawn', { ok: false, reason: 'no-frame' } as RecordingOutcome],
    ['the encoder stopped', { ok: false, reason: 'encoder' } as RecordingOutcome],
    ['the file is not a video', ok(new Uint8Array([1, 2, 3, 4]))],
    ['the file is over the ceiling', ok(webmHead(RECORDING_MAX_BYTES))],
  ])('says in the conversation why it was not kept, and keeps no file, when %s', (_why, outcome) => {
    expect(keepConversationRecording(deps(), { thread: THREAD, agent: 'web' }, outcome)).toBe('not');
    const [m] = post();
    expect(m).toMatchObject({ kind: 'system', code: 'runner.screen.notKept', params: { agent: 'web' } });
    expect(String(m.params.reason).length).toBeGreaterThan(3);
    expect(m.attachments).toEqual([]);
    expect(files()).toEqual([]);
  });

  it('says nothing and keeps nothing when the screen was never recorded, or the conversation is gone', () => {
    expect(keepConversationRecording(deps(), { thread: THREAD, agent: 'web' }, null)).toBe('not');
    expect(post()).toEqual([]);
    expect(keepConversationRecording(deps(), { thread: 'g-deleted', agent: 'web' }, ok())).toBe('not');
    expect(files()).toEqual([]);
  });

  it('drops the file when the post that names it cannot be written', () => {
    const d = deps();
    const forum = { summary: d.forum.summary, append: () => { throw new Error('disk full'); } };
    expect(keepConversationRecording({ ...d, forum }, { thread: THREAD, agent: 'web' }, ok())).toBe('not');
    expect(files()).toEqual([]);
  });
});

describe('deleting the post', () => {
  it('removes the file with the message', () => {
    keepConversationRecording(deps(), { thread: THREAD, agent: 'web' }, ok());
    const [m] = post();
    const removed = forumStore().remove(THREAD, m.seq);
    attachmentStore().dropAll(THREAD, removed?.attachments ?? []);
    expect(existsSync(join(ATAS, 'anexos', THREAD, `${m.attachments[0].id}.webm`))).toBe(false);
  });
});

describe('the retention sweep', () => {
  const old = (path: string, days: number): void => {
    const when = new Date(Date.now() - days * DAY);
    utimesSync(path, when, when);
  };
  const keep = (): { id: string; path: string } => {
    keepConversationRecording(deps(), { thread: THREAD, agent: 'web' }, ok());
    const ref = post().at(-1)?.attachments[0];
    if (!ref) throw new Error('no ref');
    const path = join(ATAS, 'anexos', THREAD, `${ref.id}.webm`);
    return { id: ref.id, path };
  };

  it('lists the recording in the screen recordings group, and not as an attachment a live message keeps for ever', () => {
    const { path } = keep();
    old(path, 40);
    const listed = scan(30).remove.filter((v) => v.file.path === path);
    expect(listed).toHaveLength(1);
    expect(listed[0].file.kind).toBe('screens');
    expect(previewRetention(30).groups.find((g) => g.kind === 'screens')?.count).toBeGreaterThanOrEqual(1);
    expect(scan(30).remove.some((v) => v.file.kind === 'anexos' && v.file.path === path)).toBe(false);
    expect(scan(30).keep.some((v) => v.file.path === path)).toBe(false);
  });

  it('keeps one inside the days', () => {
    const { path } = keep();
    old(path, 2);
    expect(scan(30).remove.filter((v) => v.file.path === path)).toEqual([]);
  });

  it('removes only that file, leaves the post and marks its ref removed', () => {
    const other = join(ATAS, 'anexos', THREAD, 'cccccccccccccccc.txt');
    const { id, path } = keep();
    writeFileSync(other, 'a person\'s file\nstays\n');
    old(path, 40);
    old(other, 1);
    const preview = previewRetention(30);
    const result = applyRetention(30, preview.fingerprint);
    expect(result.failed).toEqual([]);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(other)).toBe(true);
    const [m] = post();
    expect(m.code).toBe('runner.screen.recording');
    expect(m.attachments).toEqual([{ id, name: expect.any(String), kind: 'video', bytes: 512, removed: true }]);
    // The next sweep finds nothing to do for it.
    expect(files()).toEqual([]);
  });

  it('does not touch a file whose name is not one the app makes', () => {
    mkdirSync(join(ATAS, 'anexos', THREAD), { recursive: true });
    writeFileSync(join(ATAS, 'anexos', THREAD, 'notes.webm'), 'x');
    expect(files()).toEqual([]);
  });
});
